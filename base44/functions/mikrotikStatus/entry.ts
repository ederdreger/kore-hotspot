import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { host, port = '8728', user: mtUser = 'admin', password = '' } = body;

  if (!host) return Response.json({ error: 'host é obrigatório' }, { status: 400 });

  // MikroTik REST API: port 80 (HTTP) or 443 (HTTPS)
  // Ports 8728/8729 are RouterOS API (binary), not REST
  // Port 8778 may be custom REST — try it first, fall back to 80
  const restPort = (port === '8728' || port === '8729') ? '80' : port;
  const baseUrl = `http://${host}:${restPort}`;
  const auth = 'Basic ' + btoa(`${mtUser}:${password}`);
  const headers = { 'Authorization': auth, 'Content-Type': 'application/json' };
  const timeout = AbortSignal.timeout(6000);

  async function mkGet(path) {
    const res = await fetch(`${baseUrl}/rest${path}`, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  try {
    const [resources, hotspotActive] = await Promise.allSettled([
      mkGet('/system/resource'),
      mkGet('/ip/hotspot'),
    ]);


    const res = resources.status === 'fulfilled' ? resources.value : null;
    if (!res) throw new Error('Não foi possível obter recursos do sistema');

    const hotspots = hotspotActive.status === 'fulfilled' ? hotspotActive.value : [];

    // Active hotspot users
    let activeUsers = 0;
    try {
      const activeRes = await mkGet('/ip/hotspot/active');
      activeUsers = Array.isArray(activeRes) ? activeRes.length : 0;
    } catch (_) {}

    return Response.json({
      uptime: res['uptime'] || null,
      cpu_load: parseInt(res['cpu-load']) || 0,
      free_memory: parseInt(res['free-memory']) || null,
      total_memory: parseInt(res['total-memory']) || null,
      temperature: res['cpu-temperature'] ? parseInt(res['cpu-temperature']) : null,
      board_name: res['board-name'] || null,
      version: res['version'] || null,
      active_users: activeUsers,
      hotspot_count: Array.isArray(hotspots) ? hotspots.length : 0,
    });
  } catch (err) {
    let msg = err.message;
    if (msg.includes('timed out') || msg.includes('timeout')) {
      msg = `Timeout ao conectar em ${host}:${restPort} — verifique se o IP é acessível pela internet e se a porta REST está aberta`;
    } else if (msg.includes('refused') || msg.includes('ECONNREFUSED')) {
      msg = `Conexão recusada em ${host}:${restPort} — verifique a porta REST API do MikroTik (padrão: 80)`;
    } else if (msg.includes('network') || msg.includes('ENETUNREACH')) {
      msg = `IP ${host} inacessível — o servidor está na internet? IPs privados (192.168.x, 10.x) não são acessíveis remotamente`;
    }
    return Response.json({ error: msg }, { status: 200 });
  }
});