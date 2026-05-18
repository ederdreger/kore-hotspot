import { Wifi, AlertTriangle, Radio, Users, Signal, Activity } from 'lucide-react';

function Pill({ icon: Icon, label, value, color }) {
  const cls = {
    primary:     'bg-primary/10 border-primary/20 text-primary',
    success:     'bg-success/10 border-success/20 text-success',
    warning:     'bg-warning/10 border-warning/20 text-warning',
    destructive: 'bg-destructive/10 border-destructive/20 text-destructive',
    info:        'bg-info/10 border-info/20 text-info',
  };
  return (
    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border ${cls[color]}`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
        <p className="text-lg font-bold font-mono leading-none">{value}</p>
      </div>
    </div>
  );
}

export default function APStatsBar({ aps, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-secondary/50 animate-pulse" />
        ))}
      </div>
    );
  }

  const online = aps.filter(a => a.status !== 'offline').length;
  const overloaded = aps.filter(a => a.status === 'overloaded').length;
  const interference = aps.filter(a => a.status === 'interference').length;
  const totalClients = aps.reduce((s, a) => s + a.clients, 0);
  const avgUtil = aps.length ? Math.round(aps.reduce((s, a) => s + a.utilization, 0) / aps.length) : 0;
  const avgSignal = aps.length ? Math.round(aps.reduce((s, a) => s + a.signalAvg, 0) / aps.length) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Pill icon={Wifi}          label="APs Online"       value={online}              color="success" />
      <Pill icon={AlertTriangle} label="Sobrecarregados"  value={overloaded}          color="destructive" />
      <Pill icon={Radio}         label="Interferência"    value={interference}        color="warning" />
      <Pill icon={Users}         label="Clientes Totais"  value={totalClients}        color="primary" />
      <Pill icon={Activity}      label="Util. Média"      value={`${avgUtil}%`}       color="info" />
      <Pill icon={Signal}        label="Sinal Médio"      value={`${avgSignal} dBm`}  color={avgSignal > -70 ? 'success' : 'warning'} />
    </div>
  );
}