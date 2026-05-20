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
  const {
    host, port = '22', user: sshUser = 'admin', password = '', token,
    physical_interface = 'ether1',
    bridge_name = '',
    vlan_id = '',
    vlan_interface = 'vlan-hotspot',
    hotspot_network = '192.168.1.0/24',
    snmp_community = 'public',
    // RADIUS config
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

  const radiusName = 'Kore-HotSpot';
  const profileName = 'kore-hotspot-profile';
  const hotspotName = 'kore-hotspot';
  const finalHotspotInterface = vlan_id ? vlan_interface : (bridge_name || physical_interface);

  // Comandos detalhados e robustos para provisionamento completo (tudo automático)
  const commands = [
    // Limpeza de itens anteriores
    `/interface vlan remove [find where comment="Kore-HotSpot VLAN"]`,
    `/ip firewall filter remove [find where comment~"Kore-HotSpot allow"]`,
    `/radius remove [find where comment="${radiusName}"]`,
    `/ip hotspot remove [find where name="${hotspotName}"]`,
    `/ip hotspot profile remove [find where name="${profileName}"]`,
    
    // SSH e SNMP
    `/ip service set ssh disabled=no port=${port}`,
    `/snmp set enabled=yes contact="Kore-HotSpot" location="Hotspot" trap-version=2`,
    `/snmp community remove [find where name="${snmp_community}"]`,
    `/snmp community add name="${snmp_community}" addresses=0.0.0.0/0 read-access=yes write-access=no disabled=no`,
    
    // Firewall
    `/ip firewall filter add chain=input connection-state=established,related action=accept comment="Kore-HotSpot allow established" disabled=no`,
    `/ip firewall filter add chain=input protocol=udp dst-port=161 action=accept comment="Kore-HotSpot allow SNMP UDP 161" disabled=no`,
    `/ip firewall filter add chain=input protocol=tcp dst-port=${port} action=accept comment="Kore-HotSpot allow SSH" disabled=no`,
  ];

  if (bridge_name) {
    commands.push(`:if ([:len [/interface bridge find where name="${bridge_name}"]] = 0) do={ /interface bridge add name="${bridge_name}" protocol-mode=rstp comment="Kore-HotSpot bridge" disabled=no }`);
    commands.push(`:if ([:len [/interface bridge port find where interface="${physical_interface}" and bridge="${bridge_name}"]] = 0) do={ /interface bridge port remove [find where interface="${physical_interface}"]; /interface bridge port add bridge="${bridge_name}" interface="${physical_interface}" comment="Kore-HotSpot porta fisica" disabled=no }`);
  }

  if (vlan_id) {
    commands.push(`/interface vlan add name="${vlan_interface}" interface="${bridge_name || physical_interface}" vlan-id=${vlan_id} comment="Kore-HotSpot VLAN" disabled=no`);
  }

  // VPN Client (se habilitado)
  const { vpn_enabled, vpn_user, vpn_password } = body;
  if (vpn_enabled) {
    const settings = await base44.asServiceRole.entities.Setting.list().catch(() => []);
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    const vpnServerHost = map['vpn_server_host'] || '';
    const vpnIpsecSecret = map['vpn_ipsec_secret'] || '';

    commands.push(
      `/ppp profile remove [find where name="kore-vpn-profile"]`,
      `/ppp profile add name="kore-vpn-profile" use-upnp=no`,
      `/interface l2tp-client remove [find where name="l2tp-vpn"]`,
      `/interface l2tp-client add connect-to="${vpnServerHost}" name="l2tp-vpn" user="${vpn_user}" password="${vpn_password}" profile="kore-vpn-profile" use-ipsec=yes ipsec-secret="${vpnIpsecSecret}" disabled=no`,
      `/ip route remove [find where comment="Rota Radius via VPN"]`,
      `/ip route add dst-address=${rHost} gateway="l2tp-vpn" comment="Rota Radius via VPN"`
    );
  }

  // RADIUS e Hotspot
  commands.push(
    `/radius add service=hotspot address=${rHost} secret="${rSecret}" authentication-port=1812 accounting-port=1813 timeout=3s disabled=no comment="${radiusName}"`,
    `/ip hotspot profile add name="${profileName}" use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot`,
    `/ip hotspot add name="${hotspotName}" interface="${finalHotspotInterface}" profile="${profileName}" disabled=no`
  );

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