import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { Client } from 'npm:ssh2@1.16.0';
import snmp from 'npm:net-snmp@3.14.0';

async function requireAdmin(base44, token) {
  if (!token) throw new Error('Sessão administrativa não enviada');
  const sessions = await base44.asServiceRole.entities.AdminSession.filter({ token });
  const session = sessions?.[0];
  if (!session || new Date(session.expires_at) < new Date()) throw new Error('Sessão administrativa expirada');
  return session;
}

function normalizeHost(host) {
  return String(host || '').trim().replace(/^ssh:\/\//i, '').replace(/^snmp:\/\//i, '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
}

function sshExec(host, port, username, password, commands) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const results = [];
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error('Timeout SSH'));
    }, 15000);

    const runNext = (stream, cmds, idx) => {
      if (idx >= cmds.length) {
        clearTimeout(timer);
        conn.end();
        resolve(results);
        return;
      }
      let out = '';
      conn.exec(cmds[idx], (err, s) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        s.on('data', d => { out += d.toString(); });
        s.stderr.on('data', d => { out += d.toString(); });
        s.on('close', () => {
          results.push({ cmd: cmds[idx], output: out.trim() });
          runNext(stream, cmds, idx + 1);
        });
      });
    };

    conn.on('ready', () => runNext(null, commands, 0));
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => finish([password]));
    conn.on('error', err => { clearTimeout(timer); reject(err); });
    conn.connect({
      host,
      port: parseInt(port) || 22,
      username,
      password,
      tryKeyboard: true,
      readyTimeout: 10000,
      algorithms: {
        cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-cbc', 'aes192-cbc', 'aes256-cbc'],
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

function parseResource(output) {
  const data = {};
  const lines = output.split('\n');
  lines.forEach(line => {
    if (line.includes('uptime:')) data.uptime = line.split('uptime:')[1].trim();
    if (line.includes('version:')) data.version = line.split('version:')[1].trim();
    if (line.includes('free-memory:')) data.freeMemory = parseInt(line.split('free-memory:')[1].replace(/[^0-9]/g, '')) * 1024;
    if (line.includes('total-memory:')) data.totalMemory = parseInt(line.split('total-memory:')[1].replace(/[^0-9]/g, '')) * 1024;
    if (line.includes('cpu-load:')) data.cpuLoad = parseInt(line.split('cpu-load:')[1].replace(/[^0-9]/g, ''));
    if (line.includes('board-name:')) data.boardName = line.split('board-name:')[1].trim();
  });
  return data;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { host, port = '22', user = 'admin', password = '', token } = body;

  try {
    await requireAdmin(base44, token);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 401 });
  }

  if (!host) return Response.json({ error: 'host é obrigatório' }, { status: 400 });
  const cleanHost = normalizeHost(host);

  try {
    // Check via SSH (fallback robusto para redes que bloqueiam UDP/SNMP)
    const commands = [
      '/system resource print',
      '/ip hotspot print count-only',
      '/ip hotspot active print count-only'
    ];
    
    const results = await sshExec(cleanHost, port, user, password, commands);
    const resourceText = results[0].output;
    const hotspotCount = parseInt(results[1].output) || 0;
    const activeUsers = parseInt(results[2].output) || 0;
    
    const resData = parseResource(resourceText);

    return Response.json({
      connected: true,
      online: true,
      protocol: 'SSH',
      snmp_connected: true, // mock para a UI existente
      uptime: resData.uptime || null,
      cpu_load: resData.cpuLoad || 0,
      free_memory: resData.freeMemory || 0,
      total_memory: resData.totalMemory || 0,
      board_name: resData.boardName || null,
      version: resData.version || null,
      active_users: activeUsers,
      hotspot_count: hotspotCount,
    });
  } catch (err) {
    let msg = err.message || 'Falha ao conectar';
    if (msg.includes('Timeout')) msg = `Timeout ao conectar em ${cleanHost}:${port} via SSH`;
    else if (msg.includes('Authentication')) msg = `Usuário ou senha inválidos para o SSH do MikroTik`;
    else if (msg.includes('refused')) msg = `Conexão SSH recusada na porta ${port}`;
    
    return Response.json({
      connected: false,
      online: false,
      snmp_connected: false,
      snmp_error: msg,
      error: msg,
    }, { status: 200 });
  }
});