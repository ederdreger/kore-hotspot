import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
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
const { normalizeRouterHex, unifiDhcpOption43, unifiDiscoveryRelayPlan } = require(serverCopy);
delete process.env.KORE_TEST_EXPORTS;

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('Option 43 UniFi inclui IP e URL completa do Inform', () => {
  const result = unifiDhcpOption43('190.8.175.35', '190.8.175.35');
  assert.equal(result.informUrl, 'http://190.8.175.35:8080/inform');
  assert.equal(result.optionValue, '0x0104be08af23021f687474703a2f2f3139302e382e3137352e33353a383038302f696e666f726d');
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
