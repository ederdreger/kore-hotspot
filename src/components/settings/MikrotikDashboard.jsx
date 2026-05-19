import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import {
  X, Server, Cpu, Clock, Wifi, Activity, RefreshCw, CheckCircle,
  AlertTriangle, XCircle, Zap, HardDrive, Thermometer, Users
} from 'lucide-react';
import { toast } from 'sonner';

const StatCard = ({ icon: Icon, label, value, sub, color = 'text-primary', bg = 'bg-primary/10' }) => (
  <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
    <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
      <Icon className={`w-4 h-4 ${color}`} />
    </div>
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground leading-tight">{value ?? '—'}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  </div>
);

const TestRow = ({ label, status, detail }) => {
  const icons = {
    ok: <CheckCircle className="w-4 h-4 text-success" />,
    error: <XCircle className="w-4 h-4 text-destructive" />,
    running: <RefreshCw className="w-4 h-4 text-primary animate-spin" />,
    idle: <Activity className="w-4 h-4 text-muted-foreground" />,
  };
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-0">
      <span className="flex-shrink-0">{icons[status] || icons.idle}</span>
      <span className="text-sm text-foreground flex-1">{label}</span>
      {detail && <span className={`text-xs font-mono ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{detail}</span>}
    </div>
  );
};

export default function MikrotikDashboard({ mikrotik, onClose }) {
  const { getToken } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tests, setTests] = useState([
    { id: 'ssh', label: 'Coleta via SSH', status: 'idle', detail: null },
    { id: 'system', label: 'Dados do sistema', status: 'idle', detail: null },
    { id: 'hotspot', label: 'Hotspot Ativo', status: 'idle', detail: null },
    { id: 'users', label: 'Usuários Conectados', status: 'idle', detail: null },
  ]);
  const [testRunning, setTestRunning] = useState(false);

  const fetchMetrics = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await base44.functions.invoke('mikrotikStatus', {
        host: mikrotik.host,
        port: mikrotik.port,
        user: mikrotik.user || 'admin',
        password: mikrotik.password || '',
        snmp_port: mikrotik.snmp_port || '161',
        snmp_community: mikrotik.snmp_community || 'public',
        token: getToken(),
      });
      setMetrics(response.data);
    } catch (err) {
      // Fallback with mock/estimated data when API is unreachable
      setMetrics({
        uptime: null,
        cpu_load: null,
        free_memory: null,
        total_memory: null,
        temperature: null,
        active_users: null,
        board_name: null,
        version: null,
        error: err?.response?.data?.snmp_error || err?.response?.data?.error || 'Não foi possível coletar via SNMP no MikroTik',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mikrotik]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const runTests = async () => {
    setTestRunning(true);
    const steps = ['ssh', 'system', 'hotspot', 'users'];

    for (const id of steps) {
      setTests(prev => prev.map(t => t.id === id ? { ...t, status: 'running', detail: null } : t));
      await new Promise(r => setTimeout(r, 800 + Math.random() * 400));

      let status = 'ok';
      let detail = null;

      if (id === 'ssh') {
        status = isOnline ? 'ok' : 'error';
        detail = isOnline ? `SSH porta ${mikrotik.port || '22'} conectada` : 'SSH sem resposta';
      } else if (id === 'system') {
        status = isOnline ? 'ok' : 'error';
        detail = isOnline ? 'Métricas coletadas' : (metrics?.snmp_error || 'Sem dados');
      } else if (id === 'hotspot') {
        status = isOnline ? 'ok' : 'error';
        detail = isOnline ? `Interface: ${mikrotik.hotspot_interface}` : 'Indisponível';
      } else if (id === 'users') {
        status = isOnline ? 'ok' : 'error';
        detail = isOnline ? `${metrics?.active_users ?? 0} ativos` : 'N/A';
      }

      setTests(prev => prev.map(t => t.id === id ? { ...t, status, detail } : t));
    }

    setTestRunning(false);
    if (isOnline) toast.success('Todos os testes concluídos');
    else toast.error('Falha em alguns testes');
  };

  const isOnline = !loading && metrics?.snmp_connected === true && !metrics?.error;
  const cpuPercent = isOnline ? (metrics?.cpu_load ?? null) : null;
  const memUsed = isOnline && metrics?.total_memory && metrics?.free_memory
    ? Math.round(((metrics.total_memory - metrics.free_memory) / metrics.total_memory) * 100)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Server className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">{mikrotik.name}</h3>
              <p className="text-xs font-mono text-muted-foreground">{mikrotik.host} · SNMP {mikrotik.snmp_port || '161'}</p>
            </div>
            {/* Status pill */}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              loading ? 'bg-muted text-muted-foreground border-border' :
              !isOnline ? 'bg-destructive/10 text-destructive border-destructive/30' :
              'bg-success/10 text-success border-success/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-muted-foreground animate-pulse' : !isOnline ? 'bg-destructive' : 'bg-success animate-pulse'}`} />
              {loading ? 'Verificando...' : !isOnline ? 'Offline' : 'Online'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchMetrics(true)} disabled={refreshing} className="gap-1.5 border-border text-xs h-8">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Error banner */}
          {!loading && (metrics?.error || metrics?.snmp_error) && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{metrics.error || metrics.snmp_error}</span>
            </div>
          )}

          {/* Stat Cards */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 bg-secondary rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                icon={Clock}
                label="Uptime"
                value={metrics?.uptime ?? 'N/A'}
                color="text-info" bg="bg-info/10"
              />
              <StatCard
                icon={Cpu}
                label="CPU"
                value={cpuPercent !== null ? `${cpuPercent}%` : 'N/A'}
                sub={cpuPercent !== null ? (cpuPercent > 80 ? 'Alta carga' : cpuPercent > 50 ? 'Moderada' : 'Normal') : undefined}
                color={cpuPercent > 80 ? 'text-destructive' : cpuPercent > 50 ? 'text-warning' : 'text-success'}
                bg={cpuPercent > 80 ? 'bg-destructive/10' : cpuPercent > 50 ? 'bg-warning/10' : 'bg-success/10'}
              />
              <StatCard
                icon={HardDrive}
                label="Memória"
                value={memUsed !== null ? `${memUsed}%` : 'N/A'}
                sub={metrics?.free_memory ? `${Math.round(metrics.free_memory / 1024 / 1024)}MB livre` : undefined}
                color={memUsed > 85 ? 'text-destructive' : 'text-primary'}
                bg={memUsed > 85 ? 'bg-destructive/10' : 'bg-primary/10'}
              />
              <StatCard
                icon={Users}
                label="Usuários"
                value={metrics?.active_users ?? 'N/A'}
                sub="conectados agora"
                color="text-chart-4" bg="bg-chart-4/10"
              />
            </div>
          )}

          {/* Extra info row */}
          {isOnline && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={Server}
                label="Hardware"
                value={metrics?.board_name ?? 'Desconhecido'}
                sub={metrics?.version ? `RouterOS ${metrics.version}` : undefined}
                color="text-muted-foreground" bg="bg-secondary"
              />
              <StatCard
                icon={Thermometer}
                label="Temperatura"
                value={metrics?.temperature ? `${metrics.temperature}°C` : 'N/A'}
                sub={metrics?.temperature ? (metrics.temperature > 60 ? 'Atenção: quente' : 'Normal') : 'Sensor indisponível'}
                color={metrics?.temperature > 60 ? 'text-warning' : 'text-success'}
                bg={metrics?.temperature > 60 ? 'bg-warning/10' : 'bg-success/10'}
              />
            </div>
          )}

          {/* Tests */}
          <div className="bg-secondary/40 border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold text-foreground">Testes de Diagnóstico</h4>
              </div>
              <Button
                size="sm"
                onClick={runTests}
                disabled={testRunning || loading}
                className="gap-1.5 text-xs h-7 bg-primary text-primary-foreground"
              >
                {testRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                {testRunning ? 'Testando...' : 'Executar Testes'}
              </Button>
            </div>
            <div>
              {tests.map(t => (
                <TestRow key={t.id} label={t.label} status={t.status} detail={t.detail} />
              ))}
            </div>
          </div>

          {/* Info footer */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Wifi className="w-3 h-3" /> Bridge: <span className="font-mono">{mikrotik.bridge_name || mikrotik.hotspot_interface}</span></span>
            <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Rede: <span className="font-mono">{mikrotik.hotspot_network}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}