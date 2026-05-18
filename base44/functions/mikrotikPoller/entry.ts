import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MIKROTIK_USER = Deno.env.get("MIKROTIK_USER") || "admin";
const MIKROTIK_PASSWORD = Deno.env.get("MIKROTIK_PASSWORD") || "";

// Fetch from a single MikroTik REST API endpoint
async function mkFetch(baseUrl, path) {
  const url = `${baseUrl}/rest${path}`;
  const headers = {
    "Authorization": "Basic " + btoa(`${MIKROTIK_USER}:${MIKROTIK_PASSWORD}`),
    "Content-Type": "application/json",
  };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`MikroTik API error ${res.status} on ${url}`);
  return res.json();
}

// Poll one AP and return normalized metrics
async function pollAP(ap) {
  const baseUrl = `http://${ap.ip}`;

  try {
    // Wireless registration table (connected clients + signal)
    const [regTable, interfaces, resources] = await Promise.all([
      mkFetch(baseUrl, "/interface/wireless/registration-table"),
      mkFetch(baseUrl, "/interface/wireless"),
      mkFetch(baseUrl, "/system/resource"),
    ]);

    // Find the wireless interface matching the AP's SSID or first available
    const wIface = interfaces.find(i => i.ssid === ap.ssid) || interfaces[0];

    // Aggregate signal from registration table
    const clients = regTable.length;
    const signals = regTable.map(r => parseInt(r["signal-strength"]) || -90);
    const signalAvg = signals.length > 0
      ? Math.round(signals.reduce((a, b) => a + b, 0) / signals.length)
      : -90;
    const noise = parseInt(wIface?.["noise-floor"]) || -95;
    const channel = parseInt(wIface?.["channel"] || ap.channel);
    const txPower = parseInt(wIface?.["tx-power"] || ap.txPower);
    const band = wIface?.band?.includes("5ghz") ? "5GHz" : "2.4GHz";

    // Utilization from CPU as proxy (or wireless interface tx/rx load)
    const cpuLoad = parseInt(resources?.["cpu-load"]) || 0;
    const uptime = resources?.uptime || ap.uptime || "0s";
    const maxClients = ap.maxClients || 30;
    const utilization = Math.min(100, Math.round((clients / maxClients) * 70 + cpuLoad * 0.3));

    // Determine status
    let status = "ok";
    if (clients >= maxClients * 0.9 || utilization > 85) status = "overloaded";
    else if (signalAvg < -80) status = "weak_signal";
    else if (noise > -85) status = "interference";

    return {
      ...ap,
      clients,
      signalAvg,
      noise,
      channel,
      txPower,
      band,
      utilization,
      uptime,
      maxClients,
      status,
      lastPolled: new Date().toISOString(),
      pollError: null,
    };
  } catch (err) {
    // On error, return AP as offline with original data preserved
    return {
      ...ap,
      status: "offline",
      pollError: err.message,
      lastPolled: new Date().toISOString(),
    };
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { aps } = body;

  if (!aps || !Array.isArray(aps) || aps.length === 0) {
    return Response.json({ error: "aps array required" }, { status: 400 });
  }

  // Poll all APs concurrently
  const results = await Promise.all(aps.map(ap => pollAP(ap)));

  return Response.json({ aps: results });
});