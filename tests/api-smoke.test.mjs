import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 19081;
const password = 'TesteSeguro123';
let directory;
let api;

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
  const login = await request('/api/admin/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: 'spedynet@spedynet.com.br', password })
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.data.token);
  const clients = await request('/api/entities/clients', { headers: { 'X-Kore-Session': login.data.token } });
  assert.equal(clients.response.status, 200);
  assert.deepEqual(clients.data.items, []);
});

test('configuracao minima do captive permanece publica', async () => {
  const { response, data } = await request('/api/captive/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(data.settings, {});
});
