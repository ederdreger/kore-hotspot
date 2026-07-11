const DEFAULT_PASSWORD = 'Admin12345';
const CONFIGURED_API_URL = String(import.meta.env.VITE_KORE_API_URL || '').replace(/\/+$/, '');
const FORCE_CONFIGURED_API_URL = String(import.meta.env.VITE_KORE_FORCE_API_URL || '').toLowerCase() === 'true';
const VPN_API_URL = FORCE_CONFIGURED_API_URL ? CONFIGURED_API_URL : '';
const VPN_API_TOKEN = import.meta.env.VITE_KORE_API_TOKEN || 'kore-vpn-api-2026';
const KORE_TENANT_ID = import.meta.env.VITE_KORE_TENANT_ID || window.location.hostname || 'default';
const STORAGE_KEY = `kore_hotspot_local_db_${KORE_TENANT_ID}`;
const DEFAULT_ADMINS = [
  { email: 'demo@spedynet.com.br', full_name: 'Administrador Demo', role: 'admin' },
  { email: 'spedynet@spedynet.com.br', full_name: 'Administrador Spedynet', role: 'admin' }
];

const ENTITY_DEFAULTS = {
  AdminUser: [],
  AdminSession: [],
  AuditLog: [],
  Campaign: [],
  Client: [],
  Plan: [
    {
      id: 'plan_demo_1',
      _id: 'plan_demo_1',
      name: 'Plano Demo',
      price: 49.9,
      plan_type: 'paid',
      duration_days: 30,
      speed_download: 100,
      speed_upload: 50,
      status: 'active',
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    }
  ],
  Prospect: [],
  Setting: [
    {
      id: 'setting_vpn_server_host',
      _id: 'setting_vpn_server_host',
      key: 'vpn_server_host',
      value: '190.8.174.155',
      category: 'system',
      label: 'VPN Server Host',
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    },
    {
      id: 'setting_vpn_ipsec_secret',
      _id: 'setting_vpn_ipsec_secret',
      key: 'vpn_ipsec_secret',
      value: 'korevpn123',
      category: 'system',
      label: 'VPN IPsec Secret',
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    }
  ],
  Voucher: [],
  Payment: [],
  VpnAccount: []
};

const REMOTE_ENTITY_MAP = {
  Client: 'clients',
  Plan: 'plans',
  Voucher: 'vouchers',
  Setting: 'settings',
  Payment: 'payments'
};

function apiHeaders(extra = {}) {
  return {
    ...extra,
    'X-Kore-Token': VPN_API_TOKEN,
    'X-Kore-Tenant': KORE_TENANT_ID
  };
}

function jsonHeaders() {
  return apiHeaders({ 'Content-Type': 'application/json' });
}

function now() {
  return new Date().toISOString();
}

function newId(entityName) {
  return `${entityName.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function randomToken() {
  if (crypto?.randomUUID) return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function readDb() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const db = raw ? JSON.parse(raw) : {};
  const seeded = { ...ENTITY_DEFAULTS, ...db };

  for (const setting of ENTITY_DEFAULTS.Setting) {
    const exists = seeded.Setting.find((item) => item.key === setting.key);
    if (!exists) seeded.Setting.push(setting);
  }

  if (!seeded.AdminUser.length) {
    for (const admin of DEFAULT_ADMINS) {
      const id = newId('AdminUser');
      seeded.AdminUser.push({
        id,
        _id: id,
        ...admin,
        status: 'active',
        permissions: ['*'],
        password: DEFAULT_PASSWORD,
        created_date: now(),
        updated_date: now()
      });
    }
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function writeDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function publicUser(user) {
  if (!user) return null;
  const { password, password_hash, ...safeUser } = user;
  return safeUser;
}

function sortItems(items, order) {
  if (!order) return items;
  const desc = String(order).startsWith('-');
  const field = String(order).replace(/^-/, '');
  return [...items].sort((a, b) => {
    const aValue = a[field] || '';
    const bValue = b[field] || '';
    if (aValue === bValue) return 0;
    return (aValue > bValue ? 1 : -1) * (desc ? -1 : 1);
  });
}

function matches(item, criteria = {}) {
  return Object.entries(criteria).every(([key, value]) => {
    if (key === 'id') return item.id === value || item._id === value;
    return item[key] === value;
  });
}

async function remoteEntityList(entityName) {
  const remote = REMOTE_ENTITY_MAP[entityName];
  if (!remote) return [];
  const response = await fetch(`${VPN_API_URL}/api/entities/${remote}`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ao listar ${entityName}`);
  return data.items || [];
}

async function remoteEntityCreate(entityName, item) {
  const remote = REMOTE_ENTITY_MAP[entityName];
  if (!remote) return null;
  const response = await fetch(`${VPN_API_URL}/api/entities/${remote}`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(item)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ao sincronizar ${entityName}`);
  return data.item;
}

async function remoteEntityUpdate(entityName, id, item) {
  const remote = REMOTE_ENTITY_MAP[entityName];
  if (!remote) return null;
  const response = await fetch(`${VPN_API_URL}/api/entities/${remote}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify(item)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ao atualizar ${entityName}`);
  return data.item;
}

async function remoteEntityDelete(entityName, id) {
  const remote = REMOTE_ENTITY_MAP[entityName];
  if (!remote) return null;
  const response = await fetch(`${VPN_API_URL}/api/entities/${remote}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ao remover ${entityName}`);
  return data;
}

async function remoteProspectDelete(id) {
  const response = await fetch(`${VPN_API_URL}/api/captive/prospects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao remover prospecto captive');
  return data;
}

function entityApi(entityName) {
  return {
    async list(order, limit) {
      const db = readDb();
      let items = db[entityName] || [];
      if (entityName === 'Prospect') {
        const remote = await captiveProspects().catch(() => []);
        const byId = new Map([...remote, ...items].map((item) => [item.id || item._id, item]));
        items = [...byId.values()];
      } else if (REMOTE_ENTITY_MAP[entityName]) {
        const remote = await remoteEntityList(entityName).catch(() => []);
        const remoteIds = new Set(remote.map((item) => item.id || item._id));
        items
          .filter((item) => !remoteIds.has(item.id || item._id))
          .forEach((item) => remoteEntityCreate(entityName, item).catch(() => null));
        const byId = new Map([...remote, ...items].map((item) => [item.id || item._id, item]));
        items = [...byId.values()];
      }
      items = sortItems(items, order);
      return typeof limit === 'number' ? items.slice(0, limit) : items;
    },

    async filter(criteria = {}) {
      const db = readDb();
      let items = db[entityName] || [];
      if (REMOTE_ENTITY_MAP[entityName]) {
        const remote = await remoteEntityList(entityName).catch(() => []);
        const remoteIds = new Set(remote.map((item) => item.id || item._id));
        items
          .filter((item) => !remoteIds.has(item.id || item._id))
          .forEach((item) => remoteEntityCreate(entityName, item).catch(() => null));
        const byId = new Map([...remote, ...items].map((item) => [item.id || item._id, item]));
        items = [...byId.values()];
      }
      return items.filter((item) => matches(item, criteria));
    },

    async get(id) {
      const db = readDb();
      const item = (db[entityName] || []).find((entry) => entry.id === id || entry._id === id);
      if (!item) throw new Error(`${entityName} nao encontrado`);
      return item;
    },

    async create(data) {
      const db = readDb();
      const id = data.id || data._id || newId(entityName);
      const item = {
        id,
        _id: id,
        ...data,
        created_date: data.created_date || now(),
        updated_date: now()
      };
      db[entityName] = [...(db[entityName] || []), item];
      writeDb(db);
      await remoteEntityCreate(entityName, item).catch(() => null);
      return item;
    },

    async update(id, data) {
      const db = readDb();
      db[entityName] = (db[entityName] || []).map((item) => (
        item.id === id || item._id === id ? { ...item, ...data, updated_date: now() } : item
      ));
      writeDb(db);
      const item = (db[entityName] || []).find((entry) => entry.id === id || entry._id === id);
      await remoteEntityUpdate(entityName, id, item || data).catch(() => null);
      return item;
    },

    async delete(id) {
      const db = readDb();
      db[entityName] = (db[entityName] || []).filter((item) => item.id !== id && item._id !== id);
      writeDb(db);
      if (entityName === 'Prospect') await remoteProspectDelete(id).catch(() => null);
      await remoteEntityDelete(entityName, id).catch(() => null);
      return { success: true };
    }
  };
}

function createSession(admin) {
  const db = readDb();
  const token = `${randomToken()}-${randomToken()}`;
  const session = {
    id: newId('AdminSession'),
    token,
    admin_user_id: admin.id,
    email: admin.email,
    role: admin.role,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
  };
  db.AdminSession.push(session);
  writeDb(db);
  return session;
}

function getSession(token) {
  const db = readDb();
  const session = db.AdminSession.find((entry) => entry.token === token);
  if (!session || new Date(session.expires_at) < new Date()) return null;
  return session;
}

async function adminAuth(payload = {}) {
  const db = readDb();
  const { action, email, password, token, userId, role, full_name, newPassword } = payload;

  if (action === 'resetDefaults') {
    const existing = db.AdminUser.filter((user) => !DEFAULT_ADMINS.some((admin) => normalize(admin.email) === normalize(user.email)));
    const defaults = DEFAULT_ADMINS.map((admin) => {
      const id = newId('AdminUser');
      return {
        id,
        _id: id,
        ...admin,
        status: 'active',
        role: 'admin',
        permissions: ['*'],
        password: DEFAULT_PASSWORD,
        created_date: now(),
        updated_date: now()
      };
    });
    db.AdminUser = [...defaults, ...existing];
    db.AdminSession = [];
    writeDb(db);
    return { success: true, email: DEFAULT_ADMINS.map((user) => user.email).join(' / '), password: DEFAULT_PASSWORD };
  }

  if (action === 'login') {
    const admin = db.AdminUser.find((user) => normalize(user.email) === normalize(email));
    if (!admin || admin.status === 'inactive' || admin.password !== password) {
      const error = new Error('E-mail ou senha invalidos');
      error.response = { data: { error: error.message }, status: 401 };
      throw error;
    }
    const session = createSession(admin);
    return { token: session.token, user: publicUser(admin) };
  }

  if (action === 'validate') {
    const session = getSession(token);
    if (!session) throw new Error('Sessao expirada');
    const admin = readDb().AdminUser.find((user) => user.id === session.admin_user_id);
    return { user: publicUser(admin) };
  }

  if (action === 'logout') {
    db.AdminSession = db.AdminSession.filter((session) => session.token !== token);
    writeDb(db);
    return { success: true };
  }

  const session = getSession(token);
  if (!session) throw new Error('Sessao expirada');

  if (action === 'listUsers') {
    return { users: readDb().AdminUser.map(publicUser) };
  }

  if (action === 'createUser') {
    const permissions = role === 'admin' ? ['*'] : (Array.isArray(payload.permissions) ? payload.permissions : []);
    const id = newId('AdminUser');
    const user = {
      id,
      _id: id,
      email: normalize(email),
      full_name: full_name || email,
      role: role || 'user',
      status: role === 'inactive' ? 'inactive' : 'active',
      permissions,
      password,
      created_date: now(),
      updated_date: now()
    };
    db.AdminUser.push(user);
    writeDb(db);
    return { user: publicUser(user) };
  }

  if (action === 'updateUser') {
    db.AdminUser = db.AdminUser.map((user) => {
      if (user.id !== userId && user._id !== userId) return user;
      const nextRole = role || user.role;
      return {
        ...user,
        full_name: full_name || user.full_name,
        role: nextRole,
        status: nextRole === 'inactive' ? 'inactive' : 'active',
        permissions: nextRole === 'admin' ? ['*'] : (Array.isArray(payload.permissions) ? payload.permissions : (user.permissions || [])),
        password: newPassword || user.password,
        updated_date: now()
      };
    });
    writeDb(db);
    return { success: true };
  }

  if (action === 'deleteUser') {
    db.AdminUser = db.AdminUser.filter((user) => user.id !== userId && user._id !== userId);
    writeDb(db);
    return { success: true };
  }

  throw new Error('Acao invalida');
}

async function remoteAdminAuth(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/admin/auth`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Falha na autenticacao');
    error.response = { data, status: response.status };
    throw error;
  }
  return data;
}

async function clientAuth(payload = {}) {
  const db = readDb();
  const client = db.Client.find((item) => (
    (item.radius_username === payload.username || item.email === payload.username) &&
    item.radius_password === payload.password
  ));
  if (!client) throw new Error('Usuario ou senha incorretos');
  return { client };
}

async function vpnCreateUser(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/vpn/users`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      username: payload.username,
      password: payload.password,
      remote_ip: payload.remote_ip
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Erro ao cadastrar usuario VPN na VPS');
  }
  return data;
}

async function vpnStatus() {
  const response = await fetch(`${VPN_API_URL}/api/vpn/status`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao consultar VPN na VPS');
  return data;
}

async function mikrotikStatus(payload = {}) {
  const host = payload.remote_ip || payload.vpn_remote_ip || payload.host;
  const response = await fetch(`${VPN_API_URL}/api/mikrotik/status`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      ...payload,
      host
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao consultar MikroTik via VPS');
  return data;
}

async function mikrotikSyncPlans(payload = {}) {
  const host = payload.remote_ip || payload.vpn_remote_ip || payload.host;
  const response = await fetch(`${VPN_API_URL}/api/mikrotik/sync-plans`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ ...payload, host })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao sincronizar planos no MikroTik');
  return data;
}

async function radiusStatus() {
  const response = await fetch(`${VPN_API_URL}/api/radius/status`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao consultar FreeRADIUS na VPS');
  return data;
}

async function radiusSessions() {
  const response = await fetch(`${VPN_API_URL}/api/radius/sessions`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao consultar sessoes RADIUS');
  return data;
}

async function mikrotikPerformance(payload = {}) {
  const status = await mikrotikStatus(payload);
  return {
    success: status.connected || status.online,
    data: {
      cpu: status.cpu_load ?? 0,
      memTotal: status.total_memory ?? 0,
      memUsed: status.used_memory ?? (status.total_memory && status.free_memory ? status.total_memory - status.free_memory : 0),
      memory_used_percent: status.memory_used_percent ?? 0,
      rxMbps: status.rx_mbps ?? 0,
      txMbps: status.tx_mbps ?? 0,
      protocol: status.protocol || status.collection_protocol || 'SSH'
    },
    ...status
  };
}

async function captiveRegister(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/captive/register`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao registrar acesso captive');
  return data;
}

async function captiveProspects() {
  const response = await fetch(`${VPN_API_URL}/api/captive/prospects`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao listar cadastros captive');
  return data.prospects || [];
}

async function captivePlans() {
  const response = await fetch(`${VPN_API_URL}/api/captive/plans`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao listar planos captive');
  return data.plans || [];
}

async function captiveClientLogin(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/captive/client-login`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao autenticar cliente');
  return data;
}

async function captiveVoucherLogin(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/captive/voucher-login`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao validar voucher');
  return data;
}

async function ixcConsultaCliente(payload = {}) {
  const db = readDb();
  const settings = Object.fromEntries((db.Setting || []).map((item) => [item.key, item.value]));
  const response = await fetch(`${VPN_API_URL}/api/ixc/cliente`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      cpf: payload.cpf,
      base_url: payload.base_url || settings.ixc_base_url,
      token: payload.token || settings.ixc_token,
      empresa_id: payload.empresa_id || settings.ixc_empresa_id
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao consultar cliente no IXC');
  return data;
}

async function createPixPayment(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/payments/pix`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      client_id: payload.clientId || payload.client_id,
      plan_id: payload.planId || payload.plan_id,
      mac: payload.mac,
      ip: payload.ip
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao gerar Pix');
  return data;
}

async function activateFreePlan(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/clients/activate-free-plan`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      client_id: payload.clientId || payload.client_id,
      plan_id: payload.planId || payload.plan_id,
      mac: payload.mac,
      ip: payload.ip
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao liberar plano gratuito');
  return data;
}

async function hotspotVipAccess(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/hotspot/vip`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao atualizar acesso VIP');
  return data;
}

async function checkPixPayment(payload = {}) {
  const response = await fetch(`${VPN_API_URL}/api/payments/status`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ id: payload.id, provider_payment_id: payload.provider_payment_id })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao consultar pagamento');
  return data;
}

async function providersManager(payload = {}) {
  const action = payload.action || 'list';
  const id = payload.id || payload._id || payload.tenant_id || '';
  const method = action === 'create' ? 'POST' : ['update', 'upsert', 'markPaid', 'createPix', 'checkPix'].includes(action) ? 'PUT' : action === 'delete' ? 'DELETE' : 'GET';
  const url = `${VPN_API_URL}/api/providers${id && method !== 'POST' ? `/${encodeURIComponent(id)}` : ''}`;
  const response = await fetch(url, {
    method,
    headers: method === 'GET' || method === 'DELETE' ? apiHeaders() : jsonHeaders(),
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao gerenciar provedores');
  return data;
}

async function licenseStatus() {
  const response = await fetch(`${VPN_API_URL}/api/license/status`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro ao consultar licenca');
  return data;
}

async function invoke(functionName, payload) {
  const handlers = {
    adminAuth: async (body) => remoteAdminAuth(body).catch(async (error) => {
      if (error.response?.status) throw error;
      return adminAuth(body);
    }),
    clientAuth,
    vpnCreateUser,
    vpnStatus,
    mikrotikStatus,
    mikrotikSyncPlans,
    mikrotikPerformance,
    radiusStatus,
    radiusSessions,
    captiveRegister,
    captiveProspects,
    captivePlans,
    captiveClientLogin,
    captiveVoucherLogin,
    ixcConsultaCliente,
    createPixPayment,
    activateFreePlan,
    hotspotVipAccess,
    checkPixPayment,
    providersManager,
    licenseStatus,
    createMercadoPagoCheckout: createPixPayment,
    getClientPortalData: async ({ clientId }) => {
      const db = readDb();
      return {
        client: db.Client.find((client) => client.id === clientId || client._id === clientId),
        plans: db.Plan.filter((plan) => plan.status === 'active')
      };
    }
  };

  if (handlers[functionName]) {
    return { data: await handlers[functionName](payload) };
  }

  return {
    data: {
      success: true,
      local: true,
      message: `Funcao ${functionName} simulada localmente`
    }
  };
}

export function createLocalSpedynetClient() {
  const entities = Object.keys(ENTITY_DEFAULTS).reduce((api, entityName) => {
    api[entityName] = entityApi(entityName);
    return api;
  }, {});

  return {
    entities,
    functions: { invoke },
    auth: {
      async me() {
        return null;
      },
      async register() {
        return { success: true };
      },
      setToken() {}
    }
  };
}
