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
const { parseUbiquitiDiscoveryPacket, unifiDhcpOption43 } = require(serverCopy);
delete process.env.KORE_TEST_EXPORTS;

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

function tlv(type, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const header = Buffer.alloc(3);
  header[0] = type;
  header.writeUInt16BE(data.length, 1);
  return Buffer.concat([header, data]);
}

function discoveryPacket(configStatus = 1) {
  const payload = Buffer.concat([
    tlv(0x02, Buffer.from([0xd8, 0xb3, 0x70, 0xc0, 0x7a, 0xdb, 192, 168, 1, 245])),
    tlv(0x15, 'UAP-AC-Lite'),
    tlv(0x16, '6.6.77'),
    tlv(0x17, Buffer.from([configStatus]))
  ]);
  const header = Buffer.alloc(4);
  header[0] = 2;
  header[1] = 6;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

test('Option 43 UniFi inclui IP e URL completa do Inform', () => {
  const result = unifiDhcpOption43('190.8.175.35', '190.8.175.35');
  assert.equal(result.informUrl, 'http://190.8.175.35:8080/inform');
  assert.equal(result.optionValue, '0x0104be08af23021f687474703a2f2f3139302e382e3137352e33353a383038302f696e666f726d');
});

test('discovery Ubiquiti identifica o AP e seu estado de fabrica', () => {
  const result = parseUbiquitiDiscoveryPacket(discoveryPacket(1));
  assert.deepEqual(result.macs, ['D8:B3:70:C0:7A:DB']);
  assert.deepEqual(result.ips, ['192.168.1.245']);
  assert.equal(result.model, 'UAP-AC-Lite');
  assert.equal(result.version, '6.6.77');
  assert.equal(result.config_status, 'default/unmanaged');
});

test('discovery Ubiquiti distingue equipamento ainda gerenciado', () => {
  assert.equal(parseUbiquitiDiscoveryPacket(discoveryPacket(0)).config_status, 'managed/adopted');
});

test('discovery Ubiquiti rejeita pacote com tamanho inconsistente', () => {
  const packet = discoveryPacket(1);
  packet.writeUInt16BE(packet.length, 2);
  assert.equal(parseUbiquitiDiscoveryPacket(packet), null);
});
