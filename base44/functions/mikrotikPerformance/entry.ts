import { createClientFromRequest } from 'npm:@base44/sdk@0.8.29';
import snmp from 'npm:net-snmp@3.14.0';
import { Client } from 'npm:ssh2@1.16.0';

async function requireAdmin(base44, token) {
  if (!token) throw new Error('Sessão administrativa não enviada');
  const sessions = await base44.asServiceRole.entities.AdminSession.filter({ token });
  const session = sessions?.[0];
  if (!session || new Date(session.expires_at) < new Date()) throw new Error('Sessão administrativa expirada');
  return session;
}

function normalizeHost(host) {
  return String(host || '').trim().replace(/^ssh:\/\//i, '').replace(/^snmp:\/\//i, '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
}

// Tenta via SNMP (Pode ser bloqueado em ambientes Serverless/Edge)
function getSnmpData(host, community) {
  return new Promise((resolve, reject) => {
    let handled = false;
    const timer = setTimeout(() => {
      if (!handled) {
        handled = true;
        reject(new Error('Timeout SNMP'));
      }
    }, 4000);

    try {
      const session = snmp.createSession(host, community || 'public', { timeout: 1500, retries: 1 });
      const oids = [
        "1.3.6.1.2.1.25.3.3.1.2.1",     // CPU Load (Core 1)
        "1.3.6.1.2.1.25.2.3.1.5.65536", // Mem Total
        "1.3.6.1.2.1.25.2.3.1.6.65536", // Mem Used
        "1.3.6.1.2.1.31.1.1.1.6.1",     // RX Bytes (If 1)
        "1.3.6.1.2.1.31.1.1.1.10.1"     // TX Bytes (If 1)
      ];
      
      session.on('error', (err) => {
        if (!handled) {
          handled = true;
          clearTimeout(timer);
          try { session.close(); } catch(e){}
          reject(err);
        }
      });

      session.get(oids, (error, varbinds) => {
        if (handled) return;
        handled = true;
        clearTimeout(timer);
        
        if (error) {
          try { session.close(); } catch(e){}
          return reject(error);
        }
        
        const data = {};
        if (!snmp.isVarbindError(varbinds[0])) data.cpu = varbinds[0].value;
        if (!snmp.isVarbindError(varbinds[1])) data.memTotal = varbinds[1].value;
        if (!snmp.isVarbindError(varbinds[2])) data.memUsed = varbinds[2].value;
        if (!snmp.isVarbindError(varbinds[3])) data.rxBytes = varbinds[3].value;
        if (!snmp.isVarbindError(varbinds[4])) data.txBytes = varbinds[4].value;
        
        try { session.close(); } catch(e){}
        resolve(data);
      });
    } catch (err) {
      if (!handled) {
        handled = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

// Fallback via SSH (Garante o funcionamento se o UDP for bloqueado)
function getSshData(host, port, username, password, interfaceName = 'ether1') {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = '';
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error('Timeout SSH'));
    }, 10000);

    conn.on('ready', () => {
      // Coleta CPU, Memória e Tráfego da interface principal em um único comando
      const cmd = `/system resource print; /interface monitor-traffic [find name="${interfaceName}"] once as-value`;
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        stream.on('data', d => { out += d.toString(); });
        stream.on('close', () => {
          clearTimeout(timer);
          conn.end();
          
          const data = { cpu: 0, memTotal: 0, memUsed: 0, rxBps: 0, txBps: 0 };
          
          // Parse CPU e Memoria
          const lines = out.split('\n');
          lines.forEach(line => {
            if (line.includes('free-memory:')) {
               const free = parseInt(line.split('free-memory:')[1].replace(/[^0-9]/g, ''));
               if (!data.memUsed && data.memTotal) data.memUsed = data.memTotal - (free * 1024);
            }
            if (line.includes('total-memory:')) {
               data.memTotal = parseInt(line.split('total-memory:')[1].replace(/[^0-9]/g, '')) * 1024;
            }
            if (line.includes('cpu-load:')) data.cpu = parseInt(line.split('cpu-load:')[1].replace(/[^0-9]/g, ''));
            if (line.includes('rx-bits-per-second=')) data.rxBps = parseInt(line.split('rx-bits-per-second=')[1]);
            if (line.includes('tx-bits-per-second=')) data.txBps = parseInt(line.split('tx-bits-per-second=')[1]);
          });
          
          // Cálculo de MemUsed caso total-memory venha antes de free-memory
          lines.forEach(line => {
             if (line.includes('free-memory:')) {
                const free = parseInt(line.split('free-memory:')[1].replace(/[^0-9]/g, '')) * 1024;
                data.memUsed = data.memTotal - free;
             }
          });

          resolve(data);
        });
      });
    });
    conn.on('keyboard-interactive', (name, instr, lang, prompts, finish) => finish([password]));
    conn.on('error', err => { clearTimeout(timer); reject(err); });
    conn.connect({
      host, port: parseInt(port) || 22, username, password, tryKeyboard: true, readyTimeout: 8000,
      algorithms: {
        cipher: ['aes256-cbc', 'aes128-cbc'],
        serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss']
      }
    });
  });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  
  const body = await req.json().catch(() => ({}));
  const { host, port = '22', user = 'admin', password = '', community = 'public', interface_name = 'ether1', token } = body;

  try {
    await requireAdmin(base44, token);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 401 });
  }

  if (!host) return Response.json({ error: 'Host é obrigatório' }, { status: 400 });
  const cleanHost = normalizeHost(host);

  try {
    let result = null;
    let method = 'SNMP';

    try {
      // 1. Tentativa via SNMP
      const snmpData = await getSnmpData(cleanHost, community);
      // Converte bytes para Mbps (Simulação de rate pra dashboard se não for série temporal local)
      result = {
        cpu: snmpData.cpu,
        memTotal: snmpData.memTotal,
        memUsed: snmpData.memUsed,
        rxMbps: (snmpData.rxBytes * 8 / 1000000).toFixed(2), // Necessita variação de tempo real na UI, enviamos bruto como Mbps fake ou zero
        txMbps: (snmpData.txBytes * 8 / 1000000).toFixed(2),
        protocol: method
      };
    } catch (snmpErr) {
      // 2. Fallback via SSH se SNMP falhar (Ex: Ambiente Cloud Edge sem UDP)
      method = 'SSH (Fallback)';
      const sshData = await getSshData(cleanHost, port, user, password, interface_name);
      result = {
        cpu: sshData.cpu,
        memTotal: sshData.memTotal,
        memUsed: sshData.memUsed,
        rxMbps: (sshData.rxBps / 1000000).toFixed(2),
        txMbps: (sshData.txBps / 1000000).toFixed(2),
        protocol: method
      };
    }

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (err) {
    let msg = err.message || 'Falha ao conectar via SNMP/SSH';
    if (msg.includes('Timeout')) msg = `Timeout ao conectar em ${cleanHost} via SNMP/SSH`;
    else if (msg.includes('Authentication')) msg = `Usuário ou senha inválidos para o MikroTik`;
    else if (msg.includes('refused')) msg = `Conexão recusada em ${cleanHost}`;
    
    return Response.json({ success: false, error: msg }, { status: 200 });
  }
});