import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import RadiusSessionsTable from '@/components/radius/RadiusSessionsTable';
import RadiusQuotaAlerts from '@/components/radius/RadiusQuotaAlerts';
import RadiusStatsBar from '@/components/radius/RadiusStatsBar';
import { RefreshCw, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
    
    // In production these will come from FreeRADIUS SQL or API
    // For now we set it to empty so test data is cleared
    const sess = [];
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