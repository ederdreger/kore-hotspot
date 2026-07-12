import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Zap } from 'lucide-react';

const COLORS = ['#00E5FF', '#00FF88', '#A855F7', '#FFB800', '#FF4444'];

export default function BandwidthByPlanChart({ plans, sessions = [] }) {
  const data = plans.slice(0, 5).map((plan, index) => {
    const current = sessions.filter(session => session.plan === plan.name || session.planName === plan.name);
    const consumption = current.reduce((total, session) => (
      total + Number(session.downloadRate || 0) + Number(session.uploadRate || 0)
    ), 0);
    const limit = Number(plan.download_mbps ?? plan.speed_download ?? 0) + Number(plan.upload_mbps ?? plan.speed_upload ?? 0);
    return {
      name: plan.name,
      consumption: Number(consumption.toFixed(2)),
      capacity: Number((limit * current.length).toFixed(2)),
      clients: current.length,
      color: COLORS[index % COLORS.length]
    };
  }).filter(plan => plan.clients > 0);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Consumo de Banda por Plano</h3>
          <p className="text-xs text-muted-foreground">Somente sessões confirmadas no MikroTik</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary border border-border">
          <Zap className="w-3 h-3 text-warning" />
          <span className="text-xs font-mono text-muted-foreground">ao vivo</span>
        </div>
      </div>

      {data.length ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 18%)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit=" M" />
            <Tooltip formatter={(value, name) => [`${Number(value).toFixed(2)} Mbps`, name === 'capacity' ? 'Capacidade' : 'Consumo']} />
            <Bar dataKey="capacity" name="Capacidade" fill="hsl(220 18% 22%)" radius={[3, 3, 0, 0]} maxBarSize={32} />
            <Bar dataKey="consumption" name="Consumo" radius={[3, 3, 0, 0]} maxBarSize={32}>
              {data.map((entry) => <Cell key={entry.name} fill={entry.color} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
          Nenhuma sessão online com plano identificado
        </div>
      )}
    </div>
  );
}
