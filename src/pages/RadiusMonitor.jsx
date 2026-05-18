import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import RadiusSessionsTable from '@/components/radius/RadiusSessionsTable';
import RadiusQuotaAlerts from '@/components/radius/RadiusQuotaAlerts';
import RadiusStatsBar from '@/components/radius/RadiusStatsBar';
import { RefreshCw, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Simulated RADIUS accounting sessions (in production these come from FreeRADIUS SQL)
function generateSessions(clients) {
  const plans = ['Trial 5M', 'Básico 10MB', 'Padrão 50MB', 'Premium 100MB'];
  const statuses = ['active', 'active', 'active', 'active', 'quota_exceeded', 'active', 'active', 'warning'];
  const base = clients.length > 0 ? clients.slice(0, 8) : [];

  const synthetic = [
    { id: 's1', username: 'joao.silva', fullName: 'João Silva', nasIp: '10.0.1.1', framedIp: '192.168.1.101', macAddress: '00:11:22:33:44:55', planName: 'Padrão 50MB', startTime: new Date(Date.now() - 8100000), downloadMb: 1842, uploadMb: 312, downloadRate: 24.5, uploadRate: 4.2, sessionTime: '2h 15m', status: 'active', quotaGb: 50 },
    { id: 's2', username: 'maria.santos', fullName: 'Maria Santos', nasIp: '10.0.1.1', framedIp: '192.168.1.102', macAddress: '00:11:22:33:44:56', planName: 'Premium 100MB', startTime: new Date(Date.now() - 2700000), downloadMb: 654, uploadMb: 98, downloadRate: 61.3, uploadRate: 12.8, sessionTime: '45m', status: 'active', quotaGb: 100 },
    { id: 's3', username: 'trial-a3f2', fullName: 'Trial-A3F2', nasIp: '10.0.1.2', framedIp: '192.168.1.150', macAddress: '00:11:22:33:44:57', planName: 'Trial 5M', startTime: new Date(Date.now() - 1080000), downloadMb: 142, uploadMb: 28, downloadRate: 4.8, uploadRate: 0.9, sessionTime: '18m', status: 'active', quotaGb: 0.5 },
    { id: 's4', username: 'carlos.lima', fullName: 'Carlos Lima', nasIp: '10.0.1.1', framedIp: '192.168.1.103', macAddress: '00:11:22:33:44:58', planName: 'Padrão 50MB', startTime: new Date(Date.now() - 18120000), downloadMb: 48200, uploadMb: 9140, downloadRate: 0.3, uploadRate: 0.1, sessionTime: '5h 02m', status: 'quota_exceeded', quotaGb: 50 },
    { id: 's5', username: 'ana.costa', fullName: 'Ana Costa', nasIp: '10.0.1.2', framedIp: '192.168.1.104', macAddress: '00:11:22:33:44:59', planName: 'Básico 10MB', startTime: new Date(Date.now() - 3600000), downloadMb: 3210, uploadMb: 581, downloadRate: 8.1, uploadRate: 1.4, sessionTime: '1h 00m', status: 'warning', quotaGb: 10 },
    { id: 's6', username: 'trial-b7c1', fullName: 'Trial-B7C1', nasIp: '10.0.1.2', framedIp: '192.168.1.151', macAddress: '00:11:22:33:44:60', planName: 'Trial 5M', startTime: new Date(Date.now() - 300000), downloadMb: 28, uploadMb: 5, downloadRate: 4.2, uploadRate: 0.7, sessionTime: '5m', status: 'active', quotaGb: 0.5 },
    { id: 's7', username: 'pedro.alves', fullName: 'Pedro Alves', nasIp: '10.0.1.1', framedIp: '192.168.1.105', macAddress: '00:11:22:33:44:61', planName: 'Premium 100MB', startTime: new Date(Date.now() - 5400000), downloadMb: 12480, uploadMb: 2340, downloadRate: 88.4, uploadRate: 21.6, sessionTime: '1h 30m', status: 'active', quotaGb: 100 },
    { id: 's8', username: 'lucia.ferr', fullName: 'Lúcia Ferreira', nasIp: '10.0.1.3', framedIp: '192.168.1.106', macAddress: '00:11:22:33:44:62', planName: 'Básico 10MB', startTime: new Date(Date.now() - 900000), downloadMb: 890, uploadMb: 142, downloadRate: 9.8, uploadRate: 1.6, sessionTime: '15m', status: 'active', quotaGb: 10 },
  ];

  return synthetic;
}

export default function RadiusMonitor() {
  const [sessions, setSessions] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [actionLog, setActionLog] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const cls = await base44.entities.Client.list('-created_date', 50).catch(() => []);
    setClients(cls);
    // Simulate slight real-time variation
    const sess = generateSessions(cls).map(s => ({
      ...s,
      downloadRate: parseFloat((s.downloadRate * (0.85 + Math.random() * 0.3)).toFixed(1)),
      uploadRate: parseFloat((s.uploadRate * (0.85 + Math.random() * 0.3)).toFixed(1)),
    }));
    setSessions(sess);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(loadData, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, loadData]);

  const handleDisconnect = async (session) => {
    setSessions(prev => prev.filter(s => s.id !== session.id));
    const entry = { time: new Date(), action: 'disconnect', user: session.username, detail: `Sessão encerrada via console — IP ${session.framedIp}`, status: 'success' };
    setActionLog(prev => [entry, ...prev].slice(0, 20));
    await base44.entities.AuditLog.create({ action: 'radius_disconnect', entity_type: 'radius', entity_name: session.username, status: 'success', message: `Sessão RADIUS desconectada: ${session.username} (${session.framedIp})`, details: JSON.stringify({ nas: session.nasIp, mac: session.macAddress }) }).catch(() => {});
  };

  const handleApplyProfile = async (session, profile) => {
    setSessions(prev => prev.map(s => s.id === session.id ? { ...s, planName: profile.label, downloadRate: profile.downloadRate, uploadRate: profile.uploadRate, status: profile.status || s.status } : s));
    const entry = { time: new Date(), action: 'profile', user: session.username, detail: `Perfil "${profile.label}" aplicado — ${profile.downloadRate}/${profile.uploadRate} Mbps`, status: 'info' };
    setActionLog(prev => [entry, ...prev].slice(0, 20));
    await base44.entities.AuditLog.create({ action: 'radius_profile_change', entity_type: 'radius', entity_name: session.username, status: 'success', message: `Perfil de emergência aplicado: ${profile.label} → ${session.username}`, details: JSON.stringify({ profile: profile.label, framedIp: session.framedIp }) }).catch(() => {});
  };

  const handleUnblock = async (session) => {
    setSessions(prev => prev.map(s => s.id === session.id ? { ...s, status: 'active', downloadRate: 2.0, uploadRate: 0.5 } : s));
    const entry = { time: new Date(), action: 'unblock', user: session.username, detail: `Quota resetada — acesso restaurado`, status: 'success' };
    setActionLog(prev => [entry, ...prev].slice(0, 20));
    await base44.entities.AuditLog.create({ action: 'radius_quota_reset', entity_type: 'radius', entity_name: session.username, status: 'success', message: `Quota resetada para ${session.username}` }).catch(() => {});
  };

  const quotaBlocked = sessions.filter(s => s.status === 'quota_exceeded');
  const quotaWarning = sessions.filter(s => s.status === 'warning');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" />
            Monitoramento RADIUS
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            Última atualização: {lastRefresh.toLocaleTimeString('pt-BR')} · {sessions.length} sessões ativas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${autoRefresh ? 'bg-success/10 border-success/30 text-success' : 'bg-secondary border-border text-muted-foreground'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
            {autoRefresh ? 'Auto 15s' : 'Pausado'}
          </button>
          <Button size="sm" variant="outline" onClick={loadData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <RadiusStatsBar sessions={sessions} loading={loading} />

      {/* Quota alerts */}
      {(quotaBlocked.length > 0 || quotaWarning.length > 0) && (
        <RadiusQuotaAlerts
          blocked={quotaBlocked}
          warning={quotaWarning}
          onUnblock={handleUnblock}
          onDisconnect={handleDisconnect}
        />
      )}

      {/* Sessions table */}
      <RadiusSessionsTable
        sessions={sessions}
        loading={loading}
        onDisconnect={handleDisconnect}
        onApplyProfile={handleApplyProfile}
        onUnblock={handleUnblock}
      />

      {/* Action Log */}
      {actionLog.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Log de Ações da Sessão</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
            {actionLog.map((entry, i) => {
              const colorMap = { success: 'text-success', info: 'text-info', error: 'text-destructive' };
              return (
                <div key={i} className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-secondary/40">
                  <span className="font-mono text-muted-foreground flex-shrink-0">{entry.time.toLocaleTimeString('pt-BR')}</span>
                  <span className={`font-semibold flex-shrink-0 uppercase text-[10px] ${colorMap[entry.status]}`}>{entry.action}</span>
                  <span className="font-mono text-primary flex-shrink-0">{entry.user}</span>
                  <span className="text-muted-foreground truncate">{entry.detail}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}