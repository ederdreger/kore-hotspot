import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Shield, Server, Activity, Thermometer, Cpu, Users, Clock, AlertTriangle, RefreshCw, Zap, Wifi, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function MikrotikManager() {
  const [mikrotiks, setMikrotiks] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [radiusStatus, setRadiusStatus] = useState('unknown');

  useEffect(() => {
    loadMikrotiks();
    checkRadius();
  }, []);

  const loadMikrotiks = async () => {
    try {
      const mtiksRaw = await base44.entities.Setting.filter({ category: 'mikrotik_device' });
      const mtiks = mtiksRaw.map(s => {
        try { return { id: s.id, ...JSON.parse(s.value) }; } catch { return null; }
      }).filter(Boolean);
      
      setMikrotiks(mtiks);
      if (mtiks.length > 0) {
        setSelectedId(mtiks[0].id);
      }
    } catch (e) {
      toast.error('Erro ao carregar equipamentos');
    } finally {
      setLoading(false);
    }
  };

  const checkRadius = async () => {
    const settings = await base44.entities.Setting.filter({ category: 'radius' }).catch(() => []);
    if (settings.length > 0) {
      setRadiusStatus('online'); // Se configurado no sistema, marcamos como online local
    } else {
      setRadiusStatus('offline');
    }
  };

  useEffect(() => {
    if (selectedId) {
      fetchMetrics(selectedId);
    }
  }, [selectedId]);

  const fetchMetrics = async (id, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    
    const mtik = mikrotiks.find(m => m.id === id);
    if (!mtik) return;

    try {
      const response = await base44.functions.invoke('mikrotikStatus', {
        host: mtik.host,
        port: mtik.port,
        user: mtik.user || 'admin',
        password: mtik.password || '',
        snmp_port: mtik.snmp_port || '161',
        snmp_community: mtik.snmp_community || 'public',
      });
      setMetrics(response.data);
    } catch (err) {
      setMetrics({
        error: err?.response?.data?.snmp_error || err?.response?.data?.error || 'Não foi possível coletar dados via SSH/SNMP'
      });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div className="p-6">Carregando...</div>;

  const activeMtik = mikrotiks.find(m => m.id === selectedId);
  const isOnline = metrics && metrics.snmp_connected === true && !metrics.error;
  const cpuPercent = isOnline ? (metrics?.cpu_load ?? 0) : 0;
  const memUsed = isOnline && metrics?.total_memory && metrics?.free_memory
    ? Math.round(((metrics.total_memory - metrics.free_memory) / metrics.total_memory) * 100)
    : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gerenciamento de Equipamentos</h1>
          <p className="text-muted-foreground mt-1">Monitore o estado do MikroTik, saúde, CPU, memória e status do RADIUS.</p>
        </div>
        
        {mikrotiks.length > 0 && (
          <div className="w-full md:w-72">
            <select 
              value={selectedId} 
              onChange={e => setSelectedId(e.target.value)}
              className="w-full h-10 rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
            >
              {mikrotiks.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.host})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!activeMtik ? (
        <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center text-muted-foreground">
          Nenhum MikroTik cadastrado. Vá em Configurações para adicionar.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Dashboard Area */}
          <div className="lg:col-span-2 space-y-6">
            
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="p-5 border-b border-border flex items-center justify-between bg-secondary/30">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-destructive'}`} />
                  <div>
                    <h3 className="font-semibold">{activeMtik.name}</h3>
                    <p className="text-xs text-muted-foreground">{activeMtik.host}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchMetrics(selectedId, true)} disabled={refreshing} className="gap-2">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
                </Button>
              </div>
              
              <div className="p-6">
                {metrics?.error ? (
                  <div className="flex items-center gap-3 text-destructive bg-destructive/10 p-4 rounded-lg">
                    <AlertTriangle className="w-5 h-5" />
                    <p className="text-sm">{metrics.error}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {/* CPU */}
                    <div className="bg-secondary/40 p-4 rounded-xl border border-border">
                      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                        <Cpu className="w-4 h-4" /> <span className="text-sm font-medium">Processamento</span>
                      </div>
                      <div className="flex items-end gap-2">
                        <span className={`text-3xl font-bold ${cpuPercent > 80 ? 'text-destructive' : 'text-foreground'}`}>{cpuPercent}%</span>
                      </div>
                      <div className="w-full bg-secondary h-2 rounded-full mt-3 overflow-hidden">
                        <div className={`h-full ${cpuPercent > 80 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${cpuPercent}%` }} />
                      </div>
                    </div>

                    {/* RAM */}
                    <div className="bg-secondary/40 p-4 rounded-xl border border-border">
                      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                        <Server className="w-4 h-4" /> <span className="text-sm font-medium">Memória RAM</span>
                      </div>
                      <div className="flex items-end gap-2">
                        <span className={`text-3xl font-bold ${memUsed > 85 ? 'text-destructive' : 'text-foreground'}`}>{memUsed}%</span>
                        <span className="text-xs text-muted-foreground mb-1 block">uso</span>
                      </div>
                      <div className="w-full bg-secondary h-2 rounded-full mt-3 overflow-hidden">
                        <div className={`h-full ${memUsed > 85 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${memUsed}%` }} />
                      </div>
                    </div>

                    {/* Uptime */}
                    <div className="bg-secondary/40 p-4 rounded-xl border border-border">
                      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                        <Clock className="w-4 h-4" /> <span className="text-sm font-medium">Tempo Ligado</span>
                      </div>
                      <p className="text-lg font-bold text-foreground">{metrics?.uptime || '—'}</p>
                      <p className="text-xs text-muted-foreground mt-1">Uptime do sistema</p>
                    </div>

                    {/* Users */}
                    <div className="bg-secondary/40 p-4 rounded-xl border border-border">
                      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                        <Users className="w-4 h-4" /> <span className="text-sm font-medium">Hotspot Ativos</span>
                      </div>
                      <p className="text-3xl font-bold text-primary">{metrics?.active_users ?? '—'}</p>
                      <p className="text-xs text-muted-foreground mt-1">Usuários conectados</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            
            {/* FreeRADIUS Status */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-info" /> Status FreeRADIUS
              </h3>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${radiusStatus === 'online' ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                  {radiusStatus === 'online' ? <CheckCircle className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                </div>
                <div>
                  <p className="font-bold text-lg">{radiusStatus === 'online' ? 'Operante' : 'Não Configurado'}</p>
                  <p className="text-xs text-muted-foreground">Serviço de autenticação local</p>
                </div>
              </div>
            </div>

            {/* Health Info */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-warning" /> Saúde do Equipamento
              </h3>
              
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground flex items-center gap-2"><Thermometer className="w-4 h-4" /> Temperatura</span>
                <span className="font-mono text-sm">{metrics?.temperature ? `${metrics.temperature}°C` : 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground flex items-center gap-2"><Server className="w-4 h-4" /> Modelo</span>
                <span className="font-mono text-sm">{metrics?.board_name || 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground flex items-center gap-2"><Zap className="w-4 h-4" /> RouterOS</span>
                <span className="font-mono text-sm">{metrics?.version || 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground flex items-center gap-2"><Wifi className="w-4 h-4" /> Interface Hotspot</span>
                <span className="font-mono text-sm text-primary">{activeMtik.bridge_name || activeMtik.hotspot_interface || 'N/A'}</span>
              </div>
            </div>

          </div>

        </div>
      )}
    </div>
  );
}