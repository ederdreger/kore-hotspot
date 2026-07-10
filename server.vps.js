const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8081);
const TOKEN = process.env.KORE_VPN_API_TOKEN || 'kore-vpn-api-2026';
const DEFAULT_ADMIN_PASSWORD = process.env.KORE_ADMIN_PASSWORD || 'Admin12345';
const CHAP = '/etc/ppp/chap-secrets';
const KEY_DIR = '/opt/kore-hotspot-vpn-api/keys';
const KEY_PATH = path.join(KEY_DIR, 'kore-api_rsa');
const PUB_PATH = `${KEY_PATH}.pub`;
const DATA_DIR = '/opt/kore-hotspot-vpn-api/data';
const CAPTIVE_DB = path.join(DATA_DIR, 'captive-prospects.json');
const ENTITY_FILES = {
  admins: path.join(DATA_DIR, 'admin-users.json'),
  admin_sessions: path.join(DATA_DIR, 'admin-sessions.json'),
  clients: path.join(DATA_DIR, 'clients.json'),
  plans: path.join(DATA_DIR, 'plans.json'),
  vouchers: path.join(DATA_DIR, 'vouchers.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  payments: path.join(DATA_DIR, 'payments.json')
};
const DEFAULT_ADMINS = [
  { email: 'demo@spedynet.com.br', full_name: 'Administrador Demo', role: 'admin' },
  { email: 'spedynet@spedynet.com.br', full_name: 'Administrador Spedynet', role: 'admin' }
];
const radiusRateCache = new Map();

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Kore-Token',
    ...headers
  });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

function hotspotLoginHtml() {
  const portal = `${process.env.KORE_PUBLIC_URL || 'http://190.8.174.155:8080'}/captive-portal`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kore-HotSpot</title>
  <meta http-equiv="refresh" content="0; url=${portal}?mac=$(mac)&ip=$(ip)&username=$(username)&link-login=$(link-login-only)&link-orig=$(link-orig)&error=$(error)">
  <script>
    window.location.replace('${portal}?mac=$(mac)&ip=$(ip)&username=$(username)&link-login=$(link-login-only)&link-orig=$(link-orig)&error=$(error)');
  </script>
</head>
<body style="margin:0;background:#0b111d;color:#e5eefc;font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">
  <main>
    <h1>Kore-HotSpot</h1>
    <p>Redirecionando para o portal...</p>
    <p><a style="color:#17d9f5" href="${portal}?mac=$(mac)&ip=$(ip)&username=$(username)&link-login=$(link-login-only)&link-orig=$(link-orig)&error=$(error)">Abrir portal</a></p>
  </main>
</body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
  });
}

function run(command, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr || stdout || error.message;
        reject(new Error(message.includes('Permission denied') ? 'SSH negado pelo MikroTik: chave, usuario, senha ou permissoes invalidas' : message));
      } else resolve({ stdout, stderr });
    });
  });
}

async function ensureSshKey() {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(KEY_PATH) || !fs.existsSync(PUB_PATH)) {
    await run('ssh-keygen', ['-t', 'rsa', '-b', '2048', '-f', KEY_PATH, '-N', '', '-C', 'kore-api@kore-hotspot'], 10000);
  }
  fs.chmodSync(KEY_PATH, 0o600);
  fs.chmodSync(PUB_PATH, 0o644);
}

function validToken(req) {
  return req.headers['x-kore-token'] === TOKEN;
}

function normalizeUser(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.@-]/g, '');
}

function normalizeRemoteIp(value) {
  const ip = String(value || '').trim();
  if (!/^10\.255\.255\.([1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(ip)) {
    throw new Error('remote_ip deve estar na rede 10.255.255.1-254');
  }
  return ip;
}

async function ensureUser({ username, password, remote_ip }) {
  const user = normalizeUser(username);
  const pass = String(password || '').trim();
  const ip = normalizeRemoteIp(remote_ip);

  if (!user) throw new Error('username obrigatorio');
  if (!pass) throw new Error('password obrigatorio');

  if (!fs.existsSync(CHAP)) fs.writeFileSync(CHAP, '', { mode: 0o600 });
  const lines = fs.readFileSync(CHAP, 'utf8').split(/\r?\n/).filter(Boolean);
  const filtered = lines.filter(line => {
    const clean = line.trim();
    const parts = clean.split(/\s+/);
    const lineIp = parts[3] || '*';
    return lineIp !== ip && !clean.startsWith(`${user} `) && !clean.startsWith(`"${user}" `);
  });
  filtered.push(`${user} * ${pass} ${ip}`);
  fs.writeFileSync(CHAP, `${filtered.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(CHAP, 0o600);
  await run('systemctl', ['restart', 'xl2tpd']);
  return { success: true, username: user, remote_ip: ip };
}

async function listUsers() {
  if (!fs.existsSync(CHAP)) return [];
  return fs.readFileSync(CHAP, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const parts = line.split(/\s+/);
      return { username: parts[0].replace(/^"|"$/g, ''), remote_ip: parts[3] || '*' };
    });
}

function secondsToUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const clock = [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${clock}` : clock;
}

function readNumber(file) {
  try { return Number(fs.readFileSync(file, 'utf8').trim()) || 0; } catch { return 0; }
}

async function pppStartsByPeer() {
  const { stdout } = await run('ps', ['-eo', 'pid,lstart,cmd'], 5000);
  const starts = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('/usr/sbin/pppd')) continue;
    const match = line.match(/^\s*\d+\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+.*?10\.255\.255\.1:(10\.255\.255\.\d+)/);
    if (!match) continue;
    const startedAt = new Date(`${match[1]} UTC`).getTime();
    if (!Number.isNaN(startedAt)) starts.set(match[2], startedAt);
  }
  return starts;
}

async function vpnStatus() {
  const users = await listUsers();
  const userByIp = new Map(users.map(user => [user.remote_ip, user.username]));
  const starts = await pppStartsByPeer().catch(() => new Map());
  const { stdout } = await run('ip', ['-o', '-4', 'addr', 'show'], 5000);
  let totalRx = 0;
  let totalTx = 0;

  const connections = stdout.split(/\r?\n/)
    .filter(line => /\sppp\d+\s/.test(line) && line.includes(' peer '))
    .map(line => {
      const iface = line.match(/\d+:\s+(ppp\d+)/)?.[1] || 'ppp';
      const peer = line.match(/ peer ([0-9.]+)\//)?.[1] || '';
      const rx = readNumber(`/sys/class/net/${iface}/statistics/rx_bytes`);
      const tx = readNumber(`/sys/class/net/${iface}/statistics/tx_bytes`);
      let startedAt = starts.get(peer);
      if (!startedAt) {
        try { startedAt = fs.statSync("/sys/class/net/" + iface).mtimeMs; } catch {}
      }
      totalRx += rx;
      totalTx += tx;
      return {
        name: userByIp.get(peer) || peer || iface,
        address: peer,
        service: 'l2tp',
        uptime: startedAt ? secondsToUptime((Date.now() - startedAt) / 1000) : '--',
        interface: iface,
        rx_bytes: rx,
        tx_bytes: tx
      };
    });

  return {
    connected: true,
    online: true,
    cpu_load: 0,
    total_rx_bytes: totalRx,
    total_tx_bytes: totalTx,
    vpn_connections: connections
  };
}

async function radiusStatus() {
  const candidates = ['freeradius', 'radiusd'];
  for (const service of candidates) {
    const active = await run('systemctl', ['is-active', service], 5000).then(r => r.stdout.trim()).catch(() => 'inactive');
    const enabled = await run('systemctl', ['is-enabled', service], 5000).then(r => r.stdout.trim()).catch(() => 'disabled');
    if (active === 'active') {
      return { status: 'online', label: 'Operante', detail: `${service} ativo na VPS`, service, enabled };
    }
    if (enabled !== 'disabled') {
      return { status: 'offline', label: 'Inativo', detail: `${service} instalado, mas ${active}`, service, enabled };
    }
  }
  return { status: 'offline', label: 'Não instalado', detail: 'VPN atual autentica por chap-secrets', service: null, enabled: 'disabled' };
}

function parseKeyValueRows(output) {
  const records = [];
  let current = '';
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^Flags:|^Columns:/i.test(line)) continue;
    if (/^\d+\s/.test(line) || /^[A-Z ]+\d+\s/.test(line)) {
      if (current) records.push(current);
      current = line;
    } else if (current) {
      current += ` ${line}`;
    }
  }
  if (current) records.push(current);
  const lines = records.length ? records : String(output || '').split(/\r?\n/);
  return lines.map(line => {
    const row = {};
    for (const match of line.matchAll(/(\S+)=("[^"]*"|\S*)/g)) {
      row[match[1]] = String(match[2] || '').replace(/^"|"$/g, '');
    }
    return row;
  }).filter(row => Object.keys(row).length);
}

function mbFromBytes(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}

function rateToMbps(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  const match = text.match(/([\d.]+)\s*([kmgt]?)(?:bps|b\/s)?/);
  if (!match) return Number(text) || 0;
  const number = Number(match[1]) || 0;
  const unit = match[2];
  if (unit === 'k') return number / 1000;
  if (unit === 'm' || unit === '') return number;
  if (unit === 'g') return number * 1000;
  if (unit === 't') return number * 1000 * 1000;
  return number;
}

function enrichRadiusSession(session) {
  const clients = readJson(ENTITY_FILES.clients, []);
  const prospects = readCaptiveDb();
  const plans = readJson(ENTITY_FILES.plans, []);
  const mac = normalizeMac(session.macAddress);
  const ip = normalizeClientIp(session.framedIp);
  const user = normalizeText(session.username);
  const client = clients.find(item =>
    normalizeText(item.radius_username || item.username || item.email) === user ||
    normalizeMac(item.mac_address) === mac ||
    normalizeClientIp(item.ip_address) === ip
  );
  const prospect = !client ? prospects.find(item =>
    normalizeMac(item.mac_address) === mac ||
    normalizeClientIp(item.ip_address) === ip ||
    normalizeText(item.radius_username) === user
  ) : null;
  const account = client || prospect || null;
  const plan = plans.find(item => (item.id || item._id) === account?.plan_id) ||
    plans.find(item => normalizeText(item.name) === normalizeText(account?.plan_name || session.planName));
  return {
    ...session,
    fullName: account?.name || session.fullName || '-',
    planName: account?.plan_name || plan?.name || session.planName || '-',
    planId: account?.plan_id || plan?.id || plan?._id || session.planId || '',
    downloadLimit: Number(account?.download_mbps ?? plan?.download_mbps ?? session.downloadLimit ?? 0),
    uploadLimit: Number(account?.upload_mbps ?? plan?.upload_mbps ?? session.uploadLimit ?? 0),
    downloadRate: Number(session.downloadRate ?? 0),
    uploadRate: Number(session.uploadRate ?? 0),
    quotaGb: Number(account?.quota_gb ?? plan?.quota_gb ?? session.quotaGb ?? 0)
  };
}

async function radiusSqlSessions() {
  const query = 'SELECT username,framedipaddress,callingstationid,nasipaddress,acctsessiontime,acctinputoctets,acctoutputoctets,acctstarttime FROM radacct WHERE acctstoptime IS NULL ORDER BY acctstarttime DESC LIMIT 200';
  const { stdout } = await run('mysql', ['-N', '-B', '-e', query], 8000);
  return stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const [username, framedIp, macAddress, nasIp, seconds, inputOctets, outputOctets, startedAt] = line.split('\t');
    return enrichRadiusSession({
      id: `radius-${username}-${framedIp}-${index}`,
      username: username || '-',
      framedIp: framedIp || '-',
      macAddress: normalizeMac(macAddress) || macAddress || '-',
      nasIp: nasIp || '-',
      sessionTime: secondsToUptime(Number(seconds || 0)),
      downloadMb: mbFromBytes(outputOctets),
      uploadMb: mbFromBytes(inputOctets),
      downloadRate: 0,
      uploadRate: 0,
      quotaGb: 0,
      status: 'active',
      source: 'freeradius',
      startedAt
    });
  });
}

function getMikrotikDevices() {
  const settings = readJson(ENTITY_FILES.settings, []);
  return settings
    .filter(item => item.category === 'mikrotik_device')
    .map(item => {
      try { return { id: item.id || item._id, ...JSON.parse(item.value || '{}') }; } catch { return null; }
    })
    .filter(item => item?.host);
}

async function mikrotikHotspotSessions() {
  const devices = getMikrotikDevices();
  if (!devices.length) return [];
  const sessions = [];
  await ensureSshKey();
  for (const device of devices.slice(0, 5)) {
    const sshBase = ['-i', KEY_PATH, '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(device.port || '22'), `${device.user || 'kore-api'}@${device.host}`];
    let active = await run('ssh', [...sshBase, '/ip hotspot active print stats detail without-paging'], 12000).catch(() => ({ stdout: '' }));
    if (!parseKeyValueRows(active.stdout).length) {
      active = await run('ssh', [...sshBase, '/ip hotspot active print detail without-paging'], 12000).catch(() => ({ stdout: '' }));
    }
    for (const [index, row] of parseKeyValueRows(active.stdout).entries()) {
      const ip = row.address || row['to-address'] || '';
      const mac = row['mac-address'] || '';
      const bytesOut = row['bytes-out'] || row['bytes-out64'] || row['tx-bytes'] || row['tx-byte'];
      const bytesIn = row['bytes-in'] || row['bytes-in64'] || row['rx-bytes'] || row['rx-byte'];
      sessions.push(enrichRadiusSession({
        id: `mt-${device.id || device.host}-${ip || mac || index}`,
        username: row.user || row.login || ip || mac || '-',
        framedIp: ip || '-',
        macAddress: normalizeMac(mac) || mac || '-',
        nasIp: device.host,
        sessionTime: row.uptime || row['idle-time'] || '-',
        downloadMb: mbFromBytes(bytesOut),
        uploadMb: mbFromBytes(bytesIn),
        downloadRate: rateToMbps(row['tx-rate'] || row['rate-out'] || row['output-rate']),
        uploadRate: rateToMbps(row['rx-rate'] || row['rate-in'] || row['input-rate']),
        quotaGb: 0,
        status: 'active',
        source: 'mikrotik',
        deviceName: device.name || device.host
      }));
    }
  }
  return sessions;
}

async function radiusSessions() {
  const [status, sql, mikrotik] = await Promise.all([
    radiusStatus().catch(error => ({ status: 'offline', error: error.message })),
    radiusSqlSessions().catch(() => []),
    mikrotikHotspotSessions().catch(() => [])
  ]);
  const byKey = new Map();
  for (const session of [...sql, ...mikrotik]) {
    const key = `${normalizeText(session.username)}-${normalizeClientIp(session.framedIp)}-${normalizeMac(session.macAddress)}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, session);
      continue;
    }
    byKey.set(key, {
      ...current,
      ...session,
      fullName: current.fullName !== '-' ? current.fullName : session.fullName,
      planName: current.planName !== '-' ? current.planName : session.planName,
      downloadMb: Math.max(Number(current.downloadMb || 0), Number(session.downloadMb || 0)),
      uploadMb: Math.max(Number(current.uploadMb || 0), Number(session.uploadMb || 0)),
      sessionTime: current.sessionTime && current.sessionTime !== '-' ? current.sessionTime : session.sessionTime
    });
  }

  const now = Date.now();
  const sessions = [...byKey.values()].map(session => {
    const key = `${normalizeClientIp(session.framedIp)}-${normalizeMac(session.macAddress) || normalizeText(session.username)}`;
    const rxBytes = Number(session.downloadMb || 0) * 1024 * 1024;
    const txBytes = Number(session.uploadMb || 0) * 1024 * 1024;
    const previous = radiusRateCache.get(key);
    let downloadRate = Number(session.downloadRate || 0);
    let uploadRate = Number(session.uploadRate || 0);
    if (previous && now > previous.time) {
      const seconds = (now - previous.time) / 1000;
      downloadRate = Math.max(downloadRate, ((rxBytes - previous.rxBytes) * 8) / seconds / 1000 / 1000);
      uploadRate = Math.max(uploadRate, ((txBytes - previous.txBytes) * 8) / seconds / 1000 / 1000);
    }
    radiusRateCache.set(key, { time: now, rxBytes, txBytes });
    return {
      ...session,
      downloadRate: Number(downloadRate.toFixed(2)),
      uploadRate: Number(uploadRate.toFixed(2))
    };
  });
  return { success: true, status, sessions };
}

function parseRouterValue(output, key) {
  const match = output.match(new RegExp(`${key}=([^\\r\\n]+)`));
  return match ? match[1].trim() : null;
}

function parseRouterNumber(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([\d.]+)\s*([KMGT]?i?B)?$/i);
  if (!match) return Number(text) || 0;
  const number = Number(match[1]) || 0;
  const unit = String(match[2] || '').toLowerCase();
  if (unit.startsWith('k')) return Math.round(number * 1024);
  if (unit.startsWith('m')) return Math.round(number * 1024 * 1024);
  if (unit.startsWith('g')) return Math.round(number * 1024 * 1024 * 1024);
  if (unit.startsWith('t')) return Math.round(number * 1024 * 1024 * 1024 * 1024);
  return number;
}

async function mikrotikStatus({ host, port = '22', user = 'kore-api', password = '', auth_method = 'key', interface_name = '', physical_interface = '', hotspot_interface = '' }) {
  const target = String(host || '').trim();
  if (!target) throw new Error('host obrigatorio');
  const trafficInterface = String(interface_name || hotspot_interface || physical_interface || 'ether1').replace(/"/g, '');

  const command = `:put ("uptime=" . [/system resource get uptime]); :put ("version=" . [/system resource get version]); :put ("board-name=" . [/system resource get board-name]); :put ("free-memory=" . [/system resource get free-memory]); :put ("total-memory=" . [/system resource get total-memory]); :put ("active-users=" . [/ip hotspot active print count-only]); :put ("ppp-active=" . [/ppp active print count-only]); :do { /interface monitor-traffic interface="${trafficInterface}" once do={ :put ("rx-bps=" . $"rx-bits-per-second"); :put ("tx-bps=" . $"tx-bits-per-second") } } on-error={ :put "rx-bps=0"; :put "tx-bps=0" }; :delay 2s; :put ("cpu-load=" . [/system resource get cpu-load])`;

  let stdout;
  if (auth_method === 'password') {
    if (!password) throw new Error('senha SSH obrigatoria');
    ({ stdout } = await run('sshpass', ['-p', String(password), 'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no', '-o', 'NumberOfPasswordPrompts=1', '-p', String(port || '22'), `${user || 'kore-api'}@${target}`, command], 15000));
  } else {
    await ensureSshKey();
    ({ stdout } = await run('ssh', ['-i', KEY_PATH, '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${target}`, command], 15000));
  }

  const freeMemory = parseRouterNumber(parseRouterValue(stdout, 'free-memory'));
  const totalMemory = parseRouterNumber(parseRouterValue(stdout, 'total-memory'));
  const rxBps = Number(parseRouterValue(stdout, 'rx-bps')) || 0;
  const txBps = Number(parseRouterValue(stdout, 'tx-bps')) || 0;
  return {
    connected: true,
    online: true,
    host: target,
    protocol: auth_method === 'password' ? 'SSH Password' : 'SSH Key',
    uptime: parseRouterValue(stdout, 'uptime'),
    version: parseRouterValue(stdout, 'version'),
    board_name: parseRouterValue(stdout, 'board-name'),
    cpu_load: Number(parseRouterValue(stdout, 'cpu-load')) || 0,
    free_memory: freeMemory,
    total_memory: totalMemory,
    used_memory: totalMemory && freeMemory ? totalMemory - freeMemory : 0,
    memory_used_percent: totalMemory && freeMemory ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100) : 0,
    traffic_interface: trafficInterface,
    rx_bps: rxBps,
    tx_bps: txBps,
    rx_mbps: Number((txBps / 1000 / 1000).toFixed(3)),
    tx_mbps: Number((rxBps / 1000 / 1000).toFixed(3)),
    active_users: Number(parseRouterValue(stdout, 'active-users')) || 0,
    hotspot_count: Number(parseRouterValue(stdout, 'active-users')) || 0,
    ppp_active: Number(parseRouterValue(stdout, 'ppp-active')) || 0,
    raw: stdout
  };
}

async function mikrotikSyncPlans({ host, port = '22', user = 'kore-api' }) {
  const target = String(host || '').trim();
  if (!target) throw new Error('host obrigatorio');
  const plans = readJson(ENTITY_FILES.plans, []).filter(plan => (plan.status || 'active') === 'active');
  const commands = plans.map(plan => {
    const rawName = plan.mikrotik_profile_name || `kore-${String(plan.name || 'plano').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const name = rawName.replace(/"/g, '');
    const rate = planRateLimit(plan);
    if (!rate) return '';
    return `:do { /ip hotspot user profile remove [find where name=${name}] } on-error={}; /ip hotspot user profile add name=${name} rate-limit=${rate} shared-users=1`;
  }).filter(Boolean);
  if (!commands.length) return { success: true, applied: 0, message: 'Nenhum plano com velocidade para sincronizar' };

  await ensureSshKey();
  const command = `${commands.join('; ')}; /ip hotspot user profile print detail where name~"kore-"`;
  const { stdout } = await run('ssh', ['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${target}`, command], 20000);
  return { success: true, applied: commands.length, raw: stdout };
}


function normalizeMac(value) {
  const clean = String(value || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  const mac = clean.length === 12 ? clean.match(/.{1,2}/g).join(':') : String(value || '').trim().toUpperCase().replace(/-/g, ':');
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) ? mac : '';
}

function normalizeClientIp(value) {
  const ip = String(value || '').trim();
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? ip : '';
}

function readCaptiveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CAPTIVE_DB)) fs.writeFileSync(CAPTIVE_DB, '[]');
  try { return JSON.parse(fs.readFileSync(CAPTIVE_DB, 'utf8')); } catch { return []; }
}

function writeCaptiveDb(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CAPTIVE_DB, JSON.stringify(items, null, 2));
}

function readJson(file, fallback = []) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!String(stored).includes(':')) return stored === password;
  const [salt, expected] = String(stored).split(':');
  const actual = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function publicAdmin(user) {
  if (!user) return null;
  const { password, password_hash, ...safeUser } = user;
  return safeUser;
}

function ensureDefaultAdmins({ resetPassword = false } = {}) {
  const users = readJson(ENTITY_FILES.admins, []);
  let changed = false;
  for (const admin of DEFAULT_ADMINS) {
    const email = normalizeEmail(admin.email);
    const existing = users.find(user => normalizeEmail(user.email) === email);
    if (!existing) {
      const id = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      users.push({
        id,
        _id: id,
        ...admin,
        email,
        status: 'active',
        permissions: ['*'],
        password_hash: passwordHash(DEFAULT_ADMIN_PASSWORD),
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString()
      });
      changed = true;
    } else {
      existing.role = 'admin';
      existing.status = 'active';
      existing.permissions = ['*'];
      existing.updated_date = new Date().toISOString();
      if (resetPassword || (!existing.password_hash && !existing.password)) {
        existing.password_hash = passwordHash(DEFAULT_ADMIN_PASSWORD);
        delete existing.password;
      }
      changed = true;
    }
  }
  if (changed) writeJson(ENTITY_FILES.admins, users);
  return users;
}

function createAdminSession(user) {
  const sessions = readJson(ENTITY_FILES.admin_sessions, []);
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session = {
    id,
    _id: id,
    token: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString('hex'),
    admin_user_id: user.id || user._id,
    email: user.email,
    role: user.role,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    created_date: new Date().toISOString()
  };
  writeJson(ENTITY_FILES.admin_sessions, [session, ...sessions].slice(0, 5000));
  return session;
}

function getAdminSession(token) {
  const sessions = readJson(ENTITY_FILES.admin_sessions, []);
  const session = sessions.find(item => item.token === token);
  if (!session || new Date(session.expires_at) < new Date()) return null;
  return session;
}

async function adminAuth(payload = {}) {
  const action = payload.action || 'login';
  if (action === 'resetDefaults') {
    const users = ensureDefaultAdmins({ resetPassword: true });
    writeJson(ENTITY_FILES.admin_sessions, []);
    return { success: true, email: DEFAULT_ADMINS.map(user => user.email).join(' / '), password: DEFAULT_ADMIN_PASSWORD, users: users.map(publicAdmin) };
  }

  ensureDefaultAdmins();
  const users = readJson(ENTITY_FILES.admins, []);

  if (action === 'login') {
    const email = normalizeEmail(payload.email);
    const admin = users.find(user => normalizeEmail(user.email) === email);
    if (!admin || admin.status === 'inactive' || !verifyPassword(payload.password, admin.password_hash || admin.password)) {
      throw Object.assign(new Error('E-mail ou senha invalidos'), { status: 401 });
    }
    const session = createAdminSession(admin);
    return { token: session.token, user: publicAdmin(admin) };
  }

  if (action === 'validate') {
    const session = getAdminSession(payload.token);
    if (!session) throw Object.assign(new Error('Sessao expirada'), { status: 401 });
    const admin = users.find(user => user.id === session.admin_user_id || user._id === session.admin_user_id);
    return { user: publicAdmin(admin) };
  }

  if (action === 'logout') {
    const sessions = readJson(ENTITY_FILES.admin_sessions, []);
    writeJson(ENTITY_FILES.admin_sessions, sessions.filter(session => session.token !== payload.token));
    return { success: true };
  }

  const session = getAdminSession(payload.token);
  if (!session) throw Object.assign(new Error('Sessao expirada'), { status: 401 });

  if (action === 'listUsers') return { users: users.map(publicAdmin) };

  if (action === 'createUser') {
    const email = normalizeEmail(payload.email);
    if (!email) throw Object.assign(new Error('E-mail obrigatorio'), { status: 400 });
    if (users.some(user => normalizeEmail(user.email) === email)) {
      throw Object.assign(new Error('Ja existe usuario com este e-mail'), { status: 409 });
    }
    if (!payload.password) throw Object.assign(new Error('Senha obrigatoria'), { status: 400 });
    const permissions = payload.role === 'admin' ? ['*'] : (Array.isArray(payload.permissions) ? payload.permissions : []);
    const id = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const user = {
      id,
      _id: id,
      email,
      full_name: payload.full_name || payload.email,
      role: payload.role || 'user',
      status: payload.role === 'inactive' ? 'inactive' : 'active',
      permissions,
      password_hash: passwordHash(payload.password),
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    writeJson(ENTITY_FILES.admins, [user, ...users]);
    return { user: publicAdmin(user) };
  }

  if (action === 'updateUser') {
    const target = users.find(user => user.id === payload.userId || user._id === payload.userId);
    if (!target) throw Object.assign(new Error('Usuario nao encontrado'), { status: 404 });
    const nextRole = payload.role || target.role;
    const nextPermissions = nextRole === 'admin' ? ['*'] : (Array.isArray(payload.permissions) ? payload.permissions : (target.permissions || []));
    const updated = users.map(user => {
      if (user.id !== payload.userId && user._id !== payload.userId) return user;
      return {
        ...user,
        full_name: payload.full_name || user.full_name,
        role: nextRole,
        status: nextRole === 'inactive' ? 'inactive' : 'active',
        permissions: nextPermissions,
        password_hash: payload.newPassword ? passwordHash(payload.newPassword) : (user.password_hash || passwordHash(user.password || DEFAULT_ADMIN_PASSWORD)),
        password: undefined,
        updated_date: new Date().toISOString()
      };
    });
    writeJson(ENTITY_FILES.admins, updated);
    return { success: true };
  }

  if (action === 'deleteUser') {
    const target = users.find(user => user.id === payload.userId || user._id === payload.userId);
    if (!target) throw Object.assign(new Error('Usuario nao encontrado'), { status: 404 });
    if (target.id === session.admin_user_id || target._id === session.admin_user_id) {
      throw Object.assign(new Error('Nao e permitido excluir o usuario logado'), { status: 400 });
    }
    const activeAdmins = users.filter(user => user.role === 'admin' && user.status !== 'inactive');
    if (target.role === 'admin' && activeAdmins.length <= 1) {
      throw Object.assign(new Error('Nao e permitido excluir o ultimo administrador ativo'), { status: 400 });
    }
    const nextUsers = users.filter(user => user.id !== payload.userId && user._id !== payload.userId);
    const sessions = readJson(ENTITY_FILES.admin_sessions, []);
    writeJson(ENTITY_FILES.admins, nextUsers);
    writeJson(ENTITY_FILES.admin_sessions, sessions.filter(item => item.admin_user_id !== target.id && item.admin_user_id !== target._id));
    return { success: true };
  }

  throw new Error('Acao invalida');
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatCpf(value) {
  const digits = normalizeDigits(value);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function publicPlan(plan) {
  const trialMinutes = Number(plan.trial_duration_minutes || 30);
  return {
    id: plan.id || plan._id,
    _id: plan._id || plan.id,
    name: plan.name,
    description: plan.description || '',
    download_mbps: Number(plan.download_mbps ?? plan.speed_download ?? 0),
    upload_mbps: Number(plan.upload_mbps ?? plan.speed_upload ?? 0),
    price: Number(plan.price || 0),
    plan_type: planType(plan),
    validity_days: Number(plan.validity_days ?? plan.duration_days ?? 30),
    is_trial: !!plan.is_trial,
    trial_duration_minutes: trialMinutes,
    trial_duration_hours: Number((trialMinutes / 60).toFixed(2)),
    status: plan.status || 'active',
    color: plan.color || '#00E5FF'
  };
}

function getSetting(key) {
  const settings = readJson(ENTITY_FILES.settings, []);
  return settings.find(item => item.key === key)?.value || '';
}

function summarizeIxcClient(cliente, cpf) {
  if (!cliente) return { name: '', cpf, phone: '' };
  return {
    name: cliente.razao || cliente.nome || cliente.fantasia || '',
    cpf: cliente.cnpj_cpf || cliente.cpf_cnpj || cliente.cpf || formatCpf(cpf),
    phone: cliente.telefone_celular || cliente.whatsapp || cliente.fone || cliente.telefone_comercial || ''
  };
}

function getPublicBaseUrl() {
  return String(getSetting('public_base_url') || 'http://190.8.174.155:8081').replace(/\/+$/, '');
}

function upsertById(file, item) {
  const items = readJson(file, []);
  const id = item.id || item._id;
  const next = [item, ...items.filter(existing => existing.id !== id && existing._id !== id)];
  writeJson(file, next.slice(0, 5000));
  return item;
}

function paidPlan(plan) {
  const type = normalizeText(plan?.plan_type || plan?.type);
  return type === 'paid' || (Number(plan?.price || 0) > 0 && !plan?.is_trial && type !== 'free');
}

function freePlan(plan) {
  const type = normalizeText(plan?.plan_type || plan?.type);
  return type === 'free' || (Number(plan?.price || 0) <= 0 && !plan?.is_trial && type !== 'paid');
}

function planValidityMinutes(plan) {
  return Math.max(1, Number(plan?.validity_days || 30) * 24 * 60);
}

function planType(plan) {
  const type = normalizeText(plan?.plan_type || plan?.type);
  if (type === 'paid' || type === 'free' || type === 'trial') return type;
  if (plan?.is_trial) return 'trial';
  return Number(plan?.price || 0) > 0 ? 'paid' : 'free';
}

function planSpeedFields(plan) {
  return {
    plan_type: planType(plan),
    download_mbps: Number(plan?.download_mbps ?? plan?.speed_download ?? 0),
    upload_mbps: Number(plan?.upload_mbps ?? plan?.speed_upload ?? 0),
    speed_download: Number(plan?.download_mbps ?? plan?.speed_download ?? 0),
    speed_upload: Number(plan?.upload_mbps ?? plan?.speed_upload ?? 0),
    quota_gb: Number(plan?.quota_gb || 0)
  };
}

function whatsappLink({ phone, message }) {
  const digits = normalizeDigits(phone);
  if (!digits) return '';
  const brPhone = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${brPhone}?text=${encodeURIComponent(message || '')}`;
}

function routerQuote(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function entityNameFromUrl(url) {
  const parts = url.split('/').filter(Boolean);
  const entity = parts[2];
  if (!ENTITY_FILES[entity]) return null;
  return { entity, id: decodeURIComponent(parts[3] || '') };
}

async function entityCrud(req) {
  const parsed = entityNameFromUrl(req.url);
  if (!parsed) return null;
  const file = ENTITY_FILES[parsed.entity];
  const items = readJson(file, []);

  if (req.method === 'GET') return { items };

  if (req.method === 'POST') {
    const body = await readBody(req);
    const id = body.id || body._id || `${parsed.entity}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item = {
      ...body,
      id,
      _id: body._id || id,
      created_date: body.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    const filtered = items.filter(existing => existing.id !== id && existing._id !== id);
    filtered.unshift(item);
    writeJson(file, filtered.slice(0, 5000));
    return { item };
  }

  if (req.method === 'PUT' && parsed.id) {
    const body = await readBody(req);
    const updated = items.map(item => (
      item.id === parsed.id || item._id === parsed.id ? { ...item, ...body, updated_date: new Date().toISOString() } : item
    ));
    writeJson(file, updated);
    return { item: updated.find(item => item.id === parsed.id || item._id === parsed.id) || null };
  }

  if (req.method === 'DELETE' && parsed.id) {
    const removedItem = items.find(item => item.id === parsed.id || item._id === parsed.id);
    if (parsed.entity === 'clients' && removedItem) {
      await cleanupMikrotikAccess(removedItem).catch(error => ({ error: error.message }));
    }
    writeJson(file, items.filter(item => item.id !== parsed.id && item._id !== parsed.id));
    return { success: true };
  }

  return null;
}

function planRateLimit(plan = {}) {
  const download = Number(plan.download_mbps ?? plan.speed_download ?? plan.downloadLimit ?? 0);
  const upload = Number(plan.upload_mbps ?? plan.speed_upload ?? plan.uploadLimit ?? 0);
  if (!download && !upload) return '';
  return `${Math.max(upload, 1)}M/${Math.max(download, 1)}M`;
}

function hotspotProfileName(plan = {}) {
  const raw = plan.mikrotik_profile_name || `kore-${String(plan.name || 'plano').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return String(raw || 'kore-plano').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-|-$/g, '') || 'kore-plano';
}

function hotspotCredential(value, fallback = 'kore-user') {
  return normalizeUser(value || fallback).replace(/[@]/g, '.').slice(0, 48) || fallback;
}

function randomPassword() {
  return `Kore${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

async function ensureHotspotProfile({ host = '10.255.255.3', port = '22', user = 'kore-api', plan = {} }) {
  const profile = hotspotProfileName(plan);
  const rate = planRateLimit(plan);
  if (!rate) return { profile, rate_limit: '' };
  const command = `:do { /ip hotspot user profile remove [find where name=${profile}] } on-error={}; /ip hotspot user profile add name=${profile} rate-limit=${rate} shared-users=1; /ip hotspot user profile print detail where name=${profile}`;
  await ensureSshKey();
  const { stdout } = await run('ssh', ['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${host}`, command], 15000);
  return { profile, rate_limit: rate, raw: stdout };
}

async function createHotspotUser({ host = '10.255.255.3', port = '22', user = 'kore-api', username, password, mac, ip, minutes = 30, permanent = false, plan = {} }) {
  const cleanMac = normalizeMac(mac);
  const cleanIp = normalizeClientIp(ip);
  const login = hotspotCredential(username, `kore-${Date.now()}`);
  const pass = String(password || randomPassword()).replace(/"/g, '');
  const profileResult = await ensureHotspotProfile({ host, port, user, plan });
  const profile = profileResult.profile;
  const ttlMinutes = Math.max(1, Math.min(Number(minutes || 30), 60 * 24 * 7));
  const schedulerName = `kore-user-expire-${login.replace(/[^A-Za-z0-9]/g, '')}`;
  const expireCommand = `:do { /ip hotspot user remove [find where name=${login}] } on-error={}; :do { /ip hotspot active remove [find where user=${login}] } on-error={}; :do { /ip hotspot host remove [find where mac-address="${cleanMac}"] } on-error={}; :do { /system scheduler remove [find where name="${schedulerName}"] } on-error={}`;
  const scheduler = permanent ? '' : `; :do { /system scheduler remove [find where name="${schedulerName}"] } on-error={}; /system scheduler add name="${schedulerName}" interval=${ttlMinutes}m on-event=${routerQuote(expireCommand)} comment="Kore-HotSpot user expire ${login}" disabled=no`;
  const command = [
    cleanMac ? `:do { /ip hotspot ip-binding remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanIp ? `:do { /ip hotspot ip-binding remove [find where address="${cleanIp}"] } on-error={}` : '',
    `:do { /ip hotspot user remove [find where name=${login}] } on-error={}`,
    `/ip hotspot user add name=${login} password="${pass}" profile=${profile} server=kore-hotspot comment="Kore-HotSpot captive ${cleanMac || cleanIp || login}" disabled=no`,
    cleanMac ? `:do { /ip hotspot host remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanMac ? `:do { /ip hotspot active remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    scheduler.replace(/^; /, ''),
    `/ip hotspot user print detail where name=${login}`
  ].filter(Boolean).join('; ');

  await ensureSshKey();
  const { stdout } = await run('ssh', ['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${host}`, command], 15000);
  return { authorized: true, mode: 'hotspot_user', host, username: login, password: pass, profile, mac: cleanMac, ip: cleanIp, minutes: ttlMinutes, expires: !permanent, scheduler: permanent ? null : schedulerName, ...profileResult, raw: stdout };
}

async function authorizeHotspot({ host = '10.255.255.3', port = '22', user = 'kore-api', mac, ip, minutes = 30, permanent = false, plan = null }) {
  const cleanMac = normalizeMac(mac);
  const cleanIp = normalizeClientIp(ip);
  if (!cleanMac && !cleanIp) return { authorized: false, reason: 'mac/ip ausentes' };

  const ttlMinutes = Math.max(1, Math.min(Number(minutes || 30), 60 * 24 * 7));
  const comment = `Kore-HotSpot captive ${cleanMac || cleanIp}`;
  const schedulerName = `kore-expire-${(cleanMac || cleanIp).replace(/[^A-Za-z0-9]/g, '')}`;
  const queueName = `kore-limit-${(cleanMac || cleanIp).replace(/[^A-Za-z0-9]/g, '')}`;
  const rateLimit = planRateLimit(plan || {});
  const fields = [
    cleanMac ? `mac-address=${cleanMac}` : '',
    !cleanMac && cleanIp ? `address=${cleanIp}` : '',
    'type=bypassed',
    'server=kore-hotspot',
    `comment="${comment}"`
  ].filter(Boolean).join(' ');
  const queueTarget = cleanIp ? `target=${cleanIp}/32` : '';
  const queueCommand = rateLimit && cleanIp ? `; :do { /queue simple remove [find where name="${queueName}"] } on-error={}; /queue simple add name="${queueName}" ${queueTarget} max-limit=${rateLimit} comment="${comment}" disabled=no` : '';
  const expireCommand = `:do { /ip hotspot ip-binding remove [find where comment="${comment}"] } on-error={}; :do { /queue simple remove [find where name="${queueName}"] } on-error={}; :do { /ip hotspot host remove [find where mac-address="${cleanMac}"] } on-error={}; :do { /ip hotspot active remove [find where mac-address="${cleanMac}"] } on-error={}; :do { /system scheduler remove [find where name="${schedulerName}"] } on-error={}`;
  const scheduler = permanent ? '' : `; :do { /system scheduler remove [find where name="${schedulerName}"] } on-error={}; /system scheduler add name="${schedulerName}" interval=${ttlMinutes}m on-event=${routerQuote(expireCommand)} comment="Kore-HotSpot trial expire" disabled=no`;
  const command = `:do { /ip hotspot ip-binding remove [find where comment="${comment}"] } on-error={}; :do { /queue simple remove [find where name="${queueName}"] } on-error={}; /ip hotspot ip-binding add ${fields}${queueCommand}; :do { /ip hotspot host remove [find where mac-address="${cleanMac}"] } on-error={}; :do { /ip hotspot active remove [find where mac-address="${cleanMac}"] } on-error={}${scheduler}; /ip hotspot ip-binding print detail where comment="${comment}"; /queue simple print detail where name="${queueName}"`;

  await ensureSshKey();
  const { stdout } = await run('ssh', ['-i', KEY_PATH, '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${host}`, command], 15000);
  return { authorized: true, host, mac: cleanMac, ip: cleanIp, minutes: ttlMinutes, expires: !permanent, scheduler: permanent ? null : schedulerName, queue: rateLimit ? queueName : null, rate_limit: rateLimit, raw: stdout };
}

async function removeHotspotAuthorization({ host = '10.255.255.3', port = '22', user = 'kore-api', mac, ip }) {
  const cleanMac = normalizeMac(mac);
  const cleanIp = normalizeClientIp(ip);
  if (!cleanMac && !cleanIp) return { removed: false, reason: 'mac/ip ausentes' };

  const comment = `Kore-HotSpot captive ${cleanMac || cleanIp}`;
  const schedulerName = `kore-expire-${(cleanMac || cleanIp).replace(/[^A-Za-z0-9]/g, '')}`;
  const queueName = `kore-limit-${(cleanMac || cleanIp).replace(/[^A-Za-z0-9]/g, '')}`;
  const command = [
    `:do { /ip hotspot ip-binding remove [find where comment="${comment}"] } on-error={}`,
    `:do { /queue simple remove [find where name="${queueName}"] } on-error={}`,
    cleanMac ? `:do { /ip hotspot ip-binding remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanIp ? `:do { /ip hotspot ip-binding remove [find where address="${cleanIp}"] } on-error={}` : '',
    cleanMac ? `:do { /ip hotspot host remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanMac ? `:do { /ip hotspot active remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    `:do { /system scheduler remove [find where name="${schedulerName}"] } on-error={}`
  ].filter(Boolean).join('; ');

  await ensureSshKey();
  const { stdout } = await run('ssh', ['-i', KEY_PATH, '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${host}`, command], 15000);
  return { removed: true, host, mac: cleanMac, ip: cleanIp, raw: stdout };
}

async function cleanupMikrotikAccess(item = {}) {
  const devices = getMikrotikDevices();
  const targets = devices.length ? devices : [{ host: item.mikrotik_host || '10.255.255.3', port: item.mikrotik_port || '22', user: item.mikrotik_user || 'kore-api' }];
  const cleanMac = normalizeMac(item.mac_address || item.mac);
  const cleanIp = normalizeClientIp(item.ip_address || item.ip);
  const login = hotspotCredential(item.radius_username || item.username || item.email || item.cpf || '', '');
  const queueName = `kore-limit-${(cleanMac || cleanIp).replace(/[^A-Za-z0-9]/g, '')}`;
  const oldBypassComment = `Kore-HotSpot captive ${cleanMac || cleanIp}`;
  const schedulerUser = login ? `kore-user-expire-${login.replace(/[^A-Za-z0-9]/g, '')}` : '';
  const schedulerBypass = cleanMac || cleanIp ? `kore-expire-${(cleanMac || cleanIp).replace(/[^A-Za-z0-9]/g, '')}` : '';

  const commands = [
    login ? `:do { /ip hotspot user remove [find where name=${login}] } on-error={}` : '',
    login ? `:do { /ip hotspot active remove [find where user=${login}] } on-error={}` : '',
    cleanMac ? `:do { /ip hotspot active remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanIp ? `:do { /ip hotspot active remove [find where address="${cleanIp}"] } on-error={}` : '',
    cleanMac ? `:do { /ip hotspot host remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanIp ? `:do { /ip hotspot host remove [find where address="${cleanIp}"] } on-error={}` : '',
    cleanMac ? `:do { /ip hotspot ip-binding remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanIp ? `:do { /ip hotspot ip-binding remove [find where address="${cleanIp}"] } on-error={}` : '',
    oldBypassComment !== 'Kore-HotSpot captive ' ? `:do { /ip hotspot ip-binding remove [find where comment="${oldBypassComment}"] } on-error={}` : '',
    queueName !== 'kore-limit-' ? `:do { /queue simple remove [find where name="${queueName}"] } on-error={}` : '',
    schedulerUser ? `:do { /system scheduler remove [find where name="${schedulerUser}"] } on-error={}` : '',
    schedulerBypass ? `:do { /system scheduler remove [find where name="${schedulerBypass}"] } on-error={}` : ''
  ].filter(Boolean).join('; ');

  if (!commands) return { success: true, skipped: true };
  await ensureSshKey();
  const results = [];
  for (const device of targets.slice(0, 5)) {
    const host = device.host || device.vpn_remote_ip || device.remote_ip;
    if (!host) continue;
    const { stdout } = await run('ssh', ['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(device.port || '22'), `${device.user || 'kore-api'}@${host}`, commands], 15000).catch(error => ({ stdout: '', error: error.message }));
    results.push({ host, stdout });
  }
  return { success: true, results };
}

async function setVipAccess(payload = {}) {
  const entity = normalizeText(payload.entity || payload.entity_type || 'client');
  const id = String(payload.id || payload._id || payload.client_id || payload.prospect_id || '').trim();
  const enabled = payload.enabled !== false;
  if (!id) throw new Error('id obrigatorio');

  const file = entity === 'prospect' ? CAPTIVE_DB : ENTITY_FILES.clients;
  const items = entity === 'prospect' ? readCaptiveDb() : readJson(file, []);
  const plans = readJson(ENTITY_FILES.plans, []);
  const item = items.find(entry => entry.id === id || entry._id === id);
  if (!item) throw new Error(entity === 'prospect' ? 'Prospecto nao encontrado' : 'Cliente nao encontrado');

  const mac = payload.mac || payload.mac_address || item.mac_address;
  const ip = payload.ip || payload.ip_address || item.ip_address;
  const nowIso = new Date().toISOString();
  const mikrotik = {
    host: payload.mikrotik_host || item.mikrotik_host || '10.255.255.3',
    port: payload.mikrotik_port || item.mikrotik_port || '22',
    user: payload.mikrotik_user || item.mikrotik_user || 'kore-api',
    mac,
    ip
  };

  const plan = plans.find(entry => (entry.id || entry._id) === item.plan_id) || item;
  const mikrotikResult = enabled
    ? await authorizeHotspot({ ...mikrotik, permanent: true, minutes: 60 * 24 * 7, plan })
    : await removeHotspotAuthorization(mikrotik);

  const updated = {
    ...item,
    status: enabled ? 'active' : (item.status || 'new'),
    vip_access: enabled,
    vip_enabled: enabled,
    vip_authorized_at: enabled ? nowIso : item.vip_authorized_at,
    vip_removed_at: enabled ? '' : nowIso,
    vip_authorization: mikrotikResult,
    mac_address: normalizeMac(mac) || item.mac_address || '',
    ip_address: normalizeClientIp(ip) || item.ip_address || '',
    updated_date: nowIso
  };

  const next = items.map(entry => (entry.id === id || entry._id === id ? updated : entry));
  if (entity === 'prospect') writeCaptiveDb(next);
  else writeJson(file, next);

  return { success: true, enabled, entity, item: updated, authorization: mikrotikResult };
}

async function captiveRegister(payload = {}) {
  const created = new Date().toISOString();
  const cleanCpf = String(payload.cpf || '').replace(/\D/g, '');
  const plans = readJson(ENTITY_FILES.plans, []);
  const selectedPlan = plans.find(plan => (plan.id || plan._id) === String(payload.plan_id || '')) || plans.find(plan => plan.is_trial && plan.status === 'active');
  if (!selectedPlan) throw new Error('Nenhum plano de primeiro acesso cadastrado');
  const trialMinutes = Number(selectedPlan.trial_duration_minutes || selectedPlan.validity_hours * 60 || payload.minutes || 1);
  const item = {
    id: `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    _id: `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: String(payload.name || '').trim(),
    cpf: payload.cpf || cleanCpf,
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    cep: String(payload.cep || '').trim(),
    plan_id: String(selectedPlan?.id || selectedPlan?._id || payload.plan_id || '').trim(),
    plan_name: String(selectedPlan?.name || payload.plan_name || '').trim(),
    plan_price: Number(selectedPlan?.price || payload.plan_price || 0),
    ...planSpeedFields(selectedPlan || payload),
    status: 'new',
    source: 'captive_portal',
    trial_access: true,
    trial_duration_minutes: trialMinutes,
    trial_duration_hours: Number((trialMinutes / 60).toFixed(2)),
    trial_expires_at: new Date(Date.now() + trialMinutes * 60000).toISOString(),
    radius_username: hotspotCredential(`trial-${Date.now()}`),
    radius_password: randomPassword(),
    mac_address: normalizeMac(payload.mac),
    ip_address: normalizeClientIp(payload.ip),
    link_orig: payload.link_orig || '',
    created_date: created,
    updated_date: created
  };

  const items = readCaptiveDb();
  const filtered = items.filter(existing => {
    if (item.mac_address && existing.mac_address === item.mac_address) return false;
    if (item.cpf && existing.cpf === item.cpf) return false;
    return true;
  });
  filtered.unshift(item);
  writeCaptiveDb(filtered.slice(0, 1000));

  const authorization = await createHotspotUser({
    host: payload.mikrotik_host || '10.255.255.3',
    port: payload.mikrotik_port || '22',
    user: payload.mikrotik_user || 'kore-api',
    username: item.radius_username,
    password: item.radius_password,
    mac: item.mac_address,
    ip: item.ip_address,
    minutes: item.trial_duration_minutes,
    plan: selectedPlan || item
  }).catch(error => ({ authorized: false, error: error.message }));

  return { success: true, prospect: item, authorization, login: { username: item.radius_username, password: item.radius_password } };
}

async function deleteCaptiveProspect(id) {
  const items = readCaptiveDb();
  const removedItem = items.find(item => item.id === id || item._id === id);
  if (removedItem) {
    await cleanupMikrotikAccess(removedItem).catch(error => ({ error: error.message }));
  }
  const filtered = items.filter(item => item.id !== id && item._id !== id);
  writeCaptiveDb(filtered);
  return { success: true, removed: items.length - filtered.length };
}

async function captiveClientLogin(payload = {}) {
  const identifier = normalizeText(payload.identifier || payload.email || payload.cpf || payload.phone);
  const digits = normalizeDigits(identifier);
  if (!identifier) throw new Error('Informe CPF, e-mail, telefone ou usuario');

  const clients = readJson(ENTITY_FILES.clients, []);
  const plans = readJson(ENTITY_FILES.plans, []);
  const selectedPlan = plans.find(plan => (plan.id || plan._id) === String(payload.plan_id || '')) ||
    plans.find(plan => !plan.is_trial && plan.status === 'active') ||
    plans.find(plan => plan.status === 'active');

  const blockedLocalClient = clients.find(item => {
    const status = normalizeText(item.status || 'active');
    if (!['inactive', 'suspended', 'blocked', 'bloqueado', 'desativado'].includes(status)) return false;
    return normalizeText(item.email) === identifier ||
      normalizeText(item.radius_username) === identifier ||
      normalizeText(item.username) === identifier ||
      normalizeDigits(item.cpf) === digits ||
      normalizeDigits(item.phone) === digits;
  });
  if (blockedLocalClient) throw new Error('Cliente bloqueado ou desativado no sistema');

  let client = clients.find(item => {
    const status = normalizeText(item.status || 'active');
    if (status && status !== 'active' && status !== 'trial') return false;
    return normalizeText(item.email) === identifier ||
      normalizeText(item.radius_username) === identifier ||
      normalizeText(item.username) === identifier ||
      normalizeDigits(item.cpf) === digits ||
      normalizeDigits(item.phone) === digits;
  });

  if (!client && digits) {
    const ixc = await ixcConsultaCliente({ cpf: digits }).catch(error => ({ found: false, error: error.message }));
    if (ixc.found && ixc.client) {
      const nowIso = new Date().toISOString();
      const id = `ixc_${ixc.client.id || digits}`;
      client = {
        id,
        _id: id,
        name: ixc.name || ixc.client.razao || ixc.client.nome || 'Cliente IXC',
        cpf: ixc.client.cnpj_cpf || formatCpf(digits),
        email: ixc.client.email || '',
        phone: ixc.client.telefone_celular || ixc.client.fone || '',
        status: 'active',
        source: 'ixc',
        ixc_id: String(ixc.client.id || ''),
        radius_username: `ixc-${ixc.client.id || digits}`,
        plan_id: selectedPlan?.id || selectedPlan?._id || '',
        plan_name: selectedPlan?.name || '',
        ...planSpeedFields(selectedPlan),
        created_date: nowIso,
        updated_date: nowIso
      };
      const next = [client, ...clients.filter(item => item.id !== id && item._id !== id && normalizeDigits(item.cpf) !== digits)];
      writeJson(ENTITY_FILES.clients, next.slice(0, 5000));
    }
  }

  if (!client) throw new Error('Cliente nao encontrado no sistema nem no IXC');

  if (selectedPlan && (!client.plan_id || payload.plan_id)) {
    client = {
      ...client,
      plan_id: selectedPlan.id || selectedPlan._id,
      plan_name: selectedPlan.name,
      ...planSpeedFields(selectedPlan),
      updated_date: new Date().toISOString()
    };
    const next = [client, ...clients.filter(item => item.id !== client.id && item._id !== client._id && normalizeDigits(item.cpf) !== normalizeDigits(client.cpf))];
    writeJson(ENTITY_FILES.clients, next.slice(0, 5000));
  }

  const loginUser = hotspotCredential(client.radius_username || client.username || client.cpf || client.email || `cliente-${Date.now()}`);
  const loginPass = String(client.radius_password || client.password || randomPassword()).replace(/"/g, '');
  client = { ...client, radius_username: loginUser, radius_password: loginPass, mac_address: normalizeMac(payload.mac) || client.mac_address || '', ip_address: normalizeClientIp(payload.ip) || client.ip_address || '', updated_date: new Date().toISOString() };
  upsertById(ENTITY_FILES.clients, client);

  const authorization = await createHotspotUser({
    host: payload.mikrotik_host || '10.255.255.3',
    port: payload.mikrotik_port || '22',
    user: payload.mikrotik_user || 'kore-api',
    username: loginUser,
    password: loginPass,
    mac: payload.mac,
    ip: payload.ip,
    minutes: Number(payload.minutes || 1440),
    permanent: true,
    plan: selectedPlan || client
  }).catch(error => ({ authorized: false, error: error.message }));

  return { success: true, client, plan: selectedPlan || null, authorization, login: { username: loginUser, password: loginPass } };
}

async function captiveVoucherLogin(payload = {}) {
  const code = normalizeText(payload.code).toUpperCase();
  if (!code) throw new Error('Informe o voucher');

  const vouchers = readJson(ENTITY_FILES.vouchers, []);
  const voucher = vouchers.find(item => normalizeText(item.code).toUpperCase() === code);
  if (!voucher || voucher.status !== 'available') throw new Error('Voucher invalido ou indisponivel');

  const minutes = Number(voucher.duration_minutes || payload.minutes || 30);
  const expires = new Date(Date.now() + minutes * 60000).toISOString();
  const updated = vouchers.map(item => (
    item.id === voucher.id || item._id === voucher._id ? {
      ...item,
      status: 'used',
      used_at: new Date().toISOString(),
      expires_at: expires,
      used_by_name: payload.name || 'Visitante',
      used_by_email: payload.email || '',
      mac_address: normalizeMac(payload.mac),
      ip_address: normalizeClientIp(payload.ip)
    } : item
  ));
  writeJson(ENTITY_FILES.vouchers, updated);

  const authorization = await createHotspotUser({
    host: payload.mikrotik_host || '10.255.255.3',
    port: payload.mikrotik_port || '22',
    user: payload.mikrotik_user || 'kore-api',
    username: hotspotCredential(`voucher-${code}`),
    password: randomPassword(),
    mac: payload.mac,
    ip: payload.ip,
    minutes,
    plan: voucher
  }).catch(error => ({ authorized: false, error: error.message }));

  return { success: true, voucher: { ...voucher, status: 'used', expires_at: expires }, minutes, authorization, login: { username: authorization.username, password: authorization.password } };
}

async function activateFreePlan(payload = {}) {
  const clients = readJson(ENTITY_FILES.clients, []);
  const plans = readJson(ENTITY_FILES.plans, []);
  const plan = plans.find(item => (item.id || item._id) === String(payload.plan_id || payload.planId || ''));
  if (!plan) throw new Error('Plano nao encontrado');
  if (!freePlan(plan)) throw new Error('Este plano exige pagamento Pix ou e trial');

  let client = clients.find(item => item.id === payload.client_id || item._id === payload.client_id || item.id === payload.clientId || item._id === payload.clientId);
  if (!client) throw new Error('Cliente nao encontrado');

  const expiresAt = new Date(Date.now() + planValidityMinutes(plan) * 60000).toISOString();
  client = {
    ...client,
    status: 'active',
    plan_id: plan.id || plan._id,
    plan_name: plan.name,
    ...planSpeedFields(plan),
    plan_expires_at: expiresAt,
    updated_date: new Date().toISOString()
  };
  upsertById(ENTITY_FILES.clients, client);

  const loginUser = hotspotCredential(client.radius_username || client.username || client.cpf || client.email || `cliente-${Date.now()}`);
  const loginPass = String(client.radius_password || client.password || randomPassword()).replace(/"/g, '');
  client = { ...client, radius_username: loginUser, radius_password: loginPass };
  upsertById(ENTITY_FILES.clients, client);

  const authorization = await createHotspotUser({
    host: payload.mikrotik_host || '10.255.255.3',
    port: payload.mikrotik_port || '22',
    user: payload.mikrotik_user || 'kore-api',
    username: loginUser,
    password: loginPass,
    mac: payload.mac || payload.mac_address || client.mac_address,
    ip: payload.ip || payload.ip_address || client.ip_address,
    minutes: planValidityMinutes(plan),
    permanent: true,
    plan
  }).catch(error => ({ authorized: false, error: error.message }));

  return { success: true, client, plan, authorization, login: { username: loginUser, password: loginPass } };
}

async function getMercadoPagoPayment(paymentId) {
  const token = getSetting('mp_access_token');
  if (!token) throw new Error('Configure o Access Token do Mercado Pago');
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Mercado Pago HTTP ${response.status}`);
  return data;
}

async function provisionPaidPlan({ payment, mpPayment = null }) {
  if (!payment || payment.status !== 'approved') return payment;

  const clients = readJson(ENTITY_FILES.clients, []);
  const plans = readJson(ENTITY_FILES.plans, []);
  const plan = plans.find(item => (item.id || item._id) === payment.plan_id);
  let client = clients.find(item => item.id === payment.client_id || item._id === payment.client_id);
  if (!client) return payment;

  const expiresAt = new Date(Date.now() + planValidityMinutes(plan) * 60000).toISOString();
  client = {
    ...client,
    status: 'active',
    plan_id: plan?.id || plan?._id || payment.plan_id,
    plan_name: plan?.name || payment.plan_name,
    ...planSpeedFields(plan),
    plan_expires_at: expiresAt,
    last_payment_id: payment.id,
    updated_date: new Date().toISOString()
  };
  upsertById(ENTITY_FILES.clients, client);

  const loginUser = hotspotCredential(client.radius_username || client.username || client.cpf || client.email || `cliente-${Date.now()}`);
  const loginPass = String(client.radius_password || client.password || randomPassword()).replace(/"/g, '');
  client = { ...client, radius_username: loginUser, radius_password: loginPass };
  upsertById(ENTITY_FILES.clients, client);

  const authorization = await createHotspotUser({
    host: payment.mikrotik_host || '10.255.255.3',
    port: payment.mikrotik_port || '22',
    user: payment.mikrotik_user || 'kore-api',
    username: loginUser,
    password: loginPass,
    mac: payment.mac_address || client.mac_address,
    ip: payment.ip_address || client.ip_address,
    minutes: planValidityMinutes(plan),
    permanent: true,
    plan
  }).catch(error => ({ authorized: false, error: error.message }));

  const message = [
    `Pagamento confirmado: ${plan?.name || payment.plan_name}`,
    `Cliente: ${client.name}`,
    `Usuario: ${client.radius_username || client.email || client.cpf || '-'}`,
    `Validade: ${new Date(expiresAt).toLocaleDateString('pt-BR')}`,
  ].join('\n');

  const updatedPayment = {
    ...payment,
    provisioned: true,
    provisioned_at: new Date().toISOString(),
    client_name: client.name,
    plan_expires_at: expiresAt,
    authorization,
    whatsapp_url: whatsappLink({ phone: client.phone, message }),
    mp_status_detail: mpPayment?.status_detail || payment.mp_status_detail || ''
  };
  upsertById(ENTITY_FILES.payments, updatedPayment);
  return updatedPayment;
}

async function createPixPayment(payload = {}) {
  const token = getSetting('mp_access_token');
  if (!token) throw new Error('Configure o Access Token do Mercado Pago');

  const clients = readJson(ENTITY_FILES.clients, []);
  const plans = readJson(ENTITY_FILES.plans, []);
  const plan = plans.find(item => (item.id || item._id) === String(payload.plan_id || payload.planId || ''));
  if (!plan) throw new Error('Plano nao encontrado');
  if (!paidPlan(plan)) throw new Error('Plano gratuito nao precisa de pagamento Pix');

  let client = clients.find(item => item.id === payload.client_id || item._id === payload.client_id || item.id === payload.clientId || item._id === payload.clientId);
  if (!client && payload.client) client = payload.client;
  if (!client) throw new Error('Cliente nao encontrado');

  const localPaymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payerEmail = client.email || payload.email || `cliente-${localPaymentId}@kore-hotspot.local`;
  const body = {
    transaction_amount: Number(plan.price),
    description: `Kore-HotSpot - ${plan.name}`,
    payment_method_id: 'pix',
    external_reference: localPaymentId,
    notification_url: `${getPublicBaseUrl()}/api/payments/mercadopago/webhook`,
    payer: {
      email: payerEmail,
      first_name: String(client.name || '').split(/\s+/)[0] || 'Cliente',
      last_name: String(client.name || '').split(/\s+/).slice(1).join(' ') || 'Kore',
      identification: normalizeDigits(client.cpf) ? { type: 'CPF', number: normalizeDigits(client.cpf) } : undefined
    }
  };

  const response = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': localPaymentId
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Mercado Pago HTTP ${response.status}`);

  const tx = data.point_of_interaction?.transaction_data || {};
  const payment = {
    id: localPaymentId,
    _id: localPaymentId,
    provider: 'mercadopago',
    provider_payment_id: String(data.id || ''),
    status: data.status || 'pending',
    status_detail: data.status_detail || '',
    client_id: client.id || client._id,
    client_name: client.name,
    client_phone: client.phone || '',
    plan_id: plan.id || plan._id,
    plan_name: plan.name,
    amount: Number(plan.price),
    qr_code: tx.qr_code || '',
    qr_code_base64: tx.qr_code_base64 || '',
    ticket_url: tx.ticket_url || '',
    mac_address: payload.mac || payload.mac_address || client.mac_address || '',
    ip_address: payload.ip || payload.ip_address || client.ip_address || '',
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString(),
    raw: data
  };
  upsertById(ENTITY_FILES.payments, payment);

  return { success: true, payment };
}

async function refreshPaymentStatus({ id, provider_payment_id }) {
  const payments = readJson(ENTITY_FILES.payments, []);
  let payment = payments.find(item => item.id === id || item._id === id || item.provider_payment_id === String(provider_payment_id || ''));
  if (!payment) throw new Error('Pagamento nao encontrado');

  const mpPayment = await getMercadoPagoPayment(payment.provider_payment_id);
  payment = {
    ...payment,
    status: mpPayment.status || payment.status,
    status_detail: mpPayment.status_detail || payment.status_detail,
    updated_date: new Date().toISOString(),
    raw: mpPayment
  };
  upsertById(ENTITY_FILES.payments, payment);
  if (payment.status === 'approved') payment = await provisionPaidPlan({ payment, mpPayment });
  return { success: true, payment };
}

async function mercadoPagoWebhook(payload = {}, query = '') {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  const paymentId = payload?.data?.id || payload?.id || params.get('data.id') || params.get('id');
  if (!paymentId) return { success: true, ignored: true };
  return refreshPaymentStatus({ provider_payment_id: paymentId }).catch(error => ({ success: false, error: error.message }));
}

async function ixcConsultaCliente(payload = {}) {
  const cpf = normalizeDigits(payload.cpf);
  const baseUrl = String(payload.base_url || getSetting('ixc_base_url') || '').replace(/\/+$/, '');
  const token = String(payload.token || getSetting('ixc_token') || '').trim();
  if (!cpf) throw new Error('CPF obrigatorio');
  if (!baseUrl || !token) throw new Error('Configure URL e token do IXC antes de consultar');

  const url = `${baseUrl}/webservice/v1/cliente`;
  const tokenNoPrefix = token.replace(/^Basic\s+/i, '').replace(/^Bearer\s+/i, '').trim();
  const authVariants = [
    token,
    /^Basic\s+/i.test(token) ? token : `Basic ${tokenNoPrefix}`,
    /^Bearer\s+/i.test(token) ? token : `Bearer ${tokenNoPrefix}`,
    `Basic ${Buffer.from(tokenNoPrefix).toString('base64')}`,
    `Basic ${Buffer.from(`${tokenNoPrefix}:`).toString('base64')}`,
    `Basic ${Buffer.from(`:${tokenNoPrefix}`).toString('base64')}`
  ].filter(Boolean);
  const queries = [...new Set([cpf, formatCpf(cpf)])];
  const qtypes = ['cliente.cnpj_cpf', 'cnpj_cpf', 'cliente.cpf_cnpj', 'cpf_cnpj'];

  let lastError = null;
  const tried = [];
  for (const authorization of [...new Set(authVariants)]) {
    const scheme = authorization.split(/\s+/)[0] || 'raw';
    tried.push(scheme);
    for (const qtype of qtypes) {
      for (const query of queries) {
        const body = {
          qtype,
          query,
          oper: '=',
          page: '1',
          rp: '5',
          sortname: 'cliente.id',
          sortorder: 'desc'
        };
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
              ixcsoft: 'listar'
            },
            body: JSON.stringify(body)
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = data.message || data.error || `IXC HTTP ${response.status}`;
            lastError = new Error(`${message} em ${url}. Token recebido (${token.length} caracteres), formatos testados: ${[...new Set(tried)].join(', ')}`);
            continue;
          }
          const registros = Array.isArray(data.registros) ? data.registros : [];
          const cliente = registros.find(item => normalizeDigits(item.cnpj_cpf || item.cpf_cnpj || item.cpf) === cpf) || registros[0] || null;
          if (cliente) {
            const summary = summarizeIxcClient(cliente, cpf);
            return {
              found: true,
              cpf,
              query_used: { qtype, query },
              name: summary.name,
              summary,
              client: cliente,
              raw: data
            };
          }
          lastError = null;
        } catch (error) {
          lastError = error;
        }
      }
    }
  }
  if (lastError) throw lastError;
  return { found: false, cpf, name: '', client: null, raw: { total: 0, queries: qtypes.flatMap(qtype => queries.map(query => ({ qtype, query }))) } };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
    if (req.url === '/health') return send(res, 200, { ok: true, service: 'kore-vpn-api' });
    const [pathname, query = ''] = req.url.split('?');
    if (req.method === 'POST' && pathname === '/api/payments/mercadopago/webhook') return send(res, 200, await mercadoPagoWebhook(await readBody(req), query));
    if (req.method === 'GET' && req.url === '/public/hotspot-login.html') {
      return send(res, 200, hotspotLoginHtml(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (req.method === 'GET' && req.url === '/public/kore-api.pub') {
      await ensureSshKey();
      return send(res, 200, fs.readFileSync(PUB_PATH, 'utf8'), { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    if (!validToken(req)) return send(res, 401, { error: 'token invalido' });

    if (req.method === 'GET' && req.url === '/api/ssh-key') {
      await ensureSshKey();
      const pub = fs.readFileSync(PUB_PATH, 'utf8').trim();
      return send(res, 200, { public_key: pub, public_key_url: 'http://190.8.174.155:8081/public/kore-api.pub' });
    }
    if (req.method === 'POST' && req.url === '/api/admin/auth') return send(res, 200, await adminAuth(await readBody(req)));
    if (req.method === 'GET' && req.url === '/api/radius/status') return send(res, 200, await radiusStatus());
    if (req.method === 'GET' && req.url === '/api/radius/sessions') return send(res, 200, await radiusSessions());
    if (req.method === 'GET' && req.url === '/api/captive/prospects') return send(res, 200, { prospects: readCaptiveDb() });
    if (req.method === 'DELETE' && req.url.startsWith('/api/captive/prospects/')) return send(res, 200, await deleteCaptiveProspect(decodeURIComponent(req.url.split('/').pop())));
    if (req.method === 'GET' && req.url === '/api/captive/plans') {
      const plans = readJson(ENTITY_FILES.plans, []).map(publicPlan).filter(plan => plan.status === 'active');
      return send(res, 200, { plans });
    }
    if (req.method === 'POST' && req.url === '/api/captive/register') return send(res, 200, await captiveRegister(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/captive/client-login') return send(res, 200, await captiveClientLogin(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/captive/voucher-login') return send(res, 200, await captiveVoucherLogin(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/ixc/cliente') return send(res, 200, await ixcConsultaCliente(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/clients/activate-free-plan') return send(res, 200, await activateFreePlan(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/hotspot/vip') return send(res, 200, await setVipAccess(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/mikrotik/cleanup-access') return send(res, 200, await cleanupMikrotikAccess(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/payments/pix') return send(res, 200, await createPixPayment(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/payments/status') return send(res, 200, await refreshPaymentStatus(await readBody(req)));
    if (req.url.startsWith('/api/entities/')) {
      const result = await entityCrud(req);
      if (result) return send(res, 200, result);
    }
    if (req.method === 'GET' && req.url === '/api/vpn/users') return send(res, 200, { users: await listUsers() });
    if (req.method === 'GET' && req.url === '/api/vpn/status') return send(res, 200, await vpnStatus());
    if (req.method === 'POST' && req.url === '/api/vpn/users') return send(res, 200, await ensureUser(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/mikrotik/status') return send(res, 200, await mikrotikStatus(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/mikrotik/sync-plans') return send(res, 200, await mikrotikSyncPlans(await readBody(req)));

    return send(res, 404, { error: 'rota nao encontrada' });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message });
  }
});

ensureSshKey().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`Kore VPN API listening on ${PORT}`));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
