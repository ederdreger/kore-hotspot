import { AlertTriangle, Users, Radio, Signal, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function APAlertPanel({ overloaded, interference, weakSignal, aps, onChangeChannel }) {
  const allAlerts = [
    ...overloaded.map(ap => ({ ap, type: 'overloaded', icon: Users, color: 'destructive',
      title: `${ap.name} sobrecarregado`,
      detail: `${ap.clients}/${ap.maxClients} clientes · ${ap.utilization}% utilização`,
      action: null })),
    ...interference.map(ap => {
      const sameChannel = aps.filter(a => a.id !== ap.id && a.channel === ap.channel && a.band === ap.band);
      return { ap, type: 'interference', icon: Radio, color: 'warning',
        title: `Interferência em ${ap.name}`,
        detail: `Canal ${ap.channel} compartilhado com ${sameChannel.map(a => a.name).join(', ')}`,
        action: null };
    }),
    ...weakSignal.map(ap => ({ ap, type: 'weak_signal', icon: Signal, color: 'info',
      title: `Sinal fraco em ${ap.name}`,
      detail: `Média ${ap.signalAvg} dBm · ruído ${ap.noise} dBm`,
      action: null })),
  ];

  const colorCls = {
    destructive: { border: 'border-destructive/30', bg: 'bg-destructive/5', icon: 'text-destructive', badge: 'bg-destructive/10 text-destructive border-destructive/20' },
    warning:     { border: 'border-warning/30',     bg: 'bg-warning/5',     icon: 'text-warning',     badge: 'bg-warning/10 text-warning border-warning/20' },
    info:        { border: 'border-info/30',         bg: 'bg-info/5',         icon: 'text-info',         badge: 'bg-info/10 text-info border-info/20' },
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {allAlerts.map((alert, i) => {
        const cls = colorCls[alert.color];
        const Icon = alert.icon;
        return (
          <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${cls.border} ${cls.bg}`}>
            <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cls.icon}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${cls.icon}`}>{alert.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{alert.detail}</p>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${cls.badge}`}>
              {alert.type === 'overloaded' ? 'Carga' : alert.type === 'interference' ? 'Canal' : 'Sinal'}
            </span>
          </div>
        );
      })}
    </div>
  );
}