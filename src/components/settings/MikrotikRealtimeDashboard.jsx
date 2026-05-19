import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, Cpu, HardDrive, RefreshCw, Router, Users, Wifi } from 'lucide-react';

function MonitorCard({ device, status }) {
  const online = status?.connected === true && !status?.error;
  const memoryUsed = online && status?.total_memory && status?.free_memory
    ? Math.round(((status.total_memory - status.free_memory) / status.total_memory) * 100)
    : null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{device.name}</p>
          <p className="text-xs font-mono text-muted-foreground truncate">{device.host}:{device.port || '22'}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium border ${online ? 'bg-success/10 text-success border-success/30' : 'bg-destructive/10 text-destructive border-destructive/30'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-success animate-pulse' : 'bg-destructive'}`} />
          {status?.loading ? 'Lendo...' : online ? 'Online' : 'Offline'}
        </span>
      </div>

      {status?.error ? (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="line-clamp-2">{status.error}</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-secondary/50 rounded-lg p-2">
            <div className="flex items-center gap-1 text-muted-foreground"><Cpu className="w-3 h-3" /> CPU</div>
            <p className="font-mono font-semibold text-foreground">{status?.cpu_load ?? '—'}%</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-2">
            <div className="flex items-center gap-1 text-muted-foreground"><HardDrive className="w-3 h-3" /> Memória</div>
            <p className="font-mono font-semibold text-foreground">{memoryUsed ?? '—'}%</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-2">
            <div className="flex items-center gap-1 text-muted-foreground"><Users className="w-3 h-3" /> Usuários</div>
            <p className="font-mono font-semibold text-foreground">{status?.active_users ?? '—'}</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-2">
            <div className="flex items-center gap-1 text-muted-foreground"><Wifi className="w-3 h-3" /> Hotspot</div>
            <p className="font-mono font-semibold text-foreground">{status?.hotspot_count ?? '—'}</p>
          </div>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground font-mono truncate">
        {device.bridge_name || device.hotspot_interface || 'bridge'} · {device.vlan_id ? `VLAN ${device.vlan_id}` : (device.physical_interface || 'ether')}
      </div>
    </div>
  );
}

export default function MikrotikRealtimeDashboard({ devices, token }) {
  const [statuses, setStatuses] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const loadStatuses = async () => {
    if (!devices.length) return;
    setRefreshing(true);
    setStatuses(Object.fromEntries(devices.map(device => [device._id, { loading: true }])));

    const results = await Promise.all(devices.map(async (device) => {
      try {
        const response = await base44.functions.invoke('mikrotikStatus', {
          host: device.host,
          port: device.port,
          user: device.user,
          password: device.password,
          token,
        });
        return [device._id, response.data];
      } catch (error) {
        return [device._id, { error: error?.response?.data?.error || 'Falha ao consultar MikroTik' }];
      }
    }));

    setStatuses(Object.fromEntries(results));
    setRefreshing(false);
  };

  useEffect(() => {
    loadStatuses();
    const interval = setInterval(loadStatuses, 30000);
    return () => clearInterval(interval);
  }, [devices.length, token]);

  const summary = useMemo(() => {
    const values = Object.values(statuses);
    const online = values.filter(status => status?.connected === true && !status?.error).length;
    const users = values.reduce((total, status) => total + (Number(status?.active_users) || 0), 0);
    return { online, offline: Math.max(devices.length - online, 0), users };
  }, [statuses, devices.length]);

  if (!devices.length) return null;

  return (
    <div className="mb-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Monitoramento em tempo real
          </h3>
          <p className="text-xs text-muted-foreground">Atualização automática a cada 30 segundos</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStatuses} disabled={refreshing} className="gap-2 border-border">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar agora
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-secondary/50 border border-border rounded-xl p-3 flex items-center gap-2">
          <Router className="w-4 h-4 text-success" />
          <div><p className="text-lg font-bold font-mono">{summary.online}</p><p className="text-[11px] text-muted-foreground">Online</p></div>
        </div>
        <div className="bg-secondary/50 border border-border rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <div><p className="text-lg font-bold font-mono">{summary.offline}</p><p className="text-[11px] text-muted-foreground">Offline</p></div>
        </div>
        <div className="bg-secondary/50 border border-border rounded-xl p-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <div><p className="text-lg font-bold font-mono">{summary.users}</p><p className="text-[11px] text-muted-foreground">Usuários</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {devices.map(device => <MonitorCard key={device._id} device={device} status={statuses[device._id]} />)}
      </div>
    </div>
  );
}