import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import APHeatmapGrid from '@/components/ap/APHeatmapGrid';
import APChannelAnalyzer from '@/components/ap/APChannelAnalyzer';
import APAlertPanel from '@/components/ap/APAlertPanel';
import APLoadBalancer from '@/components/ap/APLoadBalancer';
import APStatsBar from '@/components/ap/APStatsBar';
import { Wifi, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// AP data generator — simulates SNMP/WLC polling
function generateAPs() {
  return [
    { id: 'ap1', name: 'AP-Recepção',     ip: '10.0.1.1',  location: { x: 15, y: 20 }, band: '2.4GHz', channel: 6,  clients: 28, maxClients: 30, signalAvg: -58, noise: -92, txPower: 20, utilization: 93, uptime: '12d 4h', status: 'overloaded', ssids: ['KoreHotspot', 'KoreGuest'] },
    { id: 'ap2', name: 'AP-Café',         ip: '10.0.1.2',  location: { x: 45, y: 20 }, band: '5GHz',   channel: 36, clients: 14, maxClients: 30, signalAvg: -62, noise: -95, txPower: 23, utilization: 47, uptime: '12d 4h', status: 'ok',        ssids: ['KoreHotspot'] },
    { id: 'ap3', name: 'AP-Auditório',    ip: '10.0.1.3',  location: { x: 75, y: 20 }, band: '2.4GHz', channel: 6,  clients: 22, maxClients: 30, signalAvg: -71, noise: -88, txPower: 20, utilization: 73, uptime: '8d 2h',  status: 'interference', ssids: ['KoreHotspot'] },
    { id: 'ap4', name: 'AP-CorredorN',    ip: '10.0.1.4',  location: { x: 15, y: 55 }, band: '5GHz',   channel: 44, clients: 8,  maxClients: 30, signalAvg: -55, noise: -96, txPower: 20, utilization: 27, uptime: '5d 11h', status: 'ok',        ssids: ['KoreHotspot'] },
    { id: 'ap5', name: 'AP-HallCentral', ip: '10.0.1.5',  location: { x: 45, y: 55 }, band: '2.4GHz', channel: 11, clients: 19, maxClients: 30, signalAvg: -64, noise: -90, txPower: 23, utilization: 63, uptime: '12d 4h', status: 'ok',        ssids: ['KoreHotspot', 'KoreGuest'] },
    { id: 'ap6', name: 'AP-CorredorS',   ip: '10.0.1.6',  location: { x: 75, y: 55 }, band: '5GHz',   channel: 36, clients: 31, maxClients: 30, signalAvg: -60, noise: -94, txPower: 20, utilization: 88, uptime: '3d 7h',  status: 'overloaded', ssids: ['KoreHotspot'] },
    { id: 'ap7', name: 'AP-ExtSul',      ip: '10.0.1.7',  location: { x: 25, y: 82 }, band: '2.4GHz', channel: 1,  clients: 5,  maxClients: 25, signalAvg: -78, noise: -86, txPower: 26, utilization: 20, uptime: '12d 4h', status: 'weak_signal', ssids: ['KoreHotspot'] },
    { id: 'ap8', name: 'AP-Estacion.',   ip: '10.0.1.8',  location: { x: 65, y: 82 }, band: '5GHz',   channel: 149,clients: 3,  maxClients: 25, signalAvg: -82, noise: -85, txPower: 26, utilization: 12, uptime: '12d 4h', status: 'weak_signal', ssids: ['KoreHotspot'] },
  ];
}

export default function APMonitor() {
  const [aps, setAPs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedAP, setSelectedAP] = useState(null);
  const [actionLog, setActionLog] = useState([]);

  const loadData = useCallback(() => {
    setLoading(true);
    const data = generateAPs().map(ap => ({
      ...ap,
      signalAvg: ap.signalAvg + Math.round((Math.random() - 0.5) * 4),
      utilization: Math.min(100, Math.max(0, ap.utilization + Math.round((Math.random() - 0.5) * 8))),
      clients: Math.max(0, ap.clients + Math.round((Math.random() - 0.5) * 2)),
    }));
    setAPs(data);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(loadData, 10000);
    return () => clearInterval(t);
  }, [autoRefresh, loadData]);

  const handleBalanceAP = async (apFrom, apTo, suggestion) => {
    setAPs(prev => prev.map(ap => {
      if (ap.id === apFrom.id) return { ...ap, clients: Math.max(0, ap.clients - suggestion.clientsToMove), utilization: Math.max(0, ap.utilization - suggestion.utilizationDrop) };
      if (ap.id === apTo.id) return { ...ap, clients: ap.clients + suggestion.clientsToMove, utilization: Math.min(100, ap.utilization + suggestion.utilizationGain) };
      return ap;
    }));
    const entry = { time: new Date(), action: 'balance', detail: `${suggestion.clientsToMove} clientes migrados de ${apFrom.name} → ${apTo.name}` };
    setActionLog(prev => [entry, ...prev].slice(0, 15));
    await base44.entities.AuditLog.create({ action: 'ap_load_balance', entity_type: 'mikrotik', entity_name: apFrom.name, status: 'success', message: `Balanceamento: ${apFrom.name} → ${apTo.name} (${suggestion.clientsToMove} clientes)` }).catch(() => {});
  };

  const handleChangeChannel = async (ap, newChannel) => {
    setAPs(prev => prev.map(a => a.id === ap.id ? { ...a, channel: newChannel, status: 'ok' } : a));
    const entry = { time: new Date(), action: 'channel', detail: `${ap.name}: canal ${ap.channel} → ${newChannel}` };
    setActionLog(prev => [entry, ...prev].slice(0, 15));
    await base44.entities.AuditLog.create({ action: 'ap_channel_change', entity_type: 'mikrotik', entity_name: ap.name, status: 'success', message: `Canal alterado: ${ap.name} CH${ap.channel} → CH${newChannel}` }).catch(() => {});
  };

  const overloaded = aps.filter(a => a.status === 'overloaded');
  const interference = aps.filter(a => a.status === 'interference');
  const weakSignal = aps.filter(a => a.status === 'weak_signal');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Wifi className="w-5 h-5 text-primary" />
            Monitoramento de Access Points
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            Última atualização: {lastRefresh.toLocaleTimeString('pt-BR')} · {aps.length} APs registrados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${autoRefresh ? 'bg-success/10 border-success/30 text-success' : 'bg-secondary border-border text-muted-foreground'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
            {autoRefresh ? 'Auto 10s' : 'Pausado'}
          </button>
          <Button size="sm" variant="outline" onClick={loadData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <APStatsBar aps={aps} loading={loading} />

      {/* Alerts */}
      {(overloaded.length > 0 || interference.length > 0 || weakSignal.length > 0) && (
        <APAlertPanel
          overloaded={overloaded}
          interference={interference}
          weakSignal={weakSignal}
          aps={aps}
          onChangeChannel={handleChangeChannel}
        />
      )}

      {/* Heatmap + Channel Analyzer side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3">
          <APHeatmapGrid aps={aps} loading={loading} selectedAP={selectedAP} onSelectAP={setSelectedAP} />
        </div>
        <div className="xl:col-span-2">
          <APChannelAnalyzer aps={aps} onChangeChannel={handleChangeChannel} />
        </div>
      </div>

      {/* Load Balancer */}
      <APLoadBalancer aps={aps} onBalance={handleBalanceAP} />

      {/* Action log */}
      {actionLog.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Log de Ações</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto scrollbar-thin">
            {actionLog.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-secondary/40">
                <span className="font-mono text-muted-foreground flex-shrink-0">{entry.time.toLocaleTimeString('pt-BR')}</span>
                <span className="font-semibold uppercase text-[10px] text-primary flex-shrink-0">{entry.action}</span>
                <span className="text-muted-foreground truncate">{entry.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}