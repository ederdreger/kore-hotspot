import { useState, useEffect, useCallback } from 'react';
import { spedynet } from '@/api/spedynetClient';
import { useAuth } from '@/lib/AuthContext';
import APHeatmapGrid from '@/components/ap/APHeatmapGrid';
import APChannelAnalyzer from '@/components/ap/APChannelAnalyzer';
import APAlertPanel from '@/components/ap/APAlertPanel';
import APLoadBalancer from '@/components/ap/APLoadBalancer';
import APStatsBar from '@/components/ap/APStatsBar';
import APRegisterModal from '@/components/ap/APRegisterModal';
import { Wifi, RefreshCw, Plus, MapPin, Trash2, Edit2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// No demo data — start empty for real cadastros
const DEFAULT_APS = [];

export default function APMonitor() {
  const { getToken } = useAuth();
  const [aps, setAPs] = useState(DEFAULT_APS);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedAP, setSelectedAP] = useState(null);
  const [actionLog, setActionLog] = useState([]);
  const [showRegister, setShowRegister] = useState(false);
  const [editingAP, setEditingAP] = useState(null);
  const [view, setView] = useState('map'); // 'map' | 'list'
  const [pollError, setPollError] = useState(null);
  const [usingSimulation, setUsingSimulation] = useState(false);

  const refreshMetrics = useCallback(async () => {
    setLoading(true);
    setPollError(null);
    try {
      const response = await spedynet.functions.invoke('mikrotikPoller', { aps, token: getToken() });
      const polled = response.data?.aps;
      if (polled && polled.length > 0) {
        setAPs(polled);
        setUsingSimulation(false);
      } else {
        throw new Error('Resposta vazia da função de polling');
      }
    } catch (err) {
      setPollError(err.message || 'Falha ao conectar aos equipamentos');
      setUsingSimulation(true);
    }
    setLastRefresh(new Date());
    setLoading(false);
  }, [aps]);

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
      spedynet.entities.AuditLog.create({ action: 'ap_registered', entity_type: 'mikrotik', entity_name: formData.name, status: 'success', message: `AP cadastrado: ${formData.name} — ${formData.street}${formData.number ? ', ' + formData.number : ''}, ${formData.neighborhood}` }).catch(() => {});
    }
    setShowRegister(false);
  };

  const handleDelete = (ap) => {
    setAPs(prev => prev.filter(a => a.id !== ap.id));
    if (selectedAP?.id === ap.id) setSelectedAP(null);
    spedynet.entities.AuditLog.create({ action: 'ap_removed', entity_type: 'mikrotik', entity_name: ap.name, status: 'info', message: `AP removido: ${ap.name}` }).catch(() => {});
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
    await spedynet.entities.AuditLog.create({ action: 'ap_load_balance', entity_type: 'mikrotik', entity_name: apFrom.name, status: 'success', message: `Balanceamento: ${apFrom.name} → ${apTo.name} (${suggestion.clientsToMove} clientes)` }).catch(() => {});
  };

  const handleChangeChannel = async (ap, newChannel) => {
    setAPs(prev => prev.map(a => a.id === ap.id ? { ...a, channel: newChannel, status: 'ok' } : a));
    const entry = { time: new Date(), action: 'channel', detail: `${ap.name}: CH${ap.channel} → CH${newChannel}` };
    setActionLog(prev => [entry, ...prev].slice(0, 15));
    await spedynet.entities.AuditLog.create({ action: 'ap_channel_change', entity_type: 'mikrotik', entity_name: ap.name, status: 'success', message: `Canal alterado: ${ap.name} CH${ap.channel} → CH${newChannel}` }).catch(() => {});
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

      {/* Connection status banner */}
      {usingSimulation && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-warning/30 bg-warning/10 text-warning text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-medium">Modo simulação:</span>
          <span className="text-warning/80 truncate">{pollError}</span>
          <span className="ml-auto flex-shrink-0 text-warning/60">Verifique IP, usuário e senha nos secrets</span>
        </div>
      )}
      {!usingSimulation && lastRefresh && aps.some(a => a.pollError) && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {aps.filter(a => a.pollError).length} AP(s) offline ou inacessíveis via API REST
        </div>
      )}

      {/* Stats bar */}
      <APStatsBar aps={aps} loading={loading} />

      {/* Alerts */}
      {(overloaded.length > 0 || interference.length > 0 || weakSignal.length > 0) && (
        <APAlertPanel overloaded={overloaded} interference={interference} weakSignal={weakSignal} aps={aps} onChangeChannel={handleChangeChannel} />
      )}

      {/* Empty state */}
      {aps.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 bg-card border border-dashed border-border rounded-xl gap-4">
          <Wifi className="w-12 h-12 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">Nenhum AP cadastrado</p>
            <p className="text-xs text-muted-foreground mt-1">Clique em "Cadastrar AP" para adicionar o primeiro equipamento.</p>
          </div>
          <Button size="sm" onClick={() => { setEditingAP(null); setShowRegister(true); }} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Cadastrar primeiro AP
          </Button>
        </div>
      )}

      {/* Map view */}
      {aps.length > 0 && view === 'map' && (
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
      {aps.length > 0 && view === 'list' && (
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
      {aps.length > 0 && <APLoadBalancer aps={aps} onBalance={handleBalanceAP} />}

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
