import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 19081;
const password = 'TesteSeguro123';
let directory;
let api;

async function loginAdmin() {
  const login = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: 'spedynet@spedynet.com.br', password })
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
      KORE_MULTI_TENANT: 'false'
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
});

test('coleta de AP informa quando nao existe controladora cadastrada', async () => {
  const token = await loginAdmin();
  const result = await request('/api/access-points/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kore-Session': token }, body: '{}'
  });
  assert.equal(result.response.status, 400);
  assert.match(result.data.error, /Nenhuma controladora/i);
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

  const stored = await readFile(path.join(directory, 'data', 'ap-profiles.json'), 'utf8');
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
  const saved = await request('/api/unifi/integrations', {
    method: 'POST', headers,
    body: JSON.stringify({ action: 'save', name: 'UniFi Teste', api_key: apiKey, status: 'active' })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.integration.api_key_configured, true);
  assert.equal(JSON.stringify(saved.data).includes(apiKey), false);

  const stored = await readFile(path.join(directory, 'data', 'unifi-integrations.json'), 'utf8');
  assert.equal(stored.includes(apiKey), false);

  const listed = await request('/api/unifi/integrations', {
    method: 'POST', headers, body: JSON.stringify({ action: 'list' })
  });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.integrations.length, 1);
  assert.equal(listed.data.integrations[0].name, 'UniFi Teste');
  assert.equal(JSON.stringify(listed.data).includes(apiKey), false);

  const removed = await request('/api/unifi/integrations', {
    method: 'POST', headers, body: JSON.stringify({ action: 'delete', id: saved.data.integration.id })
  });
  assert.equal(removed.response.status, 200);
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
  assert.match(data.inform_url, /:18080\/inform$/);
  assert.match(data.ui_url, /:8443$/);
});

test('configuracao minima do captive permanece publica', async () => {
  const { response, data } = await request('/api/captive/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(data.settings, {});
});
