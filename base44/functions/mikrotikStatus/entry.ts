import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { Client } from 'npm:ssh2@1.16.0';

async function requireAdmin(base44, token) {
  if (!token) throw new Error('Sessão administrativa não enviada');
  const sessions = await base44.asServiceRole.entities.AdminSession.filter({ token });
  const session = sessions?.[0];
  if (!session || new Date(session.expires_at) < new Date()) throw new Error('Sessão administrativa expirada');
  return session;
}

function normalizeHost(host) {
  return String(host || '').trim().replace(/^ssh:\/\//i, '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
}

function sshExec(host, port, username, password, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      if (err) reject(err); else resolve(String(value || '').trim());
    };
    const timer = setTimeout(() => {
      conn.destroy();
      finish(new Error('Timeout SSH ao conectar em ' + host + ':' + port));
    }, 15000);

    conn.on('ready', () => {
      conn.exec(`terminal length 0\n${command}`, { pty: true }, (err, stream) => {
        if (err) return finish(err);
        stream.on('data', d => { output += d.toString(); });
        stream.stderr.on('data', d => { output += d.toString(); });
        stream.on('close', () => finish(null, output));
      });
    });

    conn.on('keyboard-interactive', (name, instructions, lang, prompts, done) => done([password]));
    conn.on('error', err => finish(err));

    conn.connect({
      host: normalizeHost(host),
      port: parseInt(port) || 22,
      username,
      password,
      tryKeyboard: true,
      readyTimeout: 15000,
      algorithms: {
        cipher: ['aes256-cbc', 'aes128-cbc', 'aes256-ctr', 'aes128-ctr'],
        serverHostKey: ['ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
        kex: [
          'curve25519-sha256', 'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
          'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1',
          'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group1-sha1'
        ],
        hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
      },
    });
  });
}

// Parse RouterOS print output into key-value object
function parsePrint(output) {
  const result = {};
  const text = String(output || '').replace(/\r/g, '\n');
  const pairs = text.match(/[a-zA-Z][\w-]*=("[^"]*"|\S+)/g) || [];
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1).replace(/^"|"$/g, '');
    result[key] = value;
  }
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*([\w-]+):\s*(.+)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { host, port = '22', user: sshUser = 'admin', password = '', token } = body;

  try {
    await requireAdmin(base44, token);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 401 });
  }

  if (!host) return Response.json({ error: 'host é obrigatório' }, { status: 400 });

  try {
    // Fetch system resources and hotspot active users in sequence
    const cleanHost = normalizeHost(host);
    const resOutput = await sshExec(cleanHost, port, sshUser, password,
      '/system resource print terse without-paging');
    const res = parsePrint(resOutput);
    const hasRouterOsData = Boolean(res.uptime || res.version || res['board-name'] || res['cpu-load'] || res['free-memory'] || res['total-memory']);
    if (!hasRouterOsData) {
      return Response.json({
        error: `SSH conectou em ${cleanHost}:${port}, mas o RouterOS não retornou dados válidos. Verifique se o usuário tem permissão e se o comando /system resource print funciona no terminal.`
      }, { status: 200 });
    }

    let activeUsers = 0;
    let hotspotCount = 0;
    try {
      const hotOutput = await sshExec(cleanHost, port, sshUser, password,
        '/ip hotspot active print count-only');
      activeUsers = parseInt(hotOutput) || 0;
    } catch (_) {}
    try {
      const hotspotList = await sshExec(cleanHost, port, sshUser, password,
        '/ip hotspot print count-only');
      hotspotCount = parseInt(hotspotList) || 0;
    } catch (_) {}

    let radiusHotspotCount = 0;
    try {
      const radiusList = await sshExec(cleanHost, port, sshUser, password,
        '/radius print count-only where service~"hotspot"');
      radiusHotspotCount = parseInt(radiusList) || 0;
    } catch (_) {}

    return Response.json({
      connected: true,
      uptime: res['uptime'] || null,
      cpu_load: res['cpu-load'] !== undefined ? (parseInt(res['cpu-load']) || 0) : null,
      free_memory: parseInt(res['free-memory']) || null,
      total_memory: parseInt(res['total-memory']) || null,
      temperature: res['cpu-temperature'] ? parseInt(res['cpu-temperature']) : null,
      board_name: res['board-name'] || null,
      version: res['version'] || null,
      active_users: activeUsers,
      hotspot_count: hotspotCount,
      radius_hotspot_count: radiusHotspotCount,
    });
  } catch (err) {
    let msg = err.message;
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      msg = `Timeout SSH em ${normalizeHost(host)}:${port} — verifique NAT/firewall e se essa porta está acessível pela internet`;
    } else if (msg.includes('refused') || msg.includes('ECONNREFUSED')) {
      msg = `Conexão SSH recusada em ${host}:${port} — verifique se o SSH está ativo no MikroTik`;
    } else if (msg.includes('Authentication') || msg.includes('auth')) {
      msg = `Falha de autenticação SSH — verifique usuário e senha`;
    } else if (msg.includes('ENETUNREACH') || msg.includes('network')) {
      msg = `IP ${host} inacessível — verifique se o endereço é acessível pela internet`;
    }
    return Response.json({ error: msg }, { status: 200 });
  }
});