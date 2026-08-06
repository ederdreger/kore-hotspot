import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 19081;
const password = 'TesteSeguro123';
const adminEmail = 'admin@central.example.com';
let directory;
let api;
let tenantDataDir;

async function loginAdmin() {
  const login = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: adminEmail, password })
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.data.token);
  return login.data.token;
}

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const data = await response.json();
  return { response, data };
}

test.before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kore-api-test-'));
  const apiFile = path.join(directory, 'server.cjs');
  const dataDir = path.join(directory, 'data');
  tenantDataDir = path.join(dataDir, 'tenants', 'default');
  const keyDir = path.join(directory, 'keys');
  await Promise.all([mkdir(dataDir), mkdir(keyDir), copyFile('server.vps.js', apiFile)]);
  api = spawn(process.execPath, [apiFile], {
    env: {
      ...process.env,
      PORT: String(port),
      KORE_DATA_DIR: dataDir,
      KORE_KEY_DIR: keyDir,
      KORE_CHAP_FILE: path.join(directory, 'chap-secrets'),
      KORE_ADMIN_PASSWORD: password,
      KORE_ADMIN_EMAIL: adminEmail,
      KORE_ADMIN_NAME: 'Administrador Central',
      KORE_MULTI_TENANT: 'true',
      KORE_REQUIRE_TENANT_SIGNATURE: 'true'
    },
    stdio: 'ignore'
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response } = await request('/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('API de teste nao iniciou');
});

test.after(async () => {
  api?.kill();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('health check responde em banco vazio', async () => {
  const { response, data } = await request('/health');
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
});

test('rota administrativa rejeita requisicao sem sessao', async () => {
  const { response } = await request('/api/entities/clients');
  assert.equal(response.status, 401);
});

test('token estatico do frontend nao autoriza rotas administrativas', async () => {
  const { response } = await request('/api/entities/clients', { headers: { 'X-Kore-Token': 'kore-vpn-api-2026' } });
  assert.equal(response.status, 401);
});

test('reset de administradores rejeita requisicao sem sessao', async () => {
  const { response } = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resetDefaults' })
  });
  assert.equal(response.status, 401);
});

test('login cria sessao que autoriza entidades', async () => {
  const token = await loginAdmin();
  const clients = await request('/api/entities/clients', { headers: { 'X-Kore-Session': token } });
  assert.equal(clients.response.status, 200);
  assert.deepEqual(clients.data.items, []);
});

test('planos comerciais incluem modalidade gratuita', async () => {
  const token = await loginAdmin();
  const { response, data } = await request('/api/providers', { headers: { 'X-Kore-Session': token } });
  assert.equal(response.status, 200);
  assert.deepEqual(data.commercial_plans.free, { label: 'Free', price: 0 });
});

test('tenant inicial aceita a senha administrativa definida pelo instalador', async () => {
  const token = await loginAdmin();
  const tenantPassword = 'TenantSeguro123!';
  const created = await request('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token },
    body: JSON.stringify({
      name: 'Tenant Teste',
      tenant_id: 'tenant-teste',
      domain: 'tenant-teste.example.com',
      contact_name: 'Administrador Tenant',
      contact_email: 'admin@tenant-teste.example.com',
      commercial_plan: 'free',
      admin_password: tenantPassword
    })
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.admin_credentials.password, tenantPassword);

  const tenantLogin = await request('/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'tenant-teste.example.com' },
    body: JSON.stringify({ action: 'login', email: 'admin@tenant-teste.example.com', password: tenantPassword })
  });
  assert.equal(tenantLogin.response.status, 200, JSON.stringify(tenantLogin.data));
  assert.equal(tenantLogin.data.user.role, 'provider_admin');
});

test('voucher nao e consumido quando o MikroTik nao pode autorizar', async () => {
  const token = await loginAdmin();
  const created = await request('/api/entities/vouchers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token },
    body: JSON.stringify({ code: 'TESTE-VOUCHER', status: 'available', duration_minutes: 30 })
  });
  assert.equal(created.response.status, 200);

  const attempt = await request('/api/captive/voucher-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTE-VOUCHER' })
  });
  assert.notEqual(attempt.response.status, 200);

  const vouchers = await request('/api/entities/vouchers', { headers: { 'X-Kore-Session': token } });
  const voucher = vouchers.data.items.find(item => item.code === 'TESTE-VOUCHER');
  assert.equal(voucher.status, 'available');
});

test('cadastro captive falho nao deixa prospect residual', async () => {
  const token = await loginAdmin();
  const plan = await request('/api/entities/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token },
    body: JSON.stringify({ name: 'Primeiro acesso', status: 'active', is_trial: true, trial_duration_minutes: 60 })
  });
  assert.equal(plan.response.status, 200);

  const attempt = await request('/api/captive/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Cliente sem roteador',
      cpf: '12345678901',
      mac: '4A:89:E1:D9:CE:FA',
      ip: '192.168.1.18',
      plan_id: plan.data.item.id
    })
  });
  assert.notEqual(attempt.response.status, 200);

  const prospects = JSON.parse(await readFile(path.join(tenantDataDir, 'captive-prospects.json'), 'utf8'));
  assert.deepEqual(prospects, []);
});

test('Access Points sao persistidos na API por tenant', async () => {
  const token = await loginAdmin();
  const created = await request('/api/entities/access_points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token },
    body: JSON.stringify({ name: 'AP Teste', ip: '10.0.0.10', status: 'offline' })
  });
  assert.equal(created.response.status, 200);
  assert.ok(created.data.item.id);

  const listed = await request('/api/entities/access_points', { headers: { 'X-Kore-Session': token } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.items.length, 1);
  assert.equal(listed.data.items[0].name, 'AP Teste');

  const removed = await request(`/api/entities/access_points/${created.data.item.id}`, {
    method: 'DELETE', headers: { 'X-Kore-Session': token }
  });
  assert.equal(removed.response.status, 200);
  const ignored = JSON.parse(await readFile(path.join(tenantDataDir, 'access-points-ignored.json'), 'utf8'));
  assert.equal(ignored[0].id, created.data.item.id);
});

test('coleta de AP informa quando nao existe controladora cadastrada', async () => {
  const token = await loginAdmin();
  const result = await request('/api/access-points/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token }, body: '{}'
  });
  assert.equal(result.response.status, 400);
  assert.match(result.data.error, /Nenhuma controladora/i);
});

test('UniFi local excluido pode ser redescoberto em um novo teste', async () => {
  const token = await loginAdmin();
  const headers = { 'Content-Type': 'application/json', 'X-Kore-Session': token };
  const created = await request('/api/entities/access_points', {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'UniFi redescoberta', ip: '192.168.1.245', mac_address: 'D8:B3:70:C0:7A:DB', source: 'unifi-local', managed: false })
  });
  assert.equal(created.response.status, 200);
  const removed = await request(`/api/entities/access_points/${created.data.item.id}`, { method: 'DELETE', headers });
  assert.equal(removed.response.status, 200);
  const ignored = JSON.parse(await readFile(path.join(tenantDataDir, 'access-points-ignored.json'), 'utf8'));
  assert.equal(ignored.some(item => item.id === created.data.item.id || item.mac === 'D8:B3:70:C0:7A:DB'), false);
});

test('modo alternativo SSH exige senha e nao persiste credenciais', async () => {
  const token = await loginAdmin();
  const headers = { 'Content-Type': 'application/json', 'X-Kore-Session': token };
  const created = await request('/api/entities/access_points', {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'UniFi pendente', ip: '192.168.1.245', source: 'unifi-local', adoption_status: 'pending', managed: false })
  });
  assert.equal(created.response.status, 200);

  const adoption = await request('/api/access-points/adopt', {
    method: 'POST', headers,
    body: JSON.stringify({ ap_id: created.data.item.id, mode: 'ssh', username: 'ubnt', password: '' })
  });
  assert.equal(adoption.response.status, 400);
  assert.match(adoption.data.error, /senha SSH/i);

  const stored = await readFile(path.join(tenantDataDir, 'access-points.json'), 'utf8');
  assert.equal(stored.includes('password'), false);
  assert.equal(stored.includes('sshPassword'), false);
});

test('perfil Wi-Fi protege a senha e gera previa CAPsMAN sem segredo', async () => {
  const token = await loginAdmin();
  const headers = { 'Content-Type': 'application/json', 'X-Kore-Session': token };
  const secret = 'SenhaWifiSegura123';
  const saved = await request('/api/access-point-profiles', {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'save', name: 'Visitantes', ssid: 'Kore Visitantes', security_mode: 'wpa2-psk',
      passphrase: secret, country: 'Brazil', bridge: 'bridge-hotspot', vlan_id: 20
    })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.profile.passphrase_configured, true);
  assert.equal(JSON.stringify(saved.data).includes(secret), false);

  const stored = await readFile(path.join(tenantDataDir, 'ap-profiles.json'), 'utf8');
  assert.equal(stored.includes(secret), false);

  const listed = await request('/api/access-point-profiles', {
    method: 'POST', headers, body: JSON.stringify({ action: 'list' })
  });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.profiles.length, 1);
  assert.equal(JSON.stringify(listed.data).includes(secret), false);

  for (const capsman_type of ['legacy', 'wifi']) {
    const preview = await request('/api/access-point-profiles', {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'preview', id: saved.data.profile.id, capsman_type })
    });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.data.capsman_type, capsman_type);
    assert.match(preview.data.script, capsman_type === 'legacy' ? /\/caps-man configuration add/ : /\/interface wifi configuration add/);
    assert.match(preview.data.script, /\*\*\*\*\*\*\*\*/);
    assert.equal(preview.data.script.includes(secret), false);
  }
});

test('arquivo de perfis Wi-Fi nao fica exposto pela API generica', async () => {
  const token = await loginAdmin();
  const { response } = await request('/api/entities/ap_profiles', { headers: { 'X-Kore-Session': token } });
  assert.equal(response.status, 404);
});

test('integracao UniFi armazena a chave criptografada e devolve apenas metadados', async () => {
  const token = await loginAdmin();
  const headers = { 'Content-Type': 'application/json', 'X-Kore-Session': token };
  const apiKey = 'unifi-api-key-super-secreta';
  const mikrotik = await request('/api/entities/settings', {
    method: 'POST', headers,
    body: JSON.stringify({ category: 'mikrotik_device', key: 'mikrotik_device_unifi', label: 'MikroTik UniFi', value: JSON.stringify({ name: 'MikroTik UniFi', host: '10.255.255.20', port: '22', user: 'kore-api' }) })
  });
  assert.equal(mikrotik.response.status, 200);
  const saved = await request('/api/unifi/integrations', {
    method: 'POST', headers,
    body: JSON.stringify({ action: 'save', name: 'UniFi Teste', api_key: apiKey, status: 'active', mikrotik_id: mikrotik.data.item.id, management_interface: 'vlan-unifi', management_vlan_id: 30, scan_vlan_hosts: true })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.integration.api_key_configured, true);
  assert.equal(saved.data.integration.management_interface, 'vlan-unifi');
  assert.equal(saved.data.integration.management_vlan_id, 30);
  assert.equal(saved.data.integration.scan_vlan_hosts, true);
  assert.equal(saved.data.integration.mikrotik_id, mikrotik.data.item.id);
  assert.equal(JSON.stringify(saved.data).includes(apiKey), false);

  const stored = await readFile(path.join(tenantDataDir, 'unifi-integrations.json'), 'utf8');
  assert.equal(stored.includes(apiKey), false);

  const listed = await request('/api/unifi/integrations', {
    method: 'POST', headers, body: JSON.stringify({ action: 'list' })
  });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.integrations.length, 1);
  assert.equal(listed.data.integrations[0].name, 'UniFi Teste');
  assert.equal(listed.data.integrations[0].management_interface, 'vlan-unifi');
  assert.equal(JSON.stringify(listed.data).includes(apiKey), false);

  const removed = await request('/api/unifi/integrations', {
    method: 'POST', headers, body: JSON.stringify({ action: 'delete', id: saved.data.integration.id })
  });
  assert.equal(removed.response.status, 200);
});

test('integracao UniFi exige MikroTik quando usa VLAN de gerenciamento', async () => {
  const token = await loginAdmin();
  const { response, data } = await request('/api/unifi/integrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token },
    body: JSON.stringify({ action: 'save', name: 'UniFi VLAN invalida', api_key: 'chave-teste', management_interface: 'vlan-sem-router', management_vlan_id: 50 })
  });
  assert.equal(response.status, 400);
  assert.match(data.error, /Selecione o MikroTik/i);
});

test('status da controladora UniFi funciona mesmo antes da instalacao', async () => {
  const token = await loginAdmin();
  const { response, data } = await request('/api/unifi/controller', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token },
    body: JSON.stringify({ action: 'status' })
  });
  assert.equal(response.status, 200);
  assert.equal(typeof data.installed, 'boolean');
  assert.equal(typeof data.active, 'boolean');
  assert.match(data.inform_url, /:8080\/inform$/);
  assert.match(data.ui_url, /:8443$/);
});

test('configuracao minima do captive permanece publica', async () => {
  const { response, data } = await request('/api/captive/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(data.settings, {});
});

test('login do MikroTik transporta o tenant ate o portal captive', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/public/hotspot-login.html`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /captive-portal\?tenant=default&tenant_sig=[a-f0-9]{64}&mac=\$\(mac\)/);
});

test('header de tenant sem assinatura e rejeitado', async () => {
  const { response, data } = await request('/api/captive/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kore-Tenant': 'tenant-alvo' },
    body: '{}'
  });
  assert.equal(response.status, 403);
  assert.match(data.error, /Contexto do provedor invalido/i);
});

test('login grava cookie HttpOnly e nao persiste token da sessao em texto puro', async () => {
  const login = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: adminEmail, password })
  });
  const cookie = login.response.headers.get('set-cookie');
  assert.match(cookie, /kore_admin_session=.*HttpOnly.*SameSite=Strict/i);
  const sessions = await readFile(path.join(tenantDataDir, 'admin-sessions.json'), 'utf8');
  assert.doesNotMatch(sessions, new RegExp(login.data.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const validate = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] }, body: JSON.stringify({ action: 'validate' })
  });
  assert.equal(validate.response.status, 200);
});

test('permissoes de modulo tambem sao aplicadas na API', async () => {
  const adminToken = await loginAdmin();
  const email = 'limitado@example.com';
  const created = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createUser', token: adminToken, email, full_name: 'Limitado', password: 'LimitadoSeguro123!', role: 'user', permissions: ['plans'] })
  });
  assert.equal(created.response.status, 200);
  const login = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email, password: 'LimitadoSeguro123!' })
  });
  const denied = await request('/api/entities/clients', { headers: { 'X-Kore-Session': login.data.token } });
  assert.equal(denied.response.status, 403);
  const allowed = await request('/api/entities/plans', { headers: { 'X-Kore-Session': login.data.token } });
  assert.equal(allowed.response.status, 200);
});

test('configuracoes secretas sao criptografadas e mascaradas', async () => {
  const token = await loginAdmin();
  const secret = 'token-ixc-super-secreto';
  const created = await request('/api/entities/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token },
    body: JSON.stringify({ id: 'setting_ixc_token', key: 'ixc_token', category: 'ixc', value: secret })
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.item.value, '');
  assert.equal(created.data.item.secret_configured, true);
  const stored = await readFile(path.join(tenantDataDir, 'settings.json'), 'utf8');
  assert.doesNotMatch(stored, new RegExp(secret));
  assert.match(stored, /value_encrypted/);
});

test('arquivos de dados usam permissoes restritas', { skip: process.platform === 'win32' }, async () => {
  const dataMode = (await stat(tenantDataDir)).mode & 0o777;
  const settingsMode = (await stat(path.join(tenantDataDir, 'settings.json'))).mode & 0o777;
  assert.equal(dataMode, 0o700);
  assert.equal(settingsMode, 0o600);
});

test('CORS nao autoriza origem externa', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('login administrativo bloqueia forca bruta', async () => {
  let last;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    last = await request('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: 'ataque@example.com', password: `errada-${attempt}` })
    });
  }
  assert.equal(last.response.status, 429);
  assert.ok(Number(last.response.headers.get('retry-after')) > 0);
});
