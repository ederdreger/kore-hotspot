import { createClientFromRequest } from 'npm:@base44/sdk@0.8.29';
import { Client } from 'npm:ssh2@1.16.0';

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
        serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']
      },
    });
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const authUser = await base44.auth.me();

    if (!authUser || !['admin', 'manager'].includes(authUser.role)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { host, port, user, password, username, userPassword, profile, server = 'all' } = body;

    if (!host || !user || !username) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const cleanHost = String(host || '').trim().replace(/^ssh:\/\//i, '').replace(/^snmp:\/\//i, '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];

    const commands = [
      `/ip hotspot user remove [find name="${username}"]`,
      `/ip hotspot user add name="${username}" password="${userPassword || ''}" profile="${profile || 'default'}" server="${server}" comment="Criado via Cadastro Simplificado Kore"`
    ];

    const results = await sshExec(cleanHost, port, user, password, commands);

    return Response.json({ success: true, results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});