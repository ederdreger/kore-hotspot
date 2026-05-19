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
      finish(new Error('Timeout ao executar comando SSH em ' + host + ':' + port));
    }, 20000);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
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
      readyTimeout: 20000,
      algorithms: {
        cipher: ['aes256-cbc', 'aes128-cbc'],
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

function extractValue(output, key) {
  const line = String(output || '').split(/\r?\n/).find(item => item.trim().startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
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
    const cleanHost = normalizeHost(host);
    const resourceCommand = ':put ("uptime=" . [/system resource get uptime]); :put ("version=" . [/system resource get version]); :put ("board-name=" . [/system resource get board-name]); :put ("cpu-load=" . [/system resource get cpu-load]); :put ("free-memory=" . [/system resource get free-memory]); :put ("total-memory=" . [/system resource get total-memory])';
    const resOutput = await sshExec(cleanHost, port, sshUser, password, resourceCommand);
    const uptime = extractValue(resOutput, 'uptime');
    const version = extractValue(resOutput, 'version');
    const boardName = extractValue(resOutput, 'board-name');
    const cpuLoad = extractValue(resOutput, 'cpu-load');
    const freeMemory = extractValue(resOutput, 'free-memory');
    const totalMemory = extractValue(resOutput, 'total-memory');

    if (!uptime && !version && !boardName) {
      return Response.json({
        error: `SSH conectou em ${cleanHost}:${port}, mas o RouterOS não respondeu aos comandos de leitura. Execute no terminal: /system resource get uptime`
      }, { status: 200 });
    }

    let activeUsers = 0;
    let hotspotCount = 0;
    let radiusHotspotCount = 0;
    try {
      const serviceOutput = await sshExec(cleanHost, port, sshUser, password,
        ':put ("active-users=" . [:len [/ip hotspot active find]]); :put ("hotspot-count=" . [:len [/ip hotspot find]]); :put ("radius-hotspot-count=" . [:len [/radius find where service~"hotspot"]])');
      activeUsers = parseInt(extractValue(serviceOutput, 'active-users')) || 0;
      hotspotCount = parseInt(extractValue(serviceOutput, 'hotspot-count')) || 0;
      radiusHotspotCount = parseInt(extractValue(serviceOutput, 'radius-hotspot-count')) || 0;
    } catch (_) {}

    return Response.json({
      connected: true,
      uptime: uptime || null,
      cpu_load: cpuLoad !== '' ? (parseInt(cpuLoad) || 0) : null,
      free_memory: parseInt(freeMemory) || null,
      total_memory: parseInt(totalMemory) || null,
      temperature: null,
      board_name: boardName || null,
      version: version || null,
      active_users: activeUsers,
      hotspot_count: hotspotCount,
      radius_hotspot_count: radiusHotspotCount,
    });
  } catch (err) {
    let msg = err.message;
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      msg = `O MikroTik aceitou o SSH, mas demorou para responder aos comandos RouterOS em ${normalizeHost(host)}:${port}.`;
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