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
        cipher: ['aes256-cbc', 'aes128-cbc'],
        serverHostKey: ['ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512'],
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
    if (body.action === 'disconnect_vpn' && body.username_to_disconnect) {
       await sshExec(cleanHost, port, user, password, [`/ppp active remove [find name="${body.username_to_disconnect}"]`]);
       return Response.json({ success: true });
    }

    // Check via SSH (fallback robusto para redes que bloqueiam UDP/SNMP)
    const commands = [
      '/system resource print',
      '/ip hotspot print count-only',
      '/ip hotspot active print count-only',
      '/ppp active print detail without-paging',
      '/interface print stats-detail without-paging'
    ];
    
    // Log before connecting to help diagnose VPN routing issues
    console.log(`[MikrotikStatus] Tentando conectar SSH em ${cleanHost}:${port} com usuario ${user}`);
    const results = await sshExec(cleanHost, port, user, password, commands);
    const resourceText = results[0].output;
    const hotspotCount = parseInt(results[1].output) || 0;
    const activeUsers = parseInt(results[2].output) || 0;
    const pppText = results[3].output;
    const ifaceText = results[4].output;
    
    const resData = parseResource(resourceText);

    // Parse PPP
    const vpn_connections = [];
    pppText.split('\n').forEach(line => {
       if (line.includes('name=')) {
          const nameMatch = line.match(/name="([^"]+)"/);
          const addressMatch = line.match(/address=([\d\.]+)/);
          const uptimeMatch = line.match(/uptime=([\w\d]+)/);
          const serviceMatch = line.match(/service=([\w\d]+)/);
          if (nameMatch) {
             vpn_connections.push({
                name: nameMatch[1],
                address: addressMatch ? addressMatch[1] : '',
                uptime: uptimeMatch ? uptimeMatch[1] : '',
                service: serviceMatch ? serviceMatch[1] : ''
             });
          }
       }
    });

    // Parse Interfaces to get total rx/tx bytes
    let totalRx = 0;
    let totalTx = 0;
    ifaceText.split('\n').forEach(line => {
       if (line.includes('rx-byte=')) {
          const rxMatch = line.match(/rx-byte=([\d]+)/);
          const txMatch = line.match(/tx-byte=([\d]+)/);
          if (rxMatch) totalRx += parseInt(rxMatch[1]);
          if (txMatch) totalTx += parseInt(txMatch[1]);
       }
    });

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
      vpn_connections,
      total_rx_bytes: totalRx,
      total_tx_bytes: totalTx
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