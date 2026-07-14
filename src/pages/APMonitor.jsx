import { useState, useEffect, useCallback } from 'react';
import { spedynet } from '@/api/spedynetClient';
import APHeatmapGrid from '@/components/ap/APHeatmapGrid';
import APChannelAnalyzer from '@/components/ap/APChannelAnalyzer';
import APAlertPanel from '@/components/ap/APAlertPanel';
import APStatsBar from '@/components/ap/APStatsBar';
import APRegisterModal from '@/components/ap/APRegisterModal';
import APProfileManager from '@/components/ap/APProfileManager';
import { Wifi, RefreshCw, Plus, MapPin, Trash2, Edit2, AlertTriangle, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// No demo data — start empty for real cadastros
const DEFAULT_APS = [];

export default function APMonitor() {
  const [aps, setAPs] = useState(DEFAULT_APS);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedAP, setSelectedAP] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [editingAP, setEditingAP] = useState(null);
  const [view, setView] = useState('map'); // 'map' | 'list'
  const [pollError, setPollError] = useState(null);
  const [discovering, setDiscovering] = useState(false);

  const loadSaved = useCallback(async () => {
    try {
      setAPs(await spedynet.entities.AccessPoint.list('-updated_date'));
    } catch (error) {
      setPollError(error.message || 'Falha ao carregar Access Points');
    }
  }, []);

  const refreshMetrics = useCallback(async () => {
    setLoading(true);
    setPollError(null);
    try {
      const response = await spedynet.functions.invoke('accessPointPoll', {});
      setAPs(response.data?.access_points || []);
    } catch (err) {
      setPollError(err.message || 'Falha ao conectar aos equipamentos');
    }
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(refreshMetrics, 60000);
    return () => clearInterval(t);
  }, [autoRefresh, refreshMetrics]);

  const handleDiscover = async () => {
    setDiscovering(true);
    setPollError(null);
    try {
      const response = await spedynet.functions.invoke('accessPointDiscover', {});
      setAPs(response.data?.access_points || []);
      setLastRefresh(new Date());
      toast.success(`${response.data?.remote_caps || 0} AP(s) encontrado(s) via ${response.data?.type === 'wifi' ? 'WiFi CAPsMAN' : 'CAPsMAN legado'}.`);
    } catch (error) {
      setPollError(error.message || 'Falha ao descobrir APs no CAPsMAN');
      toast.error(error.message || 'Falha ao descobrir APs no CAPsMAN');
    } finally {
      setDiscovering(false);
    }
  };

  const handleRegister = async (formData) => {
    try {
      if (editingAP) {
        const updated = await spedynet.entities.AccessPoint.update(editingAP.id, { ...formData, custom_name: formData.name });
        setAPs(prev => prev.map(ap => ap.id === editingAP.id ? updated : ap));
        setEditingAP(null);
      } else {
        const created = await spedynet.entities.AccessPoint.create({
          ...formData,
          clients: 0,
          signalAvg: 0,
          noise: 0,
          utilization: 0,
          uptime: '--',
          status: 'offline',
          managed: false
        });
        setAPs(prev => [created, ...prev]);
      }
      setShowRegister(false);
      toast.success(editingAP ? 'Access Point atualizado.' : 'Access Point cadastrado.');
    } catch (error) {
      toast.error(error.message || 'Erro ao salvar Access Point');
    }
  };

  const handleDelete = async (ap) => {
    if (!window.confirm(`Excluir o Access Point ${ap.name}?`)) return;
    try {
      await spedynet.entities.AccessPoint.delete(ap.id);
      setAPs(prev => prev.filter(item => item.id !== ap.id));
      if (selectedAP?.id === ap.id) setSelectedAP(null);
      toast.success('Access Point excluido.');
    } catch (error) {
      toast.error(error.message || 'Erro ao excluir Access Point');
    }
  };

  const handleEdit = (ap) => {
    setEditingAP(ap);
    setShowRegister(true);
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
            {autoRefresh ? 'Auto 60s' : 'Pausado'}
          </button>
          <Button size="sm" variant="outline" onClick={handleDiscover} disabled={discovering} className="gap-1.5">
            <ScanSearch className={`w-3.5 h-3.5 ${discovering ? 'animate-pulse' : ''}`} />
            Descobrir CAPs
          </Button>
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
      {pollError && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-warning/30 bg-warning/10 text-warning text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-medium">Falha na coleta:</span>
          <span className="text-warning/80 truncate">{pollError}</span>
        </div>
      )}
      {!pollError && lastRefresh && aps.some(a => a.pollError) && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {aps.filter(a => a.pollError).length} AP(s) não encontrado(s) na última coleta CAPsMAN
        </div>
      )}

      {/* Stats bar */}
      <APStatsBar aps={aps} loading={loading} />

      <APProfileManager />

      {/* Alerts */}
      {(overloaded.length > 0 || interference.length > 0 || weakSignal.length > 0) && (
        <APAlertPanel overloaded={overloaded} interference={interference} weakSignal={weakSignal} aps={aps} />
      )}

      {/* Empty state */}
      {aps.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 bg-card border border-dashed border-border rounded-xl gap-4">
          <Wifi className="w-12 h-12 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">Nenhum AP cadastrado</p>
            <p className="text-xs text-muted-foreground mt-1">Descubra os equipamentos da controladora CAPsMAN ou cadastre um AP manual.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleDiscover} disabled={discovering} className="gap-1.5"><ScanSearch className="w-3.5 h-3.5" />Descobrir CAPs</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditingAP(null); setShowRegister(true); }} className="gap-1.5"><Plus className="w-3.5 h-3.5" />Cadastrar manualmente</Button>
          </div>
        </div>
      )}

      {/* Map view */}
      {aps.length > 0 && view === 'map' && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-3">
            <APHeatmapGrid aps={aps} loading={loading} selectedAP={selectedAP} onSelectAP={setSelectedAP} onEditAP={handleEdit} />
          </div>
          <div className="xl:col-span-2">
            <APChannelAnalyzer aps={aps} />
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
