import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { Client } from 'npm:ssh2@1.16.0';

function sshExec(host, port, username, password, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error('Timeout SSH ao conectar em ' + host + ':' + port));
    }, 10000);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        stream.on('data', d => { output += d.toString(); });
        stream.stderr.on('data', () => {});
        stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(output.trim()); });
      });
    });

    conn.on('error', err => { clearTimeout(timer); reject(err); });

    conn.connect({ host, port: parseInt(port) || 22, username, password, readyTimeout: 8000 });
  });
}

// Parse RouterOS print output into key-value object
function parsePrint(output) {
  const result = {};
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*([\w-]+):\s*(.+)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { host, port = '22', user: sshUser = 'admin', password = '' } = body;

  if (!host) return Response.json({ error: 'host é obrigatório' }, { status: 400 });

  try {
    // Fetch system resources and hotspot active users in sequence
    const resOutput = await sshExec(host, port, sshUser, password,
      '/system resource print');
    const res = parsePrint(resOutput);

    let activeUsers = 0;
    let hotspotCount = 0;
    try {
      const hotOutput = await sshExec(host, port, sshUser, password,
        '/ip hotspot active print count-only');
      activeUsers = parseInt(hotOutput) || 0;
    } catch (_) {}
    try {
      const hotspotList = await sshExec(host, port, sshUser, password,
        '/ip hotspot print count-only');
      hotspotCount = parseInt(hotspotList) || 0;
    } catch (_) {}

    return Response.json({
      uptime: res['uptime'] || null,
      cpu_load: parseInt(res['cpu-load']) || 0,
      free_memory: parseInt(res['free-memory']) || null,
      total_memory: parseInt(res['total-memory']) || null,
      temperature: res['cpu-temperature'] ? parseInt(res['cpu-temperature']) : null,
      board_name: res['board-name'] || null,
      version: res['version'] || null,
      active_users: activeUsers,
      hotspot_count: hotspotCount,
    });
  } catch (err) {
    let msg = err.message;
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      msg = `Timeout SSH em ${host}:${port} — verifique se a porta SSH está aberta e acessível`;
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