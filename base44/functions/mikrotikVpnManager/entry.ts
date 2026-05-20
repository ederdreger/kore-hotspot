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
    }, 60000);

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
      readyTimeout: 60000,
      algorithms: {
        cipher: ['aes256-cbc', 'aes128-cbc'],
        serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss']
      },
    });
  });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { action, server_host, server_port, server_user, server_password, username, password, remote_ip, ipsec_secret, token } = body;

  try {
    await requireAdmin(base44, token);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 401 });
  }

  if (!server_host) return Response.json({ error: 'host do servidor é obrigatório' }, { status: 400 });

  const commands = [];
  
  if (action === 'enable_server') {
    commands.push(`/ppp profile remove [find where name="kore-vpn-profile"]`);
    commands.push(`/ppp profile add name="kore-vpn-profile" use-upnp=no local-address="10.255.255.1"`);
    commands.push(`/interface l2tp-server server set enabled=yes use-ipsec=yes ipsec-secret="${ipsec_secret || 'vpn123'}" default-profile="kore-vpn-profile" authentication=mschap2`);
    commands.push(`/ip firewall filter remove [find where comment="KoreVPN - L2TP"]`);
    commands.push(`/ip firewall filter add chain=input protocol=udp dst-port=500,1701,4500 action=accept comment="KoreVPN - L2TP" place-before=0`);
    commands.push(`/ip firewall filter remove [find where comment="KoreVPN - IPsec"]`);
    commands.push(`/ip firewall filter add chain=input protocol=ipsec-esp action=accept comment="KoreVPN - IPsec" place-before=0`);
  } else if (action === 'add' || action === 'update') {
    commands.push(`/ppp profile remove [find where name="kore-vpn-profile"]`);
    commands.push(`/ppp profile add name="kore-vpn-profile" use-upnp=no local-address="10.255.255.1"`);
    commands.push(`/ppp secret remove [find name="${username}"]`);
    commands.push(`/ppp secret add name="${username}" password="${password}" local-address="10.255.255.1" remote-address="${remote_ip}" service=l2tp profile="kore-vpn-profile" comment="Criado por Kore-HotSpot"`);
  } else if (action === 'remove') {
    commands.push(`/ppp secret remove [find name="${username}"]`);
  }

  try {
    const cleanHost = normalizeHost(server_host);
    await sshExec(cleanHost, server_port, server_user, server_password, commands);
    return Response.json({ success: true });
  } catch (err) {
    let msg = err.message || 'Falha ao conectar via SSH';
    if (msg.includes('Timeout')) msg = `Timeout ao conectar em ${server_host} via SSH`;
    else if (msg.includes('Authentication')) msg = `Usuário ou senha inválidos no servidor matriz`;
    else if (msg.includes('refused')) msg = `Conexão SSH recusada na matriz`;
    return Response.json({ success: false, error: msg }, { status: 200 });
  }
});