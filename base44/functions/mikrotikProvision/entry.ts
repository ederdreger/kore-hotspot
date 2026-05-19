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

function sshExec(host, port, username, password, commands) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const results = [];
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error('Timeout SSH ao conectar em ' + host + ':' + port));
    }, 30000);

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
      host: normalizeHost(host),
      port: parseInt(port) || 22,
      username,
      password,
      tryKeyboard: true,
      readyTimeout: 12000,
      algorithms: {
        serverHostKey: ['ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512'],
      },
    });
  });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const {
    host, port = '22', user: sshUser = 'admin', password = '', token,
    hotspot_interface = 'ether1',
    hotspot_network = '192.168.1.0/24',
    // RADIUS config (read from Settings if not provided directly)
    radius_host, radius_secret,
  } = body;

  let adminUser;
  try {
    adminUser = await requireAdmin(base44, token);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 401 });
  }

  if (!host) return Response.json({ error: 'host é obrigatório' }, { status: 400 });

  // If radius_host not passed, load from Settings
  let rHost = radius_host;
  let rSecret = radius_secret;
  if (!rHost) {
    const settings = await base44.asServiceRole.entities.Setting.filter({ category: 'radius' }).catch(() => []);
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    rHost = map['radius_host'] || '127.0.0.1';
    rSecret = map['radius_secret'] || 'testing123';
  }

  // Commands to configure RADIUS on MikroTik via SSH
  const commands = [
    // Remove existing RADIUS config to avoid duplicates
    `/radius remove [find service=hotspot]`,
    // Add RADIUS server
    `/radius add service=hotspot address=${rHost} secret=${rSecret} authentication-port=1812 accounting-port=1813 timeout=3000`,
    // Configure hotspot to use RADIUS
    `/ip hotspot profile set [find] use-radius=yes`,
    // Ensure hotspot service is active on interface
    `/ip hotspot print`,
  ];

  try {
    const cleanHost = normalizeHost(host);
    const results = await sshExec(cleanHost, port, sshUser, password, commands);

    // Log to AuditLog
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'mikrotik_provision_radius',
      entity_type: 'mikrotik',
      entity_name: host,
      status: 'success',
      message: `RADIUS provisionado via SSH no MikroTik ${host} — servidor: ${rHost}`,
      performed_by: adminUser.email,
    }).catch(() => {});

    return Response.json({
      success: true,
      message: `RADIUS configurado com sucesso no MikroTik ${host}`,
      radius_server: rHost,
      steps: results.map(r => ({ cmd: r.cmd, output: r.output || 'OK' })),
    });
  } catch (err) {
    let msg = err.message;
    if (msg.includes('Timeout')) msg = `Timeout SSH em ${host}:${port}`;
    else if (msg.includes('refused')) msg = `SSH recusado em ${host}:${port}`;
    else if (msg.includes('Authentication')) msg = `Falha de autenticação SSH`;

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'mikrotik_provision_radius',
      entity_type: 'mikrotik',
      entity_name: host,
      status: 'error',
      message: `Erro ao provisionar RADIUS no MikroTik ${host}: ${msg}`,
      performed_by: adminUser.email,
    }).catch(() => {});

    return Response.json({ success: false, error: msg }, { status: 200 });
  }
});