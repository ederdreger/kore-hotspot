const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const { AsyncLocalStorage } = require('async_hooks');

const PORT = Number(process.env.PORT || 8081);
const TOKEN = process.env.KORE_VPN_API_TOKEN || 'kore-vpn-api-2026';
const DEFAULT_ADMIN_PASSWORD = process.env.KORE_ADMIN_PASSWORD || 'Admin12345';
const CHAP = process.env.KORE_CHAP_FILE || '/etc/ppp/chap-secrets';
const KEY_DIR = process.env.KORE_KEY_DIR || '/opt/kore-hotspot-vpn-api/keys';
const KEY_PATH = path.join(KEY_DIR, 'kore-api_rsa');
const PUB_PATH = `${KEY_PATH}.pub`;
const DATA_KEY_PATH = path.join(KEY_DIR, 'data-encryption.key');
const DATA_DIR = process.env.KORE_DATA_DIR || '/opt/kore-hotspot-vpn-api/data';
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');
const WEB_DIR = process.env.KORE_WEB_DIR || '/opt/kore-hotspot';
const CERTBOT_EMAIL = process.env.KORE_CERTBOT_EMAIL || 'admin@spedynet.com.br';
const PUBLIC_HOST = process.env.KORE_PUBLIC_HOST || '';
const PROVIDERS_FILE = path.join(DATA_DIR, 'providers.json');
const PROVIDER_BILLING_FILE = path.join(DATA_DIR, 'provider-billing.json');
const PROVIDER_COMMERCIAL_PLANS = {
  free: { label: 'Free', price: 0 },
  starter: { label: 'Starter', price: 100 },
  professional: { label: 'Professional', price: 200 },
  enterprise: { label: 'Enterprise', price: 300 }
};
const DEFAULT_TENANT_ID = String(process.env.KORE_DEFAULT_TENANT || 'default').trim().toLowerCase();
const MULTI_TENANT = String(process.env.KORE_MULTI_TENANT || 'true') !== 'false';
const tenantStore = new AsyncLocalStorage();
const CAPTIVE_DB = path.join(DATA_DIR, 'captive-prospects.json');
const AP_PROFILES_FILE = path.join(DATA_DIR, 'ap-profiles.json');
const ENTITY_FILES = {
  admins: path.join(DATA_DIR, 'admin-users.json'),
  admin_sessions: path.join(DATA_DIR, 'admin-sessions.json'),
  clients: path.join(DATA_DIR, 'clients.json'),
  plans: path.join(DATA_DIR, 'plans.json'),
  vouchers: path.join(DATA_DIR, 'vouchers.json'),
  access_points: path.join(DATA_DIR, 'access-points.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  payments: path.join(DATA_DIR, 'payments.json')
};
const DEFAULT_ADMINS = [
  { email: 'demo@spedynet.com.br', full_name: 'Administrador Demo', role: 'super_admin' },
  { email: 'spedynet@spedynet.com.br', full_name: 'Administrador Spedynet', role: 'super_admin' }
];
const SYSTEM_MODULES = ['providers'];
const TENANT_ADMIN_PERMISSIONS = ['dashboard', 'clients', 'prospects', 'mikrotiks', 'vpn', 'plans', 'vouchers', 'campaigns', 'radius', 'ap-monitor', 'logs', 'users', 'settings'];
const radiusRateCache = new Map();

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Kore-Token, X-Kore-Tenant, X-Kore-Session, X-Admin-Session',
    ...headers
  });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

function safeTenantId(value) {
  const id = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const normalized = id.replace(/[^a-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!normalized || normalized === 'localhost' || normalized === '127.0.0.1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
    return DEFAULT_TENANT_ID;
  }
  return normalized;
}

function tenantFromRequest(req) {
  if (!MULTI_TENANT) return { id: DEFAULT_TENANT_ID, source: 'single' };
  const explicit = req.headers['x-kore-tenant'];
  const explicitTenant = explicit ? safeTenantId(explicit) : '';
  if (explicitTenant && explicitTenant !== DEFAULT_TENANT_ID) return { id: explicitTenant, source: 'header' };
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const host = rawHost.toLowerCase().split(':')[0];
  if (host) {
    try {
      const providers = readGlobalJson(PROVIDERS_FILE, []);
      const provider = providers.find(item => providerDomain(item) === host || safeTenantId(item.tenant_id || item.id) === safeTenantId(host));
      if (provider) return { id: safeTenantId(provider.tenant_id || provider.id), source: 'provider-domain', host };
    } catch {}
  }
  return { id: explicitTenant || DEFAULT_TENANT_ID, source: explicitTenant ? 'header-default' : 'default-host', host };
}

function currentTenant() {
  return tenantStore.getStore() || { id: DEFAULT_TENANT_ID, source: 'default' };
}

function currentDataDir() {
  const tenant = currentTenant().id || DEFAULT_TENANT_ID;
  return MULTI_TENANT ? path.join(TENANTS_DIR, tenant) : DATA_DIR;
}

function tenantFile(file) {
  const basename = path.basename(file);
  return path.join(currentDataDir(), basename);
}

function migrateLegacyFile(source, target) {
  if (currentTenant().id !== DEFAULT_TENANT_ID) return;
  if (source === target) return;
  if (!fs.existsSync(target) && fs.existsSync(source)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function hotspotLoginHtml() {
  const fallbackHost = PUBLIC_HOST ? `http://${PUBLIC_HOST}:8080` : 'http://127.0.0.1:8080';
  const portal = `${process.env.KORE_PUBLIC_URL || fallbackHost}/captive-portal`;
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

async function runSshWithRetry(args, timeout = 15000, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run('ssh', args, timeout);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function ensureSshKey() {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(KEY_PATH) || !fs.existsSync(PUB_PATH)) {
    await run('ssh-keygen', ['-t', 'rsa', '-b', '2048', '-f', KEY_PATH, '-N', '', '-C', 'kore-api@kore-hotspot'], 10000);
  }
  fs.chmodSync(KEY_PATH, 0o600);
  fs.chmodSync(PUB_PATH, 0o644);
}

function dataEncryptionKey() {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(DATA_KEY_PATH)) fs.writeFileSync(DATA_KEY_PATH, crypto.randomBytes(32), { mode: 0o600 });
  const key = fs.readFileSync(DATA_KEY_PATH);
  if (key.length !== 32) throw new Error('Chave de criptografia de dados invalida');
  fs.chmodSync(DATA_KEY_PATH, 0o600);
  return key;
}

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  const [version, iv, tag, encrypted] = String(value).split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Segredo armazenado em formato invalido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataEncryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

function validToken(req) {
  const sessionToken = req.headers['x-kore-session'] || req.headers['x-admin-session'];
  return !!getAdminSession(sessionToken);
}

function requestAdminSession(req) {
  return getAdminSession(req.headers['x-kore-session'] || req.headers['x-admin-session']);
}

function requireSystemAdmin(req) {
  const session = requestAdminSession(req);
  if (!session || session.role !== 'super_admin') {
    throw Object.assign(new Error('Apenas o administrador geral pode gerenciar provedores'), { status: 403 });
  }
  return session;
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
  const hasBitsSuffix = /(?:bps|b\/s)$/.test(text);
  if (unit === 'k') return number / 1000;
  if (unit === 'm') return number;
  if (unit === 'g') return number * 1000;
  if (unit === 't') return number * 1000 * 1000;
  return hasBitsSuffix ? number / 1000 / 1000 : number;
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

function resolveMikrotikTarget(payload = {}, item = {}) {
  const devices = getMikrotikDevices();
  const preferred = devices.find(device => device.id === payload.mikrotik_id || device.id === item.mikrotik_id) || devices[0];
  const host = payload.mikrotik_host || item.mikrotik_host || preferred?.host || preferred?.vpn_remote_ip || preferred?.remote_ip;
  if (!host) throw new Error('Nenhum MikroTik cadastrado para liberar o acesso');
  return {
    host,
    port: payload.mikrotik_port || item.mikrotik_port || preferred?.port || '22',
    user: payload.mikrotik_user || item.mikrotik_user || preferred?.user || 'kore-api'
  };
}

function mikrotikDeviceById(id = '') {
  const devices = getMikrotikDevices();
  return devices.find(device => device.id === id) || devices[0] || null;
}

async function runMikrotikKeyCommand(device, command, timeout = 15000) {
  if (!device?.host) throw Object.assign(new Error('Nenhum MikroTik cadastrado para atuar como controladora CAPsMAN'), { status: 400 });
  await ensureSshKey();
  return run('ssh', [
    '-i', KEY_PATH,
    '-o', 'LogLevel=ERROR',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa',
    '-o', 'HostkeyAlgorithms=+ssh-rsa',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=8',
    '-p', String(device.port || '22'),
    `${device.user || 'kore-api'}@${device.host}`,
    command
  ], timeout);
}

function routerAddress(value) {
  const text = String(value || '').trim();
  return text.replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '');
}

function routerBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', 'yes', 'running', 'bound', 'enabled'].includes(String(value).toLowerCase());
}

function routerSignal(value) {
  const match = String(value || '').match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

function wifiChannel(frequency) {
  const mhz = Number(String(frequency || '').match(/\d{4}/)?.[0] || 0);
  if (mhz === 2484) return 14;
  if (mhz >= 2412 && mhz <= 2472) return Math.round((mhz - 2407) / 5);
  if (mhz >= 5000 && mhz <= 5900) return Math.round((mhz - 5000) / 5);
  if (mhz >= 5955 && mhz <= 7115) return Math.round((mhz - 5950) / 5);
  return 0;
}

function wifiBand(frequency, fallback = '') {
  const mhz = Number(String(frequency || '').match(/\d{4}/)?.[0] || 0);
  if (mhz >= 5955) return '6GHz';
  if (mhz >= 4900) return '5GHz';
  if (mhz >= 2300) return '2.4GHz';
  const text = String(fallback || '').toLowerCase();
  if (text.includes('6ghz') || text.includes('6g')) return '6GHz';
  if (text.includes('5ghz') || text.includes('5g')) return '5GHz';
  return '2.4GHz';
}

function average(values, fallback = 0) {
  const valid = values.filter(value => Number.isFinite(value));
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : fallback;
}

function capsmanApId(controllerId, identity) {
  const stable = String(identity || 'ap').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `capsman-${String(controllerId || 'mikrotik').replace(/[^a-zA-Z0-9_-]/g, '-')}-${stable || 'ap'}`;
}

async function collectCapsman(device) {
  let type;
  let remoteOutput = '';
  try {
    ({ stdout: remoteOutput } = await runMikrotikKeyCommand(device, '/interface wifi capsman remote-cap print detail without-paging'));
    type = 'wifi';
  } catch {
    try {
      ({ stdout: remoteOutput } = await runMikrotikKeyCommand(device, '/caps-man remote-cap print detail without-paging'));
      type = 'legacy';
    } catch {
      throw Object.assign(new Error('CAPsMAN nao encontrado. Habilite o WiFi CAPsMAN ou o CAPsMAN legado neste MikroTik'), { status: 400 });
    }
  }

  const interfaceCommand = type === 'wifi'
    ? '/interface wifi print detail without-paging'
    : '/caps-man interface print detail without-paging';
  const registrationCommand = type === 'wifi'
    ? '/interface wifi registration-table print detail without-paging'
    : '/caps-man registration-table print detail without-paging';
  const [interfaceResult, registrationResult] = await Promise.all([
    runMikrotikKeyCommand(device, interfaceCommand).catch(() => ({ stdout: '' })),
    runMikrotikKeyCommand(device, registrationCommand).catch(() => ({ stdout: '' }))
  ]);

  const remoteCaps = parseKeyValueRows(remoteOutput);
  const interfaces = parseKeyValueRows(interfaceResult.stdout);
  const registrations = parseKeyValueRows(registrationResult.stdout);
  const existing = readJson(ENTITY_FILES.access_points, []);
  const now = new Date().toISOString();

  const apSources = remoteCaps.length ? remoteCaps : interfaces.map(row => ({
    identity: row['radio-name'] || row.name || row['radio-mac'],
    'base-mac': row['radio-mac'],
    address: device.host,
    state: row.running === 'true' ? 'Run' : 'Down'
  }));

  const accessPoints = apSources.map((cap, index) => {
    const identity = cap.identity || cap.ident || cap.name || cap['base-mac'] || cap['radio-mac'] || `AP-${index + 1}`;
    const baseMac = normalizeMac(cap['base-mac'] || cap['radio-mac']);
    const matchingInterfaces = interfaces.filter(row => {
      const radioName = String(row['radio-name'] || row.name || '').toLowerCase();
      if (radioName.includes(String(identity).toLowerCase())) return true;
      const radioMac = normalizeMac(row['radio-mac']);
      return !!(baseMac && radioMac && radioMac.slice(0, 14) === baseMac.slice(0, 14));
    });
    const radios = matchingInterfaces.length ? matchingInterfaces : (apSources.length === 1 ? interfaces : []);
    const interfaceNames = new Set(radios.map(row => row.name).filter(Boolean));
    const clients = registrations.filter(row => interfaceNames.has(row.interface) || interfaceNames.has(row['ap-name']));
    const frequency = radios.map(row => row['current-channel'] || row.frequency || row['channel.frequency']).find(Boolean) || '';
    const signals = clients.map(row => routerSignal(row.signal || row['signal-strength'])).filter(value => value !== null);
    const noises = radios.map(row => routerSignal(row.noise || row['noise-floor'])).filter(value => value !== null);
    const id = capsmanApId(device.id, baseMac || identity);
    const previous = existing.find(item => item.id === id || item._id === id || (baseMac && normalizeMac(item.mac) === baseMac)) || {};
    const maxClients = Number(previous.maxClients || previous.max_clients || 50);
    const running = !['down', 'disconnected'].includes(String(cap.state || '').toLowerCase()) &&
      (radios.length ? radios.some(row => routerBoolean(row.running, !routerBoolean(row.disabled))) : true);
    const utilization = Number(cap.utilization || 0) || Math.min(100, Math.round((clients.length / Math.max(maxClients, 1)) * 100));
    return {
      ...previous,
      id,
      _id: id,
      name: previous.custom_name || previous.name || String(identity),
      controller_id: device.id,
      controller_name: device.name || device.host,
      capsman_type: type,
      managed: true,
      ip: routerAddress(cap.address) || previous.ip || device.host,
      mac: baseMac || previous.mac || '',
      model: cap.board || cap.model || previous.model || '',
      version: cap.version || previous.version || '',
      band: wifiBand(frequency, radios.map(row => row.bands || row.band).join(',')),
      channel: wifiChannel(frequency) || Number(previous.channel || 0),
      ssid: radios.map(row => row.ssid || row['configuration.ssid']).find(Boolean) || previous.ssid || '',
      radios: radios.length || Number(cap.radios || 0),
      clients: clients.length,
      maxClients,
      signalAvg: average(signals, clients.length ? -100 : 0),
      noise: average(noises, 0),
      utilization,
      txPower: Number(previous.txPower || 0),
      uptime: cap.uptime || previous.uptime || '--',
      status: running ? (utilization >= 90 ? 'overloaded' : signals.length && average(signals) < -75 ? 'weak_signal' : 'ok') : 'offline',
      pollError: '',
      last_seen: now,
      created_date: previous.created_date || now,
      updated_date: now
    };
  });

  return { type, access_points: accessPoints, remote_caps: remoteCaps.length, radios: interfaces.length, clients: registrations.length };
}

async function discoverAccessPoints(payload = {}) {
  const device = mikrotikDeviceById(payload.mikrotik_id || payload.controller_id);
  const result = await collectCapsman(device);
  const current = readJson(ENTITY_FILES.access_points, []);
  const discoveredIds = new Set(result.access_points.map(item => item.id));
  const otherControllers = current.filter(item => item.controller_id !== device.id);
  const missing = current
    .filter(item => item.controller_id === device.id && !discoveredIds.has(item.id))
    .map(item => ({ ...item, status: 'offline', pollError: 'Nao encontrado na ultima coleta', updated_date: new Date().toISOString() }));
  const merged = [...result.access_points, ...missing, ...otherControllers].slice(0, 5000);
  writeJson(ENTITY_FILES.access_points, merged);
  return { success: true, controller: { id: device.id, name: device.name || device.host, host: device.host }, ...result, access_points: merged };
}

async function pollAccessPoints(payload = {}) {
  const devices = getMikrotikDevices();
  const requested = payload.mikrotik_id || payload.controller_id;
  const targets = requested ? devices.filter(device => device.id === requested) : devices;
  if (!targets.length) throw Object.assign(new Error('Nenhum MikroTik cadastrado para coletar Access Points'), { status: 400 });
  const errors = [];
  for (const device of targets) {
    try { await discoverAccessPoints({ controller_id: device.id }); }
    catch (error) { errors.push(`${device.name || device.host}: ${error.message}`); }
  }
  const accessPoints = readJson(ENTITY_FILES.access_points, []);
  if (errors.length === targets.length) throw Object.assign(new Error(errors.join(' | ')), { status: 502 });
  return { success: errors.length === 0, access_points: accessPoints, errors, controllers_checked: targets.length };
}

function publicApProfile(profile) {
  const { passphrase_encrypted, ...safe } = profile;
  return { ...safe, passphrase_configured: !!passphrase_encrypted };
}

function apProfileNames(profile) {
  const suffix = String(profile.id || profile._id || profile.name || 'perfil')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-24) || 'perfil';
  return {
    config: `kore-ap-${suffix}`.slice(0, 48),
    security: `kore-sec-${suffix}`.slice(0, 48),
    datapath: `kore-data-${suffix}`.slice(0, 48),
    comment: `Kore-HotSpot profile ${suffix}`
  };
}

function validateApProfile(payload = {}, existing = {}) {
  const securityMode = payload.security_mode === 'wpa2-psk' ? 'wpa2-psk' : 'open';
  const passphrase = String(payload.passphrase || '');
  if (!String(payload.name || existing.name || '').trim()) throw Object.assign(new Error('Informe o nome do perfil'), { status: 400 });
  if (!String(payload.ssid || existing.ssid || '').trim()) throw Object.assign(new Error('Informe o SSID'), { status: 400 });
  if (securityMode === 'wpa2-psk' && !passphrase && !existing.passphrase_encrypted) throw Object.assign(new Error('Informe uma senha Wi-Fi com pelo menos 8 caracteres'), { status: 400 });
  if (passphrase && (passphrase.length < 8 || passphrase.length > 63)) throw Object.assign(new Error('A senha Wi-Fi deve ter entre 8 e 63 caracteres'), { status: 400 });
  const vlanId = Number(payload.vlan_id || 0);
  if (vlanId && (vlanId < 1 || vlanId > 4094)) throw Object.assign(new Error('VLAN deve estar entre 1 e 4094'), { status: 400 });
  const now = new Date().toISOString();
  const id = existing.id || existing._id || `ap_profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...existing,
    id,
    _id: id,
    name: String(payload.name || existing.name).trim(),
    ssid: String(payload.ssid || existing.ssid).trim().slice(0, 32),
    security_mode: securityMode,
    passphrase_encrypted: passphrase ? encryptSecret(passphrase) : (securityMode === 'open' ? '' : existing.passphrase_encrypted || ''),
    country: String(payload.country || existing.country || 'Brazil').trim(),
    bridge: String(payload.bridge ?? existing.bridge ?? '').trim().replace(/"/g, ''),
    vlan_id: vlanId,
    controller_id: String(payload.controller_id || existing.controller_id || ''),
    reprovision_now: payload.reprovision_now === true,
    status: payload.status === 'inactive' ? 'inactive' : 'active',
    created_date: existing.created_date || now,
    updated_date: now
  };
}

function apProfileCleanupScript(profile, type) {
  const names = apProfileNames(profile);
  if (type === 'wifi') {
    return [
      `:do { /interface wifi provisioning remove [find where comment=${routerQuote(names.comment)}] } on-error={}`,
      `:do { /interface wifi configuration remove [find where name=${routerQuote(names.config)}] } on-error={}`,
      `:do { /interface wifi security remove [find where name=${routerQuote(names.security)}] } on-error={}`,
      `:do { /interface wifi datapath remove [find where name=${routerQuote(names.datapath)}] } on-error={}`
    ].join('; ');
  }
  return [
    `:do { /caps-man provisioning remove [find where comment=${routerQuote(names.comment)}] } on-error={}`,
    `:do { /caps-man configuration remove [find where name=${routerQuote(names.config)}] } on-error={}`,
    `:do { /caps-man security remove [find where name=${routerQuote(names.security)}] } on-error={}`,
    `:do { /caps-man datapath remove [find where name=${routerQuote(names.datapath)}] } on-error={}`
  ].join('; ');
}

function buildApProfileScript(profile, type, options = {}) {
  const names = apProfileNames(profile);
  const secret = profile.security_mode === 'wpa2-psk'
    ? (options.maskSecret ? '********' : decryptSecret(profile.passphrase_encrypted))
    : '';
  const cleanup = apProfileCleanupScript(profile, type);
  const hasDatapath = !!(profile.bridge || profile.vlan_id);
  const warnings = [];
  if (!profile.bridge) warnings.push('Nenhuma bridge foi definida; confirme como o trafego dos CAPs chegara ao Hotspot.');
  if (type === 'wifi' && profile.vlan_id) warnings.push('CAPs com wifi-qcom-ac exigem VLAN configurada localmente no AP; valide o driver antes de aplicar.');
  if (profile.reprovision_now) warnings.push('Os radios conectados serao reprovisionados e poderao desconectar clientes por alguns segundos.');

  const commands = [cleanup];
  if (type === 'wifi') {
    if (profile.security_mode === 'wpa2-psk') {
      commands.push(`/interface wifi security add name=${routerQuote(names.security)} authentication-types=wpa2-psk passphrase=${routerQuote(secret)} ft=yes ft-over-ds=yes`);
    }
    if (hasDatapath) {
      commands.push(`/interface wifi datapath add name=${routerQuote(names.datapath)}${profile.bridge ? ` bridge=${routerQuote(profile.bridge)}` : ''}${profile.vlan_id ? ` vlan-id=${profile.vlan_id}` : ''}`);
    }
    commands.push(`/interface wifi configuration add name=${routerQuote(names.config)} ssid=${routerQuote(profile.ssid)} country=${routerQuote(profile.country)} disabled=no${profile.security_mode === 'wpa2-psk' ? ` security=${routerQuote(names.security)}` : ''}${hasDatapath ? ` datapath=${routerQuote(names.datapath)}` : ''}`);
    commands.push(`/interface wifi provisioning add action=create-dynamic-enabled master-configuration=${routerQuote(names.config)} comment=${routerQuote(names.comment)} disabled=no`);
    commands.push(`/interface wifi provisioning move [find where comment=${routerQuote(names.comment)}] destination=0`);
    if (profile.reprovision_now) commands.push('/interface wifi radio provision [find]');
  } else {
    if (profile.security_mode === 'wpa2-psk') {
      commands.push(`/caps-man security add name=${routerQuote(names.security)} authentication-types=wpa2-psk encryption=aes-ccm group-encryption=aes-ccm passphrase=${routerQuote(secret)}`);
    }
    if (hasDatapath) {
      commands.push(`/caps-man datapath add name=${routerQuote(names.datapath)}${profile.bridge ? ` bridge=${routerQuote(profile.bridge)}` : ''} local-forwarding=yes${profile.vlan_id ? ` vlan-mode=use-tag vlan-id=${profile.vlan_id}` : ''}`);
    }
    commands.push(`/caps-man configuration add name=${routerQuote(names.config)} ssid=${routerQuote(profile.ssid)} country=${routerQuote(profile.country)}${profile.security_mode === 'wpa2-psk' ? ` security=${routerQuote(names.security)}` : ''}${hasDatapath ? ` datapath=${routerQuote(names.datapath)}` : ''}`);
    commands.push(`/caps-man provisioning add action=create-dynamic-enabled master-configuration=${routerQuote(names.config)} name-format=prefix-identity name-prefix="kore-" comment=${routerQuote(names.comment)}`);
    commands.push(`/caps-man provisioning move [find where comment=${routerQuote(names.comment)}] destination=0`);
    if (profile.reprovision_now) commands.push('/caps-man radio provision [find]');
  }
  return { script: commands.join('; '), warnings, names };
}

async function apProfileCapsmanType(profile, requestedType = '') {
  if (['wifi', 'legacy'].includes(requestedType)) return requestedType;
  const storedType = readJson(ENTITY_FILES.access_points, []).find(item => item.controller_id === profile.controller_id)?.capsman_type;
  if (['wifi', 'legacy'].includes(storedType)) return storedType;
  const device = mikrotikDeviceById(profile.controller_id);
  return (await collectCapsman(device)).type;
}

async function accessPointProfiles(payload = {}) {
  const action = String(payload.action || 'list');
  const profiles = readJson(AP_PROFILES_FILE, []);
  if (action === 'list') return { profiles: profiles.map(publicApProfile) };

  if (action === 'save') {
    const existing = profiles.find(item => item.id === payload.id || item._id === payload.id) || {};
    const profile = validateApProfile(payload, existing);
    writeJson(AP_PROFILES_FILE, [profile, ...profiles.filter(item => item.id !== profile.id && item._id !== profile.id)].slice(0, 500));
    return { profile: publicApProfile(profile) };
  }

  const profile = profiles.find(item => item.id === payload.id || item._id === payload.id);
  if (!profile) throw Object.assign(new Error('Perfil de Access Point nao encontrado'), { status: 404 });
  if (action === 'delete') {
    if (profile.last_apply_status === 'success') {
      throw Object.assign(new Error('Remova primeiro o perfil do CAPsMAN antes de exclui-lo do sistema'), { status: 409 });
    }
    writeJson(AP_PROFILES_FILE, profiles.filter(item => item.id !== profile.id && item._id !== profile.id));
    return { success: true };
  }

  const type = action === 'rollback' && ['wifi', 'legacy'].includes(profile.last_applied_type)
    ? profile.last_applied_type
    : await apProfileCapsmanType(profile, payload.capsman_type);
  if (action === 'preview') {
    const preview = buildApProfileScript(profile, type, { maskSecret: true });
    return { profile: publicApProfile(profile), capsman_type: type, ...preview };
  }

  const device = mikrotikDeviceById(profile.controller_id);
  if (!device) throw Object.assign(new Error('Controladora MikroTik nao encontrada'), { status: 400 });
  if (action === 'apply') {
    const backupName = `kore-before-ap-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
    await runMikrotikKeyCommand(device, `/system backup save name=${routerQuote(backupName)}`, 30000);
    const generated = buildApProfileScript(profile, type);
    try {
      await runMikrotikKeyCommand(device, generated.script, 30000);
    } catch (error) {
      const failed = { ...profile, last_apply_status: 'error', last_apply_error: error.message, last_backup: `${backupName}.backup`, updated_date: new Date().toISOString() };
      writeJson(AP_PROFILES_FILE, profiles.map(item => item.id === profile.id || item._id === profile.id ? failed : item));
      throw Object.assign(new Error(`Falha ao aplicar perfil; backup preservado em ${backupName}.backup: ${error.message}`), { status: error.status || 502 });
    }
    const updated = { ...profile, last_applied_at: new Date().toISOString(), last_applied_type: type, last_backup: `${backupName}.backup`, last_apply_status: 'success', updated_date: new Date().toISOString() };
    writeJson(AP_PROFILES_FILE, profiles.map(item => item.id === profile.id || item._id === profile.id ? updated : item));
    return { success: true, profile: publicApProfile(updated), capsman_type: type, backup: updated.last_backup, warnings: generated.warnings };
  }
  if (action === 'rollback') {
    await runMikrotikKeyCommand(device, apProfileCleanupScript(profile, type), 20000);
    const updated = { ...profile, last_apply_status: 'removed', last_removed_at: new Date().toISOString(), updated_date: new Date().toISOString() };
    writeJson(AP_PROFILES_FILE, profiles.map(item => item.id === profile.id || item._id === profile.id ? updated : item));
    return { success: true, profile: publicApProfile(updated), capsman_type: type, backup: profile.last_backup || '' };
  }
  throw Object.assign(new Error('Acao de perfil invalida'), { status: 400 });
}

async function mikrotikHotspotSessions() {
  const devices = getMikrotikDevices();
  if (!devices.length) return { sessions: [], errors: ['Nenhum MikroTik cadastrado'], devices_checked: 0 };
  const sessions = [];
  const errors = [];
  await ensureSshKey();
  for (const device of devices.slice(0, 5)) {
    const sshBase = ['-i', KEY_PATH, '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(device.port || '22'), `${device.user || 'kore-api'}@${device.host}`];
    let active;
    try {
      active = await run('ssh', [...sshBase, '/ip hotspot active print stats detail without-paging'], 12000);
      if (!parseKeyValueRows(active.stdout).length) {
        active = await run('ssh', [...sshBase, '/ip hotspot active print detail without-paging'], 12000);
      }
    } catch (error) {
      errors.push(`${device.name || device.host}: ${error.message}`);
      continue;
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
  return { sessions, errors, devices_checked: Math.min(devices.length, 5) };
}

async function radiusSessions() {
  const [status, sql, mikrotikResult] = await Promise.all([
    radiusStatus().catch(error => ({ status: 'offline', error: error.message })),
    radiusSqlSessions().catch(() => []),
    mikrotikHotspotSessions().catch(error => ({ sessions: [], errors: [error.message], devices_checked: 0 }))
  ]);
  const mikrotik = mikrotikResult.sessions;
  const byKey = new Map();
  // O MikroTik confirma presenca. O radacct apenas enriquece a sessao, pois
  // registros sem Accounting-Stop podem permanecer abertos indevidamente.
  for (const session of mikrotik) {
    const key = `${normalizeText(session.username)}-${normalizeClientIp(session.framedIp)}-${normalizeMac(session.macAddress)}`;
    const current = sql.find(item =>
      normalizeText(item.username) === normalizeText(session.username) ||
      (normalizeClientIp(item.framedIp) && normalizeClientIp(item.framedIp) === normalizeClientIp(session.framedIp)) ||
      (normalizeMac(item.macAddress) && normalizeMac(item.macAddress) === normalizeMac(session.macAddress))
    );
    byKey.set(key, {
      ...(current || {}),
      ...session,
      fullName: current?.fullName && current.fullName !== '-' ? current.fullName : session.fullName,
      planName: current?.planName && current.planName !== '-' ? current.planName : session.planName,
      downloadMb: Math.max(Number(current?.downloadMb || 0), Number(session.downloadMb || 0)),
      uploadMb: Math.max(Number(current?.uploadMb || 0), Number(session.uploadMb || 0)),
      sessionTime: session.sessionTime || current?.sessionTime || '-'
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
  const collection = {
    healthy: mikrotikResult.devices_checked > 0 && mikrotikResult.errors.length === 0,
    devices_checked: mikrotikResult.devices_checked,
    errors: mikrotikResult.errors
  };
  return { success: collection.healthy, status, collection, sessions };
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
    rx_mbps: Number((rxBps / 1000 / 1000).toFixed(3)),
    tx_mbps: Number((txBps / 1000 / 1000).toFixed(3)),
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
  const file = tenantFile(CAPTIVE_DB);
  migrateLegacyFile(CAPTIVE_DB, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeCaptiveDb(items) {
  const file = tenantFile(CAPTIVE_DB);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
}

function captivePublicConfig(payload = {}) {
  const allowedKeys = new Set([
    'captive_portal_title', 'captive_portal_subtitle', 'captive_portal_logo_url',
    'captive_prospect_plan_id', 'captive_vip_plan_id', 'captive_redirect_url'
  ]);
  const settings = Object.fromEntries(
    readJson(ENTITY_FILES.settings, [])
      .filter(item => allowedKeys.has(item.key))
      .map(item => [item.key, item.value])
  );
  const mac = normalizeMac(payload.mac);
  const prospect = mac ? readCaptiveDb().find(item => normalizeMac(item.mac_address) === mac) : null;
  return { settings, prospect: prospect || null };
}

function ensureCaptivePlanClient(payload = {}) {
  const clients = readJson(ENTITY_FILES.clients, []);
  const prospects = readCaptiveDb();
  const mac = normalizeMac(payload.mac);
  const cpf = normalizeDigits(payload.cpf);
  const phone = normalizeDigits(payload.phone);
  const prospect = prospects.find(item =>
    (mac && normalizeMac(item.mac_address) === mac) ||
    (cpf && normalizeDigits(item.cpf) === cpf) ||
    (phone && normalizeDigits(item.phone) === phone)
  );
  let client = clients.find(item =>
    (mac && normalizeMac(item.mac_address) === mac) ||
    (cpf && normalizeDigits(item.cpf) === cpf) ||
    (phone && normalizeDigits(item.phone) === phone)
  );
  if (client) return { client };
  const source = prospect || payload;
  if (!source.name || (!normalizeDigits(source.phone) && !normalizeDigits(source.cpf))) {
    throw Object.assign(new Error('Identificacao insuficiente para selecionar um plano'), { status: 400 });
  }
  const id = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  client = {
    id,
    _id: id,
    name: source.name,
    phone: source.phone || '',
    cpf: source.cpf || '',
    cep: source.cep || '',
    mac_address: mac || normalizeMac(source.mac_address),
    ip_address: normalizeClientIp(payload.ip) || normalizeClientIp(source.ip_address),
    status: 'pending_payment',
    source: 'captive_portal',
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  writeJson(ENTITY_FILES.clients, [client, ...clients].slice(0, 5000));
  return { client };
}

function readJson(file, fallback = []) {
  const target = tenantFile(file);
  migrateLegacyFile(file, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(fallback, null, 2));
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  const target = tenantFile(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

function ensureRuntimeSettings() {
  const settings = readJson(ENTITY_FILES.settings, []);
  const runtime = [
    { key: 'vpn_server_host', value: PUBLIC_HOST, category: 'system', label: 'VPN Server Host' },
    { key: 'public_base_url', value: process.env.KORE_PUBLIC_URL || (PUBLIC_HOST ? `http://${PUBLIC_HOST}:8080` : ''), category: 'system', label: 'URL Publica' }
  ].filter(item => item.value);
  let changed = false;
  for (const item of runtime) {
    const existing = settings.find(setting => setting.key === item.key);
    if (!existing) {
      const id = `setting_${item.key}`;
      settings.push({ id, _id: id, ...item, created_date: new Date().toISOString(), updated_date: new Date().toISOString() });
      changed = true;
    } else if (item.key === 'vpn_server_host' && existing.value !== item.value) {
      existing.value = item.value;
      existing.updated_date = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeJson(ENTITY_FILES.settings, settings);
}

function readGlobalJson(file, fallback = []) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeGlobalJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
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

function ensureDefaultAdmins({ resetPassword = false, force = false } = {}) {
  const scopedProvider = currentTenant().id !== DEFAULT_TENANT_ID ? providerForTenantRaw(currentTenant().id) : null;
  if (!force && scopedProvider?.contact_email) {
    ensureProviderAdmin(scopedProvider);
  }
  const users = readJson(ENTITY_FILES.admins, []);
  if (!force && users.length > 0) {
    let changedExisting = false;
    for (const user of users) {
      if (!user.password_hash && user.password) {
        user.password_hash = passwordHash(user.password);
        delete user.password;
        changedExisting = true;
      }
      if (currentTenant().id === DEFAULT_TENANT_ID && user.role === 'admin' && user.permissions?.includes('*')) {
        user.role = 'super_admin';
        user.scope = 'system';
        changedExisting = true;
      }
      if (currentTenant().id !== DEFAULT_TENANT_ID && (user.permissions?.includes('*') || user.role === 'admin' || user.role === 'super_admin')) {
        user.role = 'provider_admin';
        user.scope = 'tenant';
        user.permissions = TENANT_ADMIN_PERMISSIONS;
        changedExisting = true;
      }
      if ((user.role === 'admin' || user.role === 'super_admin') && !Array.isArray(user.permissions)) {
        user.permissions = ['*'];
        changedExisting = true;
      }
    }
    if (changedExisting) writeJson(ENTITY_FILES.admins, users);
    return users;
  }
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
        scope: 'system',
        permissions: ['*'],
        password_hash: passwordHash(DEFAULT_ADMIN_PASSWORD),
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString()
      });
      changed = true;
    } else {
      existing.role = 'super_admin';
      existing.status = 'active';
      existing.scope = 'system';
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
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
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

  const userManagementActions = new Set(['listUsers', 'createUser', 'updateUser', 'deleteUser', 'resetDefaults']);
  if (userManagementActions.has(action) && !['super_admin', 'provider_admin', 'admin'].includes(session.role)) {
    throw Object.assign(new Error('Acesso negado para gerenciar usuarios'), { status: 403 });
  }

  if (action === 'resetDefaults') {
    if (!['super_admin', 'admin'].includes(session.role)) throw Object.assign(new Error('Acesso negado'), { status: 403 });
    const resetUsers = ensureDefaultAdmins({ resetPassword: true, force: true });
    writeJson(ENTITY_FILES.admin_sessions, [session]);
    return { success: true, email: DEFAULT_ADMINS.map(user => user.email).join(' / '), password: DEFAULT_ADMIN_PASSWORD, users: resetUsers.map(publicAdmin) };
  }

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
  const fallback = process.env.KORE_PUBLIC_URL || (PUBLIC_HOST ? `http://${PUBLIC_HOST}:8081` : 'http://127.0.0.1:8081');
  return String(getSetting('public_base_url') || fallback).replace(/\/+$/, '');
}

function upsertById(file, item) {
  const items = readJson(file, []);
  const id = item.id || item._id;
  const next = [item, ...items.filter(existing => existing.id !== id && existing._id !== id)];
  writeJson(file, next.slice(0, 5000));
  return item;
}

function providerStats(tenantId) {
  const dir = path.join(TENANTS_DIR, safeTenantId(tenantId));
  const read = (name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  };
  return {
    clients: read('clients.json').length,
    prospects: read('captive-prospects.json').length,
    plans: read('plans.json').length,
    users: read('admin-users.json').length,
    vouchers: read('vouchers.json').length,
    mikrotiks: read('settings.json').filter(item => item.category === 'mikrotik_device').length
  };
}

function latestProviderBilling(providerId) {
  const billings = readGlobalJson(PROVIDER_BILLING_FILE, []);
  const latest = billings
    .filter(item => item.provider_id === providerId || item.tenant_id === providerId)
    .sort((a, b) => new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0))[0] || null;
  if (!latest) return null;
  const { raw, qr_code, qr_code_base64, ...safe } = latest;
  return safe;
}

function publicProvider(provider) {
  const providerId = provider.tenant_id || provider.id;
  return {
    ...provider,
    latest_billing: latestProviderBilling(providerId),
    stats: providerStats(provider.tenant_id || provider.id)
  };
}

function providerForTenantRaw(tenantId = currentTenant().id) {
  const providers = readGlobalJson(PROVIDERS_FILE, []);
  return providers.find(item => (
    safeTenantId(item.tenant_id || item.id) === safeTenantId(tenantId) ||
    providerDomain(item) === String(tenantId || '').trim().toLowerCase()
  )) || null;
}

function providerForTenant(tenantId = currentTenant().id) {
  return providerForTenantRaw(tenantId);
}

function licenseState(tenantId = currentTenant().id) {
  const provider = providerForTenant(tenantId);
  if (!provider) {
    return { ok: true, tenant_id: tenantId, status: 'unregistered', label: 'Tenant sem contrato cadastrado', provider: null, stats: providerStats(tenantId), warnings: [] };
  }
  const stats = providerStats(provider.tenant_id || provider.id);
  const warnings = [];
  const maxClients = Number(provider.max_clients || 0);
  const maxMikrotiks = Number(provider.max_mikrotiks || 0);
  const graceDays = Number(provider.grace_days || 0);
  const dueDate = provider.contract_due_date ? new Date(`${provider.contract_due_date}T23:59:59`) : null;
  const graceLimit = dueDate ? new Date(dueDate.getTime() + graceDays * 24 * 60 * 60 * 1000) : null;
  const now = new Date();
  const overdue = !!(dueDate && now > dueDate);
  const graceExpired = !!(graceLimit && now > graceLimit);
  const isFreePlan = String(provider.commercial_plan || '').toLowerCase() === 'free';
  if (maxClients > 0 && stats.clients >= maxClients) warnings.push('Limite de clientes atingido');
  if (maxMikrotiks > 0 && stats.mikrotiks >= maxMikrotiks) warnings.push('Limite de MikroTiks atingido');
  if (!isFreePlan && overdue && !graceExpired) warnings.push('Mensalidade vencida em periodo de tolerancia');
  if (!isFreePlan && graceExpired) warnings.push('Mensalidade vencida');
  const blocked = ['suspended', 'canceled'].includes(String(provider.status || '').toLowerCase());
  const financialBlocked = !isFreePlan && graceExpired && provider.block_on_overdue !== false;
  return {
    ok: !blocked && !financialBlocked,
    tenant_id: provider.tenant_id || provider.id,
    status: provider.status || 'active',
    label: blocked ? 'Licenca bloqueada' : financialBlocked ? 'Bloqueado por inadimplencia' : 'Licenca ativa',
    provider: publicProvider(provider),
    stats,
    warnings,
    billing: {
      monthly_price: Number(provider.monthly_price || 0),
      due_date: provider.contract_due_date || '',
      grace_days: graceDays,
      last_payment_date: provider.last_payment_date || '',
      overdue: !isFreePlan && overdue,
      grace_expired: !isFreePlan && graceExpired,
      block_on_overdue: !isFreePlan && provider.block_on_overdue !== false
    }
  };
}

function assertTenantLicense({ action = 'write', resource = '' } = {}) {
  const state = licenseState();
  if (!state.ok) {
    throw Object.assign(new Error(state.label || 'Licenca do provedor bloqueada'), { status: 402, license: state });
  }
  const provider = state.provider;
  if (!provider) return state;
  if (action === 'create' && resource === 'client' && Number(provider.max_clients || 0) > 0 && state.stats.clients >= Number(provider.max_clients || 0)) {
    throw Object.assign(new Error('Limite de clientes do provedor atingido'), { status: 402, license: state });
  }
  if (action === 'create' && resource === 'mikrotik' && Number(provider.max_mikrotiks || 0) > 0 && state.stats.mikrotiks >= Number(provider.max_mikrotiks || 0)) {
    throw Object.assign(new Error('Limite de MikroTiks do provedor atingido'), { status: 402, license: state });
  }
  return state;
}

function assertSystemTenant() {
  if (currentTenant().id !== DEFAULT_TENANT_ID) {
    throw Object.assign(new Error('Modulo exclusivo do administrador geral do sistema'), { status: 403 });
  }
}

function markProviderPaid(providerId, { last_payment_date, months = 1, next_due_date } = {}) {
  const providers = readGlobalJson(PROVIDERS_FILE, []);
  const target = providers.find(item => item.id === providerId || item._id === providerId || item.tenant_id === providerId);
  if (!target) throw Object.assign(new Error('Provedor nao encontrado'), { status: 404 });

  const paidAt = String(last_payment_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const baseDate = next_due_date ? new Date(`${next_due_date}T00:00:00`) : new Date(`${paidAt}T00:00:00`);
  const nextDue = new Date(baseDate);
  nextDue.setMonth(nextDue.getMonth() + Number(months || 1));

  const updated = providers.map(item => {
    if (item.id !== providerId && item._id !== providerId && item.tenant_id !== providerId) return item;
    return {
      ...item,
      status: item.status === 'suspended' ? 'active' : item.status,
      last_payment_date: paidAt,
      contract_due_date: nextDue.toISOString().slice(0, 10),
      updated_date: new Date().toISOString()
    };
  });
  writeGlobalJson(PROVIDERS_FILE, updated);
  return updated.find(item => item.id === providerId || item._id === providerId || item.tenant_id === providerId);
}

function providerCommercialPrice(planId, fallback = 0) {
  return Number(PROVIDER_COMMERCIAL_PLANS[String(planId || '').toLowerCase()]?.price ?? fallback ?? 0);
}

function providerPayload(body = {}, tenantId = '') {
  const requestedCommercialPlan = String(body.commercial_plan || 'starter').toLowerCase();
  const commercialPlan = Object.hasOwn(PROVIDER_COMMERCIAL_PLANS, requestedCommercialPlan) ? requestedCommercialPlan : 'starter';
  return {
    name: String(body.name || tenantId).trim(),
    legal_name: String(body.legal_name || '').trim(),
    document: String(body.document || '').trim(),
    domain: String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    contact_name: String(body.contact_name || '').trim(),
    contact_email: String(body.contact_email || '').trim().toLowerCase(),
    contact_phone: String(body.contact_phone || '').trim(),
    commercial_plan: commercialPlan,
    status: String(body.status || 'active'),
    monthly_price: providerCommercialPrice(commercialPlan, body.monthly_price),
    contract_due_date: String(body.contract_due_date || '').slice(0, 10),
    grace_days: Number(body.grace_days ?? 5),
    last_payment_date: String(body.last_payment_date || '').slice(0, 10),
    block_on_overdue: commercialPlan === 'free' ? false : body.block_on_overdue !== false,
    max_clients: Number(body.max_clients || 0),
    max_mikrotiks: Number(body.max_mikrotiks || 0),
    notes: String(body.notes || '')
  };
}

function tenantJsonFile(tenantId, fileName) {
  return path.join(TENANTS_DIR, safeTenantId(tenantId), fileName);
}

function readTenantJson(tenantId, fileName, fallback = []) {
  const file = tenantJsonFile(tenantId, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeTenantJson(tenantId, fileName, value) {
  const file = tenantJsonFile(tenantId, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function ensureProviderAdmin(provider, options = {}) {
  const tenantId = provider.tenant_id || provider.id;
  const email = normalizeEmail(provider.contact_email);
  if (!tenantId || !email) return null;

  const users = readTenantJson(tenantId, 'admin-users.json', []);
  const existing = users.find(user => normalizeEmail(user.email) === email);
  if (existing) {
    if (options.resetPassword) {
      existing.full_name = provider.contact_name || provider.name || existing.full_name || email;
      existing.role = 'provider_admin';
      existing.status = 'active';
      existing.scope = 'tenant';
      existing.permissions = TENANT_ADMIN_PERMISSIONS;
      existing.password_hash = passwordHash(DEFAULT_ADMIN_PASSWORD);
      delete existing.password;
      existing.updated_date = new Date().toISOString();
      writeTenantJson(tenantId, 'admin-users.json', users);
      return { email, password: DEFAULT_ADMIN_PASSWORD, created: false, reset: true };
    }
    return { email, password: null, created: false, reset: false };
  }

  const id = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id,
    _id: id,
    email,
    full_name: provider.contact_name || provider.name || email,
    role: 'provider_admin',
    status: 'active',
    scope: 'tenant',
    permissions: TENANT_ADMIN_PERMISSIONS,
    password_hash: passwordHash(DEFAULT_ADMIN_PASSWORD),
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  writeTenantJson(tenantId, 'admin-users.json', [user, ...users]);
  return { email, password: DEFAULT_ADMIN_PASSWORD, created: true };
}

function compactCertificateError(message) {
  const lines = String(message || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^saving debug log/i.test(line));
  return (lines.length ? lines.slice(-10).join(' | ') : String(message || 'Erro ao emitir certificado')).slice(0, 1600);
}

async function assertDomainPointsToServer(domain) {
  if (!PUBLIC_HOST || /^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return;
  let addresses = [];
  try {
    addresses = await dns.resolve4(domain);
  } catch (error) {
    throw new Error(`DNS do dominio ${domain} nao resolveu registro A. Corrija o DNS antes de emitir o certificado.`);
  }
  if (!addresses.includes(PUBLIC_HOST)) {
    throw new Error(`DNS do dominio ${domain} aponta para ${addresses.join(', ')}, mas esta VPS esta configurada como ${PUBLIC_HOST}. Corrija o registro A do dominio e tente novamente.`);
  }
}

function providerDomain(provider) {
  return String(provider?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '').split('/')[0];
}

function validateCertificateDomain(domain) {
  const clean = providerDomain({ domain });
  if (!clean || clean === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) {
    throw Object.assign(new Error('Informe um dominio valido para emitir certificado'), { status: 400 });
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
    throw Object.assign(new Error('Dominio invalido para certificado'), { status: 400 });
  }
  return clean;
}

async function issueProviderCertificate(providerId) {
  const providers = readGlobalJson(PROVIDERS_FILE, []);
  const provider = providers.find(item => item.id === providerId || item._id === providerId || item.tenant_id === providerId);
  if (!provider) throw Object.assign(new Error('Provedor nao encontrado'), { status: 404 });
  const domain = validateCertificateDomain(provider.domain);
  const tenantId = provider.tenant_id || provider.id;
  const email = provider.contact_email || CERTBOT_EMAIL;
  const nginxFile = `/etc/nginx/conf.d/kore-hotspot-provider-${safeTenantId(tenantId)}.conf`;

  try {
    fs.mkdirSync(path.join(WEB_DIR, '.well-known', 'acme-challenge'), { recursive: true });
    fs.writeFileSync(nginxFile, `# Gerenciado pelo Kore-HotSpot - HTTP do provedor ${tenantId}
server {
    listen 80;
    server_name ${domain};
    root ${WEB_DIR};
    index index.html;

    location ^~ /.well-known/acme-challenge/ {
        default_type "text/plain";
        try_files $uri =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`);
    await run('nginx', ['-t'], 30000);
    await run('systemctl', ['reload', 'nginx'], 30000).catch(() => run('systemctl', ['restart', 'nginx'], 30000));
    await run('certbot', [
      'certonly',
      '--webroot',
      '-w', WEB_DIR,
      '-d', domain,
      '--cert-name', domain,
      '--preferred-challenges', 'http',
      '--non-interactive',
      '--agree-tos',
      '-m', email,
      '--keep-until-expiring'
    ], 120000);

    fs.writeFileSync(nginxFile, `# Gerenciado pelo Kore-HotSpot - HTTPS do provedor ${tenantId}
server {
    listen 80;
    server_name ${domain};
    root ${WEB_DIR};

    location ^~ /.well-known/acme-challenge/ {
        default_type "text/plain";
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${domain};
    root ${WEB_DIR};
    index index.html;

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`);
    await run('nginx', ['-t'], 30000);
    await run('systemctl', ['reload', 'nginx'], 30000).catch(() => run('systemctl', ['restart', 'nginx'], 30000));
    await run('systemctl', ['enable', '--now', 'certbot.timer'], 30000).catch(() => null);
    fs.mkdirSync('/etc/letsencrypt/renewal-hooks/deploy', { recursive: true });
    const hookFile = '/etc/letsencrypt/renewal-hooks/deploy/kore-hotspot-reload-nginx.sh';
    if (!fs.existsSync(hookFile)) {
      fs.writeFileSync(hookFile, '#!/usr/bin/env bash\nsystemctl reload nginx || true\n');
      fs.chmodSync(hookFile, 0o755);
    }

    const updated = providers.map(item => {
      if (item.id !== providerId && item._id !== providerId && item.tenant_id !== providerId) return item;
      return {
        ...item,
        domain,
        ssl_status: 'active',
        ssl_domain: domain,
        ssl_error: '',
        ssl_issued_at: new Date().toISOString(),
        ssl_nginx_file: nginxFile,
        updated_date: new Date().toISOString()
      };
    });
    writeGlobalJson(PROVIDERS_FILE, updated);
    return { success: true, provider: publicProvider(updated.find(item => item.id === providerId || item._id === providerId || item.tenant_id === providerId)), domain, nginx_file: nginxFile };
  } catch (error) {
    const updated = providers.map(item => {
      if (item.id !== providerId && item._id !== providerId && item.tenant_id !== providerId) return item;
      return {
        ...item,
        domain,
        ssl_status: 'error',
        ssl_error: compactCertificateError(error.message || error),
        updated_date: new Date().toISOString()
      };
    });
    writeGlobalJson(PROVIDERS_FILE, updated);
    throw error;
  }
}

async function providersCrud(req) {
  const [pathname] = req.url.split('?');
  const parts = pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(parts[2] || '');
  const providers = readGlobalJson(PROVIDERS_FILE, []);
  const findProvider = (providerId) => providers.find(item => item.id === providerId || item._id === providerId || item.tenant_id === providerId);
  console.log(`[providers] ${req.method} ${req.url}`);

  if (req.method === 'GET') {
    return { providers: providers.map(publicProvider), commercial_plans: PROVIDER_COMMERCIAL_PLANS };
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const providerName = String(body.name || '').trim();
    if (!providerName) throw Object.assign(new Error('Nome do provedor obrigatorio'), { status: 400 });
    const tenantId = safeTenantId(body.tenant_id || body.domain || body.name || `provedor-${Date.now()}`);
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      throw Object.assign(new Error('Informe um Tenant ID valido para o provedor'), { status: 400 });
    }
    if (providers.some(item => item.tenant_id === tenantId || item.id === tenantId)) {
      throw Object.assign(new Error('Ja existe provedor com este tenant'), { status: 409 });
    }
    const nowIso = new Date().toISOString();
    const payload = providerPayload(body, tenantId);
    const provider = {
      id: tenantId,
      _id: tenantId,
      tenant_id: tenantId,
      name: providerName,
      ...payload,
      created_date: nowIso,
      updated_date: nowIso
    };
    fs.mkdirSync(path.join(TENANTS_DIR, tenantId), { recursive: true });
    const admin_credentials = ensureProviderAdmin(provider);
    writeGlobalJson(PROVIDERS_FILE, [provider, ...providers].slice(0, 1000));
    return { provider: publicProvider(provider), admin_credentials };
  }

  if (req.method === 'PUT' && id) {
    const body = await readBody(req);
    const existingProvider = findProvider(id);
    if (body.action === 'upsert' && !existingProvider) {
      const tenantId = safeTenantId(id || body.tenant_id || body.domain || body.name || `provedor-${Date.now()}`);
      const providerName = String(body.name || '').trim();
      if (!providerName) throw Object.assign(new Error('Nome do provedor obrigatorio'), { status: 400 });
      if (!tenantId || tenantId === DEFAULT_TENANT_ID) throw Object.assign(new Error('Informe um Tenant ID valido para o provedor'), { status: 400 });
      if (providers.some(item => item.tenant_id === tenantId || item.id === tenantId)) throw Object.assign(new Error('Ja existe provedor com este tenant'), { status: 409 });
      const nowIso = new Date().toISOString();
      const provider = {
        id: tenantId,
        _id: tenantId,
        tenant_id: tenantId,
        ...providerPayload(body, tenantId),
        name: providerName,
        created_date: nowIso,
        updated_date: nowIso
      };
      fs.mkdirSync(path.join(TENANTS_DIR, tenantId), { recursive: true });
      const admin_credentials = ensureProviderAdmin(provider);
      writeGlobalJson(PROVIDERS_FILE, [provider, ...providers].slice(0, 1000));
      return { created: true, provider: publicProvider(provider), admin_credentials, commercial_plans: PROVIDER_COMMERCIAL_PLANS };
    }
    if (!existingProvider) throw Object.assign(new Error('Provedor nao encontrado para atualizar'), { status: 404 });
    if (body.action === 'markPaid') {
      return { provider: publicProvider(markProviderPaid(id, body)) };
    }
    if (body.action === 'createPix') {
      return createProviderPix(id);
    }
    if (body.action === 'checkPix') {
      return refreshProviderBillingStatus({ id: body.billing_id, provider_payment_id: body.provider_payment_id });
    }
    if (body.action === 'issueCertificate') {
      return issueProviderCertificate(id);
    }
    if (body.action === 'resetProviderAdmin') {
      const admin_credentials = ensureProviderAdmin(existingProvider, { resetPassword: true });
      return { provider: publicProvider(existingProvider), admin_credentials, commercial_plans: PROVIDER_COMMERCIAL_PLANS };
    }
    const updated = providers.map(item => {
      if (item.id !== id && item._id !== id && item.tenant_id !== id) return item;
      const payload = providerPayload({ ...item, ...body }, item.tenant_id || item.id);
      return {
        ...item,
        ...payload,
        updated_date: new Date().toISOString()
      };
    });
    writeGlobalJson(PROVIDERS_FILE, updated);
    const updatedProvider = updated.find(item => item.id === id || item._id === id || item.tenant_id === id);
    const admin_credentials = ensureProviderAdmin(updatedProvider);
    return { created: false, provider: publicProvider(updatedProvider), admin_credentials, commercial_plans: PROVIDER_COMMERCIAL_PLANS };
  }

  if (req.method === 'DELETE' && id) {
    const target = providers.find(item => item.id === id || item._id === id || item.tenant_id === id);
    if (!target) throw Object.assign(new Error('Provedor nao encontrado'), { status: 404 });
    if (target.tenant_id === DEFAULT_TENANT_ID) {
      throw Object.assign(new Error('Nao e permitido excluir o tenant padrao'), { status: 400 });
    }
    writeGlobalJson(PROVIDERS_FILE, providers.filter(item => item.id !== id && item._id !== id && item.tenant_id !== id));
    return { success: true };
  }

  return null;
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
    if (parsed.entity === 'clients') assertTenantLicense({ action: 'create', resource: 'client' });
    if (parsed.entity === 'settings' && body.category === 'mikrotik_device') assertTenantLicense({ action: 'create', resource: 'mikrotik' });
    if (parsed.entity !== 'clients' && !(parsed.entity === 'settings' && body.category === 'mikrotik_device')) assertTenantLicense({ action: 'write', resource: parsed.entity });
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
    assertTenantLicense({ action: 'write', resource: parsed.entity });
    const updated = items.map(item => (
      item.id === parsed.id || item._id === parsed.id ? { ...item, ...body, updated_date: new Date().toISOString() } : item
    ));
    writeJson(file, updated);
    return { item: updated.find(item => item.id === parsed.id || item._id === parsed.id) || null };
  }

  if (req.method === 'DELETE' && parsed.id) {
    assertTenantLicense({ action: 'write', resource: parsed.entity });
    const removedItem = items.find(item => item.id === parsed.id || item._id === parsed.id);
    if (parsed.entity === 'clients' && removedItem) {
      await cleanupMikrotikAccess(removedItem);
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

async function ensureHotspotProfile({ host, port = '22', user = 'kore-api', plan = {} }) {
  if (!host) throw new Error('MikroTik nao definido para criar o perfil');
  const profile = hotspotProfileName(plan);
  const rate = planRateLimit(plan);
  if (!rate) return { profile, rate_limit: '' };
  const command = `:do { /ip hotspot user profile remove [find where name=${profile}] } on-error={}; /ip hotspot user profile add name=${profile} rate-limit=${rate} shared-users=1; /ip hotspot user profile print detail where name=${profile}`;
  await ensureSshKey();
  const { stdout } = await runSshWithRetry(['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${host}`, command], 15000);
  return { profile, rate_limit: rate, raw: stdout };
}

async function resolvePendingHotspotHost({ host, port = '22', user = 'kore-api', mac, ip }) {
  const requestedMac = normalizeMac(mac);
  const requestedIp = normalizeClientIp(ip);
  if (requestedMac && requestedIp) return { mac: requestedMac, ip: requestedIp };
  await ensureSshKey();
  const args = ['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${host}`, '/ip hotspot host print detail without-paging'];
  const { stdout } = await runSshWithRetry(args, 15000);
  const hosts = parseKeyValueRows(stdout).filter(row => row.address || row['mac-address']);
  const exact = hosts.find(row =>
    (requestedIp && normalizeClientIp(row.address) === requestedIp) ||
    (requestedMac && normalizeMac(row['mac-address']) === requestedMac)
  );
  const selected = exact || (hosts.length === 1 ? hosts[0] : null);
  return {
    mac: requestedMac || normalizeMac(selected?.['mac-address']),
    ip: requestedIp || normalizeClientIp(selected?.address)
  };
}

async function createHotspotUser({ host, port = '22', user = 'kore-api', username, password, mac, ip, minutes = 30, permanent = false, plan = {} }) {
  if (!host) throw new Error('MikroTik nao definido para criar o usuario');
  const pendingHost = await resolvePendingHotspotHost({ host, port, user, mac, ip });
  const cleanMac = pendingHost.mac;
  const cleanIp = pendingHost.ip;
  if (!cleanMac && !cleanIp) {
    throw new Error('Dispositivo nao identificado pelo Hotspot. Reconecte ao Wi-Fi e abra novamente a pagina de login');
  }
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
    cleanMac ? `:do { /ip hotspot active remove [find where mac-address="${cleanMac}"] } on-error={}` : '',
    cleanIp ? `:do { /ip hotspot active login user=${login} password="${pass}" ip=${cleanIp} } on-error={ :error "Falha ao ativar usuario Hotspot" }` : '',
    cleanIp ? `:delay 1s; :if ([:len [/ip hotspot active find where user=${login}]] = 0) do={ :error "Usuario criado, mas a sessao Hotspot nao foi ativada" }` : '',
    scheduler.replace(/^; /, ''),
    `/ip hotspot user print detail where name=${login}`
  ].filter(Boolean).join('; ');

  await ensureSshKey();
  const { stdout } = await runSshWithRetry(['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(port || '22'), `${user || 'kore-api'}@${host}`, command], 15000);
  return { authorized: true, active_login: !!cleanIp, mode: 'hotspot_user', host, username: login, password: pass, profile, mac: cleanMac, ip: cleanIp, minutes: ttlMinutes, expires: !permanent, scheduler: permanent ? null : schedulerName, ...profileResult, raw: stdout };
}

async function authorizeHotspot({ host, port = '22', user = 'kore-api', mac, ip, minutes = 30, permanent = false, plan = null }) {
  if (!host) throw new Error('MikroTik nao definido para autorizar o acesso');
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

async function removeHotspotAuthorization({ host, port = '22', user = 'kore-api', mac, ip }) {
  if (!host) throw new Error('MikroTik nao definido para remover o acesso');
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
  const targets = devices.length ? devices : (item.mikrotik_host ? [{ host: item.mikrotik_host, port: item.mikrotik_port || '22', user: item.mikrotik_user || 'kore-api' }] : []);
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
  if (!targets.length) throw new Error('Nenhum MikroTik cadastrado para revogar o acesso do cliente');
  await ensureSshKey();
  const results = [];
  const errors = [];
  for (const device of targets.slice(0, 5)) {
    const host = device.host || device.vpn_remote_ip || device.remote_ip;
    if (!host) continue;
    try {
      const { stdout } = await runSshWithRetry(['-i', KEY_PATH, '-o', 'LogLevel=ERROR', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'HostkeyAlgorithms=+ssh-rsa', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-p', String(device.port || '22'), `${device.user || 'kore-api'}@${host}`, commands], 15000);
      results.push({ host, stdout });
    } catch (error) {
      errors.push(`${device.name || host}: ${error.message}`);
    }
  }
  if (errors.length) throw new Error(`Nao foi possivel revogar o acesso no MikroTik: ${errors.join(' | ')}`);
  return { success: true, results };
}

async function setVipAccess(payload = {}) {
  assertTenantLicense({ action: 'write', resource: 'hotspot' });
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
  const target = resolveMikrotikTarget(payload, item);
  const mikrotik = {
    ...target,
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
  assertTenantLicense({ action: 'create', resource: 'client' });
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

  const mikrotik = resolveMikrotikTarget(payload, item);
  const authorization = await createHotspotUser({
    ...mikrotik,
    username: item.radius_username,
    password: item.radius_password,
    mac: item.mac_address,
    ip: item.ip_address,
    minutes: item.trial_duration_minutes,
    plan: selectedPlan || item
  });

  if (authorization.mac || authorization.ip) {
    item.mac_address = authorization.mac || item.mac_address;
    item.ip_address = authorization.ip || item.ip_address;
    item.updated_date = new Date().toISOString();
    writeCaptiveDb([item, ...filtered.filter(existing => existing.id !== item.id && existing._id !== item._id)].slice(0, 1000));
  }

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

  const mikrotik = resolveMikrotikTarget(payload, client);
  const authorization = await createHotspotUser({
    ...mikrotik,
    username: loginUser,
    password: loginPass,
    mac: payload.mac || client.mac_address,
    ip: payload.ip || client.ip_address,
    minutes: Number(payload.minutes || 1440),
    permanent: true,
    plan: selectedPlan || client
  });

  if (authorization.mac || authorization.ip) {
    client = {
      ...client,
      mac_address: authorization.mac || client.mac_address,
      ip_address: authorization.ip || client.ip_address,
      updated_date: new Date().toISOString()
    };
    upsertById(ENTITY_FILES.clients, client);
  }

  return { success: true, client, plan: selectedPlan || null, authorization, login: { username: loginUser, password: loginPass, active_login: authorization.active_login } };
}

async function captiveVoucherLogin(payload = {}) {
  const code = normalizeText(payload.code).toUpperCase();
  if (!code) throw new Error('Informe o voucher');

  const vouchers = readJson(ENTITY_FILES.vouchers, []);
  const voucher = vouchers.find(item => normalizeText(item.code).toUpperCase() === code);
  const reservationExpired = voucher?.status === 'reserved' && Date.now() - new Date(voucher.reserved_at || 0).getTime() > 5 * 60 * 1000;
  if (!voucher || (voucher.status !== 'available' && !reservationExpired)) throw Object.assign(new Error('Voucher invalido ou indisponivel'), { status: 400 });

  const minutes = Number(voucher.duration_minutes || payload.minutes || 30);
  const expires = new Date(Date.now() + minutes * 60000).toISOString();
  const matchesVoucher = item => item.id === voucher.id || item._id === voucher._id;
  writeJson(ENTITY_FILES.vouchers, vouchers.map(item => matchesVoucher(item) ? { ...item, status: 'reserved', reserved_at: new Date().toISOString() } : item));

  let authorization;
  try {
    const mikrotik = resolveMikrotikTarget(payload, voucher);
    authorization = await createHotspotUser({
      ...mikrotik,
      username: hotspotCredential(`voucher-${code}`),
      password: randomPassword(),
      mac: payload.mac,
      ip: payload.ip,
      minutes,
      plan: voucher
    });
  } catch (error) {
    const current = readJson(ENTITY_FILES.vouchers, []);
    writeJson(ENTITY_FILES.vouchers, current.map(item => matchesVoucher(item) ? { ...item, status: 'available', reserved_at: '' } : item));
    throw error;
  }

  const usedVoucher = {
    ...voucher,
    status: 'used',
    reserved_at: '',
    used_at: new Date().toISOString(),
    expires_at: expires,
    used_by_name: payload.name || 'Visitante',
    used_by_email: payload.email || '',
    mac_address: authorization.mac || normalizeMac(payload.mac),
    ip_address: authorization.ip || normalizeClientIp(payload.ip)
  };
  const current = readJson(ENTITY_FILES.vouchers, []);
  writeJson(ENTITY_FILES.vouchers, current.map(item => matchesVoucher(item) ? usedVoucher : item));
  return { success: true, voucher: usedVoucher, minutes, authorization, login: { username: authorization.username, password: authorization.password, active_login: authorization.active_login } };
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

  const mikrotik = resolveMikrotikTarget(payload, client);
  const authorization = await createHotspotUser({
    ...mikrotik,
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

function getSaasMercadoPagoToken() {
  return String(process.env.KORE_SAAS_MP_ACCESS_TOKEN || getSetting('mp_access_token') || '').trim();
}

async function getMercadoPagoPayment(paymentId, tokenOverride = '') {
  const token = String(tokenOverride || getSetting('mp_access_token') || '').trim();
  if (!token) throw new Error('Configure o Access Token do Mercado Pago');
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Mercado Pago HTTP ${response.status}`);
  return data;
}

async function createProviderPix(providerId) {
  const token = getSaasMercadoPagoToken();
  if (!token) throw new Error('Configure KORE_SAAS_MP_ACCESS_TOKEN ou o Access Token do Mercado Pago');

  const providers = readGlobalJson(PROVIDERS_FILE, []);
  const provider = providers.find(item => item.id === providerId || item._id === providerId || item.tenant_id === providerId);
  if (!provider) throw Object.assign(new Error('Provedor nao encontrado'), { status: 404 });
  const amount = Number(provider.monthly_price || 0);
  if (amount <= 0) throw new Error('Defina uma mensalidade maior que zero para gerar Pix');

  const localPaymentId = `saas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = provider.tenant_id || provider.id;
  const payerEmail = provider.contact_email || `financeiro-${tenantId}@kore-hotspot.local`;
  const body = {
    transaction_amount: amount,
    description: `Kore-HotSpot SaaS - Mensalidade - ${provider.name || tenantId}`,
    payment_method_id: 'pix',
    external_reference: localPaymentId,
    notification_url: `${getPublicBaseUrl()}/api/payments/mercadopago/webhook?scope=provider`,
    payer: {
      email: payerEmail,
      first_name: String(provider.contact_name || provider.name || 'Provedor').split(/\s+/)[0],
      last_name: String(provider.contact_name || provider.name || 'Kore').split(/\s+/).slice(1).join(' ') || 'HotSpot'
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
  const billing = {
    id: localPaymentId,
    _id: localPaymentId,
    scope: 'provider_saas',
    provider: 'mercadopago',
    provider_id: provider.id || provider.tenant_id,
    tenant_id: tenantId,
    provider_name: provider.name || tenantId,
    provider_payment_id: String(data.id || ''),
    amount,
    status: data.status || 'pending',
    status_detail: data.status_detail || '',
    qr_code: tx.qr_code || '',
    qr_code_base64: tx.qr_code_base64 || '',
    ticket_url: tx.ticket_url || '',
    due_before_payment: provider.contract_due_date || '',
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString(),
    raw: data
  };
  const billings = readGlobalJson(PROVIDER_BILLING_FILE, []);
  writeGlobalJson(PROVIDER_BILLING_FILE, [billing, ...billings].slice(0, 5000));
  return { success: true, billing, provider: publicProvider(provider) };
}

async function refreshProviderBillingStatus({ id, provider_payment_id }) {
  const billings = readGlobalJson(PROVIDER_BILLING_FILE, []);
  let billing = billings.find(item => item.id === id || item._id === id || item.provider_payment_id === String(provider_payment_id || ''));
  if (!billing) throw new Error('Cobranca SaaS nao encontrada');

  const mpPayment = await getMercadoPagoPayment(billing.provider_payment_id, getSaasMercadoPagoToken());
  billing = {
    ...billing,
    status: mpPayment.status || billing.status,
    status_detail: mpPayment.status_detail || billing.status_detail,
    updated_date: new Date().toISOString(),
    raw: mpPayment
  };

  let provider = null;
  if (billing.status === 'approved' && !billing.applied_to_provider) {
    provider = markProviderPaid(billing.provider_id || billing.tenant_id, {
      last_payment_date: new Date().toISOString().slice(0, 10),
      months: 1
    });
    billing = {
      ...billing,
      applied_to_provider: true,
      applied_at: new Date().toISOString(),
      next_due_date: provider.contract_due_date || ''
    };
  } else {
    provider = providerForTenant(billing.tenant_id || billing.provider_id);
  }

  const next = [billing, ...billings.filter(item => item.id !== billing.id && item._id !== billing.id)];
  writeGlobalJson(PROVIDER_BILLING_FILE, next.slice(0, 5000));
  return { success: true, billing, provider: provider ? publicProvider(provider) : null };
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

  const mikrotik = resolveMikrotikTarget(payment, client);
  const authorization = await createHotspotUser({
    ...mikrotik,
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
  if ((params.get('scope') || payload?.scope) === 'provider') {
    return refreshProviderBillingStatus({ provider_payment_id: paymentId }).catch(error => ({ success: false, error: error.message }));
  }
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

async function handleRequest(req, res) {
  try {
    ensureRuntimeSettings();
    if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
    if (req.url === '/health') return send(res, 200, { ok: true, service: 'kore-vpn-api', tenant: currentTenant().id, multi_tenant: MULTI_TENANT });
    const [pathname, query = ''] = req.url.split('?');
    if (req.method === 'POST' && pathname === '/api/payments/mercadopago/webhook') return send(res, 200, await mercadoPagoWebhook(await readBody(req), query));
    if (req.method === 'GET' && req.url === '/public/hotspot-login.html') {
      return send(res, 200, hotspotLoginHtml(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (req.method === 'GET' && req.url === '/public/kore-api.pub') {
      await ensureSshKey();
      return send(res, 200, fs.readFileSync(PUB_PATH, 'utf8'), { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    if (req.method === 'POST' && req.url === '/api/admin/auth') return send(res, 200, await adminAuth(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/captive/config') return send(res, 200, captivePublicConfig(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/captive/plan-client') return send(res, 200, ensureCaptivePlanClient(await readBody(req)));
    if (req.method === 'GET' && req.url === '/api/captive/plans') {
      const plans = readJson(ENTITY_FILES.plans, []).map(publicPlan).filter(plan => plan.status === 'active');
      return send(res, 200, { plans });
    }
    if (req.method === 'POST' && req.url === '/api/captive/register') return send(res, 200, await captiveRegister(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/captive/client-login') { assertTenantLicense({ action: 'write', resource: 'client' }); return send(res, 200, await captiveClientLogin(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/captive/voucher-login') { assertTenantLicense({ action: 'write', resource: 'voucher' }); return send(res, 200, await captiveVoucherLogin(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/payments/pix') { assertTenantLicense({ action: 'write', resource: 'payment' }); return send(res, 200, await createPixPayment(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/payments/status') { assertTenantLicense({ action: 'write', resource: 'payment' }); return send(res, 200, await refreshPaymentStatus(await readBody(req))); }
    if (!validToken(req)) return send(res, 401, { error: 'token invalido' });

    if (req.method === 'GET' && req.url === '/api/tenant/current') {
      return send(res, 200, { tenant: currentTenant(), data_dir: currentDataDir(), multi_tenant: MULTI_TENANT, license: licenseState() });
    }
    if (req.method === 'GET' && req.url === '/api/license/status') return send(res, 200, licenseState());
    if (req.url.startsWith('/api/providers')) {
      requireSystemAdmin(req);
      assertSystemTenant();
      const result = await providersCrud(req);
      if (result) return send(res, 200, result);
    }
    if (req.method === 'GET' && req.url === '/api/ssh-key') {
      await ensureSshKey();
      const pub = fs.readFileSync(PUB_PATH, 'utf8').trim();
      return send(res, 200, { public_key: pub, public_key_url: `${getPublicBaseUrl()}/public/kore-api.pub` });
    }
    if (req.method === 'GET' && req.url === '/api/radius/status') return send(res, 200, await radiusStatus());
    if (req.method === 'GET' && req.url === '/api/radius/sessions') return send(res, 200, await radiusSessions());
    if (req.method === 'POST' && req.url === '/api/access-points/discover') { assertTenantLicense({ action: 'write', resource: 'access_point' }); return send(res, 200, await discoverAccessPoints(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/access-points/poll') return send(res, 200, await pollAccessPoints(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/access-point-profiles') {
      const body = await readBody(req);
      if (body.action !== 'list' && body.action !== 'preview') assertTenantLicense({ action: 'write', resource: 'access_point_profile' });
      return send(res, 200, await accessPointProfiles(body));
    }
    if (req.method === 'GET' && req.url === '/api/captive/prospects') return send(res, 200, { prospects: readCaptiveDb() });
    if (req.method === 'DELETE' && req.url.startsWith('/api/captive/prospects/')) return send(res, 200, await deleteCaptiveProspect(decodeURIComponent(req.url.split('/').pop())));
    if (req.method === 'POST' && req.url === '/api/ixc/cliente') return send(res, 200, await ixcConsultaCliente(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/clients/activate-free-plan') { assertTenantLicense({ action: 'write', resource: 'client' }); return send(res, 200, await activateFreePlan(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/hotspot/vip') return send(res, 200, await setVipAccess(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/mikrotik/cleanup-access') return send(res, 200, await cleanupMikrotikAccess(await readBody(req)));
    if (req.url.startsWith('/api/entities/')) {
      const result = await entityCrud(req);
      if (result) return send(res, 200, result);
    }
    if (req.method === 'GET' && req.url === '/api/vpn/users') return send(res, 200, { users: await listUsers() });
    if (req.method === 'GET' && req.url === '/api/vpn/status') return send(res, 200, await vpnStatus());
    if (req.method === 'POST' && req.url === '/api/vpn/users') { assertTenantLicense({ action: 'write', resource: 'vpn' }); return send(res, 200, await ensureUser(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/mikrotik/status') return send(res, 200, await mikrotikStatus(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/mikrotik/sync-plans') { assertTenantLicense({ action: 'write', resource: 'mikrotik' }); return send(res, 200, await mikrotikSyncPlans(await readBody(req))); }

    return send(res, 404, { error: 'rota nao encontrada' });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  tenantStore.run(tenantFromRequest(req), () => {
    handleRequest(req, res);
  });
});

ensureSshKey().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`Kore VPN API listening on ${PORT}`));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
