import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const directory = await mkdtemp(path.join(tmpdir(), 'kore-unifi-test-'));
const serverCopy = path.join(directory, 'server.cjs');
await copyFile('server.vps.js', serverCopy);
process.env.KORE_TEST_EXPORTS = 'true';
process.env.KORE_DATA_DIR = path.join(directory, 'data');
process.env.KORE_KEY_DIR = path.join(directory, 'keys');
const require = createRequire(import.meta.url);
const { normalizeRouterHex, unifiDhcpOption43, unifiDiscoveryRelayPlan, unifiInformRedirectPlan, unifiActivityMonitorPlan, unifiCleanupPlan, hotspotProfileUpsertCommand, saoPauloDateKey, prospectAccessState, routerBytePair } = require(serverCopy);
delete process.env.KORE_TEST_EXPORTS;

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('acesso de prospecto so renova na virada do dia em Sao Paulo', () => {
  const prospect = {
    created_date: '2026-08-05T13:00:00.000Z',
    trial_access_date: '2026-08-05',
    trial_expires_at: '2026-08-05T14:00:00.000Z'
  };
  const sameDay = prospectAccessState(prospect, new Date('2026-08-05T20:00:00.000Z'));
  assert.equal(sameDay.trial_active, false);
  assert.equal(sameDay.free_access_available, false);
  assert.equal(sameDay.next_free_access_at, '2026-08-06T03:00:00.000Z');

  const nextDay = prospectAccessState(prospect, new Date('2026-08-06T03:01:00.000Z'));
  assert.equal(nextDay.free_access_available, true);
});

test('data diaria respeita o fuso America Sao Paulo', () => {
  assert.equal(saoPauloDateKey(new Date('2026-08-06T02:59:59.000Z')), '2026-08-05');
  assert.equal(saoPauloDateKey(new Date('2026-08-06T03:00:00.000Z')), '2026-08-06');
});

test('contador RouterOS separa upload e download', () => {
  assert.deepEqual(routerBytePair('12345/67890'), [12345, 67890]);
});

test('reparo captive instala tambem as paginas alternativas do RouterOS', async () => {
  const source = await readFile('server.vps.js', 'utf8');
  assert.match(source, /"flogin\.html";"error\.html";"status\.html";"logout\.html"/);
});

test('reparo captive usa diretorio persistente sem duplicar o prefixo flash', async () => {
  const source = await readFile('server.vps.js', 'utf8');
  assert.match(source, /fileDirectory "flash\/kore-hotspot"/);
  assert.match(source, /profileDirectory "kore-hotspot"/);
  assert.match(source, /html-directory=\$profileDirectory html-directory-override=""/);
  assert.doesNotMatch(source, /html-directory="\/flash\/hotspot"/);
});

test('Option 43 UniFi usa o formato minimo por IPv4', () => {
  const result = unifiDhcpOption43('190.8.175.35', '190.8.175.35');
  assert.equal(result.informUrl, 'http://190.8.175.35:8080/inform');
  assert.equal(result.optionValue, '0x0104be08af23');
  assert.equal(result.encoding, 'controller-ip');
});

test('monitor de atividade mede qualquer pacote originado pelo MAC do AP', () => {
  const plan = unifiActivityMonitorPlan('D8:B3:70:C0:7A:DB');
  assert.match(plan.script, /chain=prerouting src-mac-address="D8:B3:70:C0:7A:DB" action=passthrough/);
  assert.match(plan.script, /reset-counters/);
});

test('validacao da Option 43 ignora formatacao do terminal RouterOS', () => {
  const wrapped = '0x0104BE08AF23 021F687474703A2F2F\r\n 3139302E382E3137352E33353A383038302F696E666F726D';
  assert.equal(normalizeRouterHex(wrapped), '0104be08af23021f687474703a2f2f3139302e382e3137352e33353a383038302f696e666f726d');
});

test('relay leva os anuncios UniFi da VLAN ate a controladora com retorno', () => {
  const plan = unifiDiscoveryRelayPlan('192.168.1.245', '190.8.175.35', 'D8:B3:70:C0:7A:DB');
  assert.match(plan.script, /dst-address=255\.255\.255\.255 protocol=udp dst-port=10001 action=dst-nat to-addresses="190\.8\.175\.35"/);
  assert.match(plan.script, /dst-address=233\.89\.188\.1 protocol=udp dst-port=10001 action=dst-nat to-addresses="190\.8\.175\.35"/);
  assert.match(plan.script, /chain=srcnat src-address="192\.168\.1\.245" dst-address="190\.8\.175\.35" protocol=udp dst-port=10001 action=masquerade/);
  assert.match(plan.script, /chain=forward src-address="192\.168\.1\.245" dst-address="190\.8\.175\.35" protocol=udp dst-port=10001 action=accept/);
});

test('Inform antigo do AP e interceptado e enviado a controladora atual', () => {
  const plan = unifiInformRedirectPlan('192.168.1.245', '190.8.175.35', 'D8:B3:70:C0:7A:DB');
  assert.match(plan.script, /chain=prerouting src-address="192\.168\.1\.245" dst-address=0\.0\.0\.0\/0 protocol=tcp dst-port=8080 action=passthrough/);
  assert.match(plan.script, /chain=dstnat src-address="192\.168\.1\.245" protocol=tcp dst-port=8080 action=dst-nat to-addresses="190\.8\.175\.35"/);
  assert.match(plan.script, /chain=srcnat src-address="192\.168\.1\.245" dst-address="190\.8\.175\.35" protocol=tcp dst-port=8080 action=masquerade/);
  assert.match(plan.script, /chain=forward src-address="192\.168\.1\.245" dst-address="190\.8\.175\.35" protocol=tcp dst-port=8080 action=accept/);
});

test('exclusao UniFi limpa cache e regras especificas do equipamento', () => {
  const plan = unifiCleanupPlan('D8:B3:70:C0:7A:DB');
  assert.equal(plan.optionName, 'kore-unifi-d8b370c07adb');
  assert.match(plan.script, /ip hotspot ip-binding remove/);
  assert.match(plan.script, /ip dhcp-server lease remove/);
  assert.match(plan.script, /ip dhcp-server option remove/);
  assert.match(plan.script, /comment~"d8b370c07adb"/);
});

test('perfil Hotspot e atualizado sem remover usuarios ou sessoes existentes', () => {
  const command = hotspotProfileUpsertCommand('kore-plano', '26M/51M');
  assert.match(command, /user profile set/);
  assert.match(command, /user profile add/);
  assert.doesNotMatch(command, /user profile remove/);
});
