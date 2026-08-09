import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseEnv = {
  TENANT_ID: 'default',
  PUBLIC_HOST: '203.0.113.10',
  MULTI_TENANT: 'true',
  ADMIN_EMAIL: 'admin@central.example.com',
  ADMIN_NAME: 'Administrador Central',
  ADMIN_PASSWORD: 'CentralSeguro123!',
  DOMAIN: 'central.example.com',
  CERTBOT_EMAIL: 'certbot@central.example.com',
  ENABLE_SSL: 'true',
  AUTO_UPDATE: 'true',
  INSTALL_UNIFI_CONTROLLER: 'false',
  INITIAL_TENANT_ENABLE_SSL: 'true',
  INITIAL_TENANT_NAME: 'Tenant Teste',
  INITIAL_TENANT_ID: 'tenant-teste',
  INITIAL_TENANT_DOMAIN: 'tenant.example.com',
  INITIAL_TENANT_CONTACT_EMAIL: 'admin@tenant.example.com',
  INITIAL_TENANT_PASSWORD: 'TenantSeguro123!',
  INITIAL_TENANT_PLAN: 'free'
};

function validate(overrides = {}) {
  const config = { ...baseEnv, ...overrides };
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const assignments = Object.entries(config)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(' ');
  return spawnSync('bash', ['-lc', `${assignments} bash scripts/install.sh --validate-config`], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8'
  });
}

test('instalador aceita configuracao completa de administrador e tenant', () => {
  const result = validate();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Configuracao valida/);
});

test('instalador rejeita senha administrativa fraca', () => {
  const result = validate({ ADMIN_PASSWORD: '123456' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_PASSWORD/);
});

test('instalador rejeita tenant usando o dominio administrativo', () => {
  const result = validate({ INITIAL_TENANT_DOMAIN: 'central.example.com' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dominio do tenant deve ser diferente/i);
});

test('instalador rejeita tenant id reservado', () => {
  const result = validate({ INITIAL_TENANT_ID: 'default' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nao pode ser default/i);
});

test('atualizador migra proxies antigos dos tenants para a API ativa', () => {
  const updater = readFileSync('scripts/update.sh', 'utf8');
  assert.match(updater, /repair_provider_nginx_upstreams\(\)/);
  assert.match(updater, /kore-hotspot-provider-\*\.conf/);
  assert.match(updater, /127\\\.0\\\.0\\\.1:8081/);
  assert.match(updater, /proxy_pass http:\/\/127\.0\.0\.1:8082/);
  assert.match(updater, /configure_nginx_site\s+repair_provider_nginx_upstreams\s+repair_ssl/);
});

test('instalador valida login, tenant e Wiki antes de concluir', () => {
  const installer = readFileSync('scripts/install.sh', 'utf8');
  assert.match(installer, /verify_initial_access\(\)/);
  assert.match(installer, /\/api\/admin\/auth/);
  assert.match(installer, /\/api\/tenant\/current/);
  assert.match(installer, /\/wiki/);
  assert.match(installer, /bootstrap_initial_tenant\s+verify_initial_access\s+remove_bootstrap_admin_password/);
});

test('downloads verificados evitam redirecionamento de release em cache', () => {
  const installer = readFileSync('scripts/install.sh', 'utf8');
  const updater = readFileSync('scripts/update.sh', 'utf8');
  const wizard = readFileSync('scripts/install-wizard.sh', 'utf8');
  assert.match(installer, /\$\{tarball\}\?kore_release=\$\{tag\}/);
  assert.match(updater, /\$\{tarball\}\?kore_release=\$\{tag\}/);
  assert.match(wizard, /\$\{package_url\}\?kore_release=\$\{tag\}/);
});
