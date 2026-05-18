import { AlertTriangle, Ban, Unlock, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RadiusQuotaAlerts({ blocked, warning, onUnblock, onDisconnect }) {
  return (
    <div className="space-y-2">
      {blocked.map(session => (
        <div key={session.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-destructive/5 border border-destructive/30">
          <Ban className="w-4 h-4 text-destructive flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-destructive">
              Quota excedida — <span className="font-mono">{session.username}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {session.framedIp} · {session.planName} · {(session.downloadMb / 1024).toFixed(1)} GB consumidos de {session.quotaGb} GB
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={() => onUnblock(session)} className="gap-1.5 text-xs border-success/30 text-success hover:bg-success/10">
              <Unlock className="w-3 h-3" />
              Resetar Quota
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDisconnect(session)} className="gap-1.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/10">
              <LogOut className="w-3 h-3" />
              Desconectar
            </Button>
          </div>
        </div>
      ))}
      {warning.map(session => (
        <div key={session.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warning/5 border border-warning/30">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-warning">
              Quota em alerta — <span className="font-mono">{session.username}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {session.framedIp} · {session.planName} · {(session.downloadMb / 1024).toFixed(1)} GB de {session.quotaGb} GB ({Math.round((session.downloadMb / 1024 / session.quotaGb) * 100)}% usado)
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onDisconnect(session)} className="gap-1.5 text-xs border-warning/30 text-warning hover:bg-warning/10 flex-shrink-0">
            <LogOut className="w-3 h-3" />
            Desconectar
          </Button>
        </div>
      ))}
    </div>
  );
}