import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import APHeatmapGrid from '@/components/ap/APHeatmapGrid';
import APChannelAnalyzer from '@/components/ap/APChannelAnalyzer';
import APAlertPanel from '@/components/ap/APAlertPanel';
import APLoadBalancer from '@/components/ap/APLoadBalancer';
import APStatsBar from '@/components/ap/APStatsBar';
import APRegisterModal from '@/components/ap/APRegisterModal';
import { Wifi, RefreshCw, Plus, MapPin, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Default APs with real urban addresses (demo data)
const DEFAULT_APS = [
  { id: 'ap1', name: 'AP-PraçaCentral-01', street: 'Praça Dr. Bozano', number: 's/n', neighborhood: 'Centro', city: 'Maringá', reference: 'Poste próximo ao coreto', ip: '10.0.1.1', band: '2.4GHz', channel: 6,   clients: 28, maxClients: 30, signalAvg: -58, noise: -92, txPower: 20, utilization: 93, uptime: '12d 4h', status: 'overloaded', ssid: 'KoreHotspot', notes: '' },
  { id: 'ap2', name: 'AP-RuaXV-01',        street: 'Rua XV de Novembro', number: '340', neighborhood: 'Centro', city: 'Maringá', reference: 'Fachada do Correios', ip: '10.0.1.2', band: '5GHz',   channel: 36, clients: 14, maxClients: 30, signalAvg: -62, noise: -95, txPower: 23, utilization: 47, uptime: '12d 4h', status: 'ok', ssid: 'KoreHotspot', notes: '' },
  { id: 'ap3', name: 'AP-AveColombó-01',   street: 'Av. Colombo', number: '5900', neighborhood: 'Zona 7', city: 'Maringá', reference: 'Poste em frente UEM portão 1', ip: '10.0.1.3', band: '2.4GHz', channel: 6,   clients: 22, maxClients: 30, signalAvg: -71, noise: -88, txPower: 20, utilization: 73, uptime: '8d 2h',  status: 'interference', ssid: 'KoreHotspot', notes: '' },
  { id: 'ap4', name: 'AP-PraçaItália-01',  street: 'Praça Itália', number: 's/n', neighborhood: 'Zona 3', city: 'Maringá', reference: 'Palmeira central', ip: '10.0.1.4', band: '5GHz',   channel: 44, clients: 8,  maxClients: 30, signalAvg: -55, noise: -96, txPower: 20, utilization: 27, uptime: '5d 11h', status: 'ok', ssid: 'KoreHotspot', notes: '' },
  { id: 'ap5', name: 'AP-AveAngelo-01',    street: 'Av. Ângelo Moreira', number: '200', neighborhood: 'Zona 3', city: 'Maringá', reference: 'Esquina com R. Santos Dumont', ip: '10.0.1.5', band: '2.4GHz', channel: 11, clients: 19, maxClients: 30, signalAvg: -64, noise: -90, txPower: 23, utilization: 63, uptime: '12d 4h', status: 'ok', ssid: 'KoreHotspot', notes: '' },
  { id: 'ap6', name: 'AP-RuaBrasil-01',    street: 'Rua Brasil', number: '1200', neighborhood: 'Vila Nova', city: 'Maringá', reference: 'Farmácia Droga Raia', ip: '10.0.1.6', band: '5GHz',   channel: 36, clients: 31, maxClients: 30, signalAvg: -60, noise: -94, txPower: 20, utilization: 88, uptime: '3d 7h',  status: 'overloaded', ssid: 'KoreHotspot', notes: '' },
  { id: 'ap7', name: 'AP-PraçaXimenes-01', street: 'Praça Dep. Ximenes', number: 's/n', neighborhood: 'Vila Nova', city: 'Maringá', reference: 'Banco de concreto ao centro', ip: '10.0.1.7', band: '2.4GHz', channel: 1,   clients: 5,  maxClients: 25, signalAvg: -78, noise: -86, txPower: 26, utilization: 20, uptime: '12d 4h', status: 'weak_signal', ssid: 'KoreHotspot', notes: '' },
  { id: 'ap8', name: 'AP-AveItaipu-01',    street: 'Av. Itaipu', number: '450', neighborhood: 'Jardim Alvorada', city: 'Maringá', reference: 'Poste frente à UPA', ip: '10.0.1.8', band: '5GHz',   channel: 149, clients: 3, maxClients: 25, signalAvg: -82, noise: -85, txPower: 26, utilization: 12, uptime: '12d 4h', status: 'weak_signal', ssid: 'KoreHotspot', notes: '' },
];

export default function APMonitor() {
  const [aps, setAPs] = useState(DEFAULT_APS);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedAP, setSelectedAP] = useState(null);
  const [actionLog, setActionLog] = useState([]);
  const [showRegister, setShowRegister] = useState(false);
  const [editingAP, setEditingAP] = useState(null);
  const [view, setView] = useState('map'); // 'map' | 'list'

  const refreshMetrics = useCallback(() => {
    setLoading(true);
    setAPs(prev => prev.map(ap => ({
      ...ap,
      signalAvg: Math.max(-95, Math.min(-45, ap.signalAvg + Math.round((Math.random() - 0.5) * 4))),
      utilization: Math.min(100, Math.max(0, ap.utilization + Math.round((Math.random() - 0.5) * 8))),
      clients: Math.max(0, ap.clients + Math.round((Math.random() - 0.5) * 2)),
    })));
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(refreshMetrics, 10000);
    return () => clearInterval(t);
  }, [autoRefresh, refreshMetrics]);

  const handleRegister = (formData) => {
    if (editingAP) {
      setAPs(prev => prev.map(a => a.id === editingAP.id ? { ...a, ...formData } : a));
      setEditingAP(null);
    } else {
      const newAP = {
        ...formData,
        id: `ap_${Date.now()}`,
        clients: 0,
        signalAvg: -65,
        noise: -92,
        utilization: 0,
        uptime: '0m',
        status: 'ok',
      };
      setAPs(prev => [...prev, newAP]);
      base44.entities.AuditLog.create({ action: 'ap_registered', entity_type: 'mikrotik', entity_name: formData.name, status: 'success', message: `AP cadastrado: ${formData.name} — ${formData.street}${formData.number ? ', ' + formData.number : ''}, ${formData.neighborhood}` }).catch(() => {});
    }
    setShowRegister(false);
  };

  const handleDelete = (ap) => {
    setAPs(prev => prev.filter(a => a.id !== ap.id));
    if (selectedAP?.id === ap.id) setSelectedAP(null);
    base44.entities.AuditLog.create({ action: 'ap_removed', entity_type: 'mikrotik', entity_name: ap.name, status: 'info', message: `AP removido: ${ap.name}` }).catch(() => {});
  };

  const handleEdit = (ap) => {
    setEditingAP(ap);
    setShowRegister(true);
  };

  const handleBalanceAP = async (apFrom, apTo, suggestion) => {
    setAPs(prev => prev.map(ap => {
      if (ap.id === apFrom.id) return { ...ap, clients: Math.max(0, ap.clients - suggestion.clientsToMove), utilization: Math.max(0, ap.utilization - suggestion.utilizationDrop) };
      if (ap.id === apTo.id) return { ...ap, clients: ap.clients + suggestion.clientsToMove, utilization: Math.min(100, ap.utilization + suggestion.utilizationGain) };
      return ap;
    }));
    const entry = { time: new Date(), action: 'balance', detail: `${suggestion.clientsToMove} clientes: ${apFrom.name} → ${apTo.name}` };
    setActionLog(prev => [entry, ...prev].slice(0, 15));
    await base44.entities.AuditLog.create({ action: 'ap_load_balance', entity_type: 'mikrotik', entity_name: apFrom.name, status: 'success', message: `Balanceamento: ${apFrom.name} → ${apTo.name} (${suggestion.clientsToMove} clientes)` }).catch(() => {});
  };

  const handleChangeChannel = async (ap, newChannel) => {
    setAPs(prev => prev.map(a => a.id === ap.id ? { ...a, channel: newChannel, status: 'ok' } : a));
    const entry = { time: new Date(), action: 'channel', detail: `${ap.name}: CH${ap.channel} → CH${newChannel}` };
    setActionLog(prev => [entry, ...prev].slice(0, 15));
    await base44.entities.AuditLog.create({ action: 'ap_channel_change', entity_type: 'mikrotik', entity_name: ap.name, status: 'success', message: `Canal alterado: ${ap.name} CH${ap.channel} → CH${newChannel}` }).catch(() => {});
  };

  const overloaded  = aps.filter(a => a.status === 'overloaded');
  const interference = aps.filter(a => a.status === 'interference');
  const weakSignal  = aps.filter(a => a.status === 'weak_signal');

  // Group by neighborhood for list view
  const byNeighborhood = aps.reduce((acc, a) => {
    const key = a.neighborhood || 'Sem Bairro';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  const statusColors = {
    ok: 'text-success', overloaded: 'text-destructive',
    interference: 'text-warning', weak_signal: 'text-info', offline: 'text-muted-foreground',
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Wifi className="w-5 h-5 text-primary" />
            Monitoramento de Access Points
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            Última atualização: {lastRefresh.toLocaleTimeString('pt-BR')} · {aps.length} APs cadastrados
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex items-center bg-secondary rounded-lg p-1">
            {['map', 'list'].map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${view === v ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}>
                {v === 'map' ? 'Mapa' : 'Lista'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${autoRefresh ? 'bg-success/10 border-success/30 text-success' : 'bg-secondary border-border text-muted-foreground'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
            {autoRefresh ? 'Auto 10s' : 'Pausado'}
          </button>
          <Button size="sm" variant="outline" onClick={refreshMetrics} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => { setEditingAP(null); setShowRegister(true); }} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Cadastrar AP
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <APStatsBar aps={aps} loading={loading} />

      {/* Alerts */}
      {(overloaded.length > 0 || interference.length > 0 || weakSignal.length > 0) && (
        <APAlertPanel overloaded={overloaded} interference={interference} weakSignal={weakSignal} aps={aps} onChangeChannel={handleChangeChannel} />
      )}

      {/* Map view */}
      {view === 'map' && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-3">
            <APHeatmapGrid aps={aps} loading={loading} selectedAP={selectedAP} onSelectAP={setSelectedAP} onEditAP={handleEdit} />
          </div>
          <div className="xl:col-span-2">
            <APChannelAnalyzer aps={aps} onChangeChannel={handleChangeChannel} />
          </div>
        </div>
      )}

      {/* List view — grouped by neighborhood */}
      {view === 'list' && (
        <div className="space-y-4">
          {Object.entries(byNeighborhood).map(([nbh, apList]) => (
            <div key={nbh} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                <span className="text-sm font-semibold text-foreground">{nbh}</span>
                <span className="text-xs text-muted-foreground ml-1">({apList.length} AP{apList.length > 1 ? 's' : ''})</span>
              </div>
              <div className="divide-y divide-border">
                {apList.map(apItem => (
                  <div key={apItem.id} className="flex items-center gap-4 px-5 py-3 hover:bg-secondary/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${apItem.status === 'ok' ? 'bg-success' : apItem.status === 'overloaded' ? 'bg-destructive' : apItem.status === 'interference' ? 'bg-warning' : apItem.status === 'weak_signal' ? 'bg-info' : 'bg-muted-foreground'}`} />
                        <p className="text-sm font-semibold text-foreground truncate">{apItem.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        <MapPin className="w-3 h-3 inline mr-1" />
                        {apItem.street}{apItem.number ? `, ${apItem.number}` : ''}{apItem.city ? ` — ${apItem.city}` : ''}
                      </p>
                      {apItem.reference && <p className="text-[11px] text-muted-foreground/60 italic">Ref: {apItem.reference}</p>}
                    </div>
                    <div className="hidden md:flex items-center gap-4 text-xs flex-shrink-0">
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">IP</p>
                        <p className="font-mono text-info">{apItem.ip}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">Banda</p>
                        <p className="font-mono text-foreground">{apItem.band} CH{apItem.channel}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">Clientes</p>
                        <p className={`font-mono font-bold ${apItem.clients >= apItem.maxClients * 0.9 ? 'text-destructive' : 'text-success'}`}>{apItem.clients}/{apItem.maxClients}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">Util.</p>
                        <p className={`font-mono font-bold ${apItem.utilization > 85 ? 'text-destructive' : apItem.utilization > 65 ? 'text-warning' : 'text-success'}`}>{apItem.utilization}%</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">Sinal</p>
                        <p className={`font-mono font-bold ${apItem.signalAvg >= -65 ? 'text-success' : apItem.signalAvg >= -75 ? 'text-warning' : 'text-destructive'}`}>{apItem.signalAvg} dBm</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => handleEdit(apItem)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(apItem)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

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

      {/* Register/Edit Modal */}
      {showRegister && (
        <APRegisterModal
          ap={editingAP}
          onSave={handleRegister}
          onClose={() => { setShowRegister(false); setEditingAP(null); }}
        />
      )}
    </div>
  );
}