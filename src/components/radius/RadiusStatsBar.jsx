import { Wifi, AlertTriangle, Ban, TrendingDown, TrendingUp, Activity } from 'lucide-react';

function StatPill({ icon: Icon, label, value, color }) {
  const colorMap = {
    primary: 'bg-primary/10 border-primary/20 text-primary',
    success: 'bg-success/10 border-success/20 text-success',
    warning: 'bg-warning/10 border-warning/20 text-warning',
    destructive: 'bg-destructive/10 border-destructive/20 text-destructive',
    info: 'bg-info/10 border-info/20 text-info',
  };
  return (
    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border ${colorMap[color]}`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
        <p className="text-lg font-bold font-mono leading-none">{value}</p>
      </div>
    </div>
  );
}

export default function RadiusStatsBar({ sessions, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-secondary/50 animate-pulse" />
        ))}
      </div>
    );
  }

  const active = sessions.filter(s => s.status === 'active').length;
  const blocked = sessions.filter(s => s.status === 'quota_exceeded').length;
  const warning = sessions.filter(s => s.status === 'warning').length;
  const totalDl = sessions.reduce((a, s) => a + s.downloadRate, 0).toFixed(1);
  const totalUl = sessions.reduce((a, s) => a + s.uploadRate, 0).toFixed(1);
  const totalDataMb = sessions.reduce((a, s) => a + s.downloadMb + s.uploadMb, 0);
  const totalDataLabel = totalDataMb > 1024 ? `${(totalDataMb / 1024).toFixed(1)} GB` : `${totalDataMb} MB`;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatPill icon={Wifi} label="Sessões Ativas" value={active} color="success" />
      <StatPill icon={Ban} label="Bloqueados" value={blocked} color="destructive" />
      <StatPill icon={AlertTriangle} label="Alerta Quota" value={warning} color="warning" />
      <StatPill icon={TrendingDown} label="Download Total" value={`${totalDl}M`} color="primary" />
      <StatPill icon={TrendingUp} label="Upload Total" value={`${totalUl}M`} color="info" />
      <StatPill icon={Activity} label="Dados Sessão" value={totalDataLabel} color="primary" />
    </div>
  );
}