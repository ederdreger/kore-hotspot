import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import snmp from 'npm:net-snmp@3.14.0';
import { Buffer } from 'node:buffer';

async function requireAdmin(base44, token) {
  if (!token) throw new Error('Sessão administrativa não enviada');
  const sessions = await base44.asServiceRole.entities.AdminSession.filter({ token });
  const session = sessions?.[0];
  if (!session || new Date(session.expires_at) < new Date()) throw new Error('Sessão administrativa expirada');
  return session;
}

function normalizeHost(host) {
  return String(host || '').trim().replace(/^snmp:\/\//i, '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
}

function readSnmp(host, community, port, oids) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community, {
      port: parseInt(port) || 161,
      version: snmp.Version2c,
      timeout: 2000,
      retries: 0,
      transport: 'udp4',
    });

    session.get(oids, (error, varbinds) => {
      session.close();
      if (error) return reject(error);
      const result = {};
      varbinds.forEach((varbind, index) => {
        if (!snmp.isVarbindError(varbind)) {
          result[oids[index]] = varbind.value;
        }
      });
      resolve(result);
    });
  });
}

function uncheckedPing() {
  return { online: null, latency_ms: null, error: 'Ping ICMP não disponível no ambiente seguro da aplicação' };
}

function uncheckedSsh(port) {
  return { reachable: null, port: parseInt(port) || 22, error: 'Teste SSH direto desativado para evitar timeout; use SNMP para coleta' };
}

function toText(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('utf8');
  return String(value);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatTicks(value) {
  const ticks = toNumber(value);
  if (ticks === null) return null;
  const seconds = Math.floor(ticks / 100);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

const OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  uptime: '1.3.6.1.2.1.1.3.0',
  cpuLoad: '1.3.6.1.4.1.14988.1.1.3.14.0',
  totalMemory: '1.3.6.1.4.1.14988.1.1.3.2.0',
  freeMemory: '1.3.6.1.4.1.14988.1.1.3.3.0',
  hotspotActive: '1.3.6.1.4.1.14988.1.1.5.1.0',
};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { host, port = '22', snmp_port = '161', snmp_community = 'public', token } = body;

  try {
    await requireAdmin(base44, token);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 401 });
  }

  if (!host) return Response.json({ error: 'host é obrigatório' }, { status: 400 });

  const cleanHost = normalizeHost(host);
  const ping = uncheckedPing();
  const ssh = uncheckedSsh(port);

  try {
    const data = await Promise.race([
      readSnmp(cleanHost, snmp_community, snmp_port, Object.values(OIDS)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SNMP timeout')), 3000)),
    ]);
    const versionText = toText(data[OIDS.sysDescr]);

    if (!versionText && !data[OIDS.uptime]) {
      return Response.json({
        connected: false,
        online: false,
        ping,
        ssh,
        snmp_connected: false,
        snmp_error: `SNMP respondeu em ${cleanHost}:${snmp_port}, mas não retornou dados do sistema.`,
      }, { status: 200 });
    }

    return Response.json({
      connected: true,
      online: true,
      protocol: 'SNMP',
      ping,
      ssh,
      snmp_connected: true,
      uptime: formatTicks(data[OIDS.uptime]),
      cpu_load: toNumber(data[OIDS.cpuLoad]),
      free_memory: toNumber(data[OIDS.freeMemory]),
      total_memory: toNumber(data[OIDS.totalMemory]),
      temperature: null,
      board_name: toText(data[OIDS.sysName]) || null,
      version: versionText || null,
      active_users: toNumber(data[OIDS.hotspotActive]),
      hotspot_count: null,
      radius_hotspot_count: null,
    });
  } catch (err) {
    let msg = err.message || 'Falha ao consultar SNMP';
    if (msg.includes('RequestTimedOut') || msg.includes('timed out')) {
      msg = `Sem resposta SNMP em ${cleanHost}:${snmp_port} — verifique se o SNMP está ativo e liberado no firewall`;
    } else if (msg.includes('NoSuchName') || msg.includes('authorization')) {
      msg = 'Comunidade SNMP inválida ou sem permissão de leitura';
    }
    return Response.json({
      connected: false,
      online: false,
      ping,
      ssh,
      snmp_connected: false,
      snmp_error: msg,
    }, { status: 200 });
  }
});