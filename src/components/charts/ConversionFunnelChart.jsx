import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';
import { TrendingUp } from 'lucide-react';

const TOOLTIP_STYLE = {
  background: 'hsl(220 24% 11%)',
  border: '1px solid hsl(220 18% 18%)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'hsl(210 40% 96%)',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const prospects = payload.find(p => p.dataKey === 'prospects')?.value || 0;
  const clients = payload.find(p => p.dataKey === 'clients')?.value || 0;
  const rate = prospects > 0 ? ((clients / prospects) * 100).toFixed(1) : 0;
  return (
    <div style={TOOLTIP_STYLE} className="p-3 min-w-[140px]">
      <p className="font-semibold mb-2 text-foreground">{label}</p>
      <p className="text-info">Prospectos: <span className="font-mono font-bold">{prospects}</span></p>
      <p className="text-success">Clientes: <span className="font-mono font-bold">{clients}</span></p>
      <div className="mt-2 pt-2 border-t border-border">
        <p className="text-primary">Taxa: <span className="font-mono font-bold">{rate}%</span></p>
      </div>
    </div>
  );
};

export default function ConversionFunnelChart({ prospects, clients }) {
  // Build monthly data from last 6 months
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      label: d.toLocaleDateString('pt-BR', { month: 'short' }),
      year: d.getFullYear(),
      month: d.getMonth(),
    };
  });

  const data = months.map(m => {
    const monthProspects = prospects.filter(p => {
      const d = new Date(p.created_date);
      return d.getFullYear() === m.year && d.getMonth() === m.month;
    }).length;

    const monthClients = clients.filter(c => {
      const d = new Date(c.created_date);
      return d.getFullYear() === m.year && d.getMonth() === m.month && c.source === 'captive_portal';
    }).length;

    const rate = monthProspects > 0 ? parseFloat(((monthClients / monthProspects) * 100).toFixed(1)) : 0;

    return { month: m.label, prospects: monthProspects, clients: monthClients, rate };
  });

  const chartData = data;

  const totalProspects = chartData.reduce((a, d) => a + d.prospects, 0);
  const totalClients = chartData.reduce((a, d) => a + d.clients, 0);
  const avgRate = totalProspects > 0 ? ((totalClients / totalProspects) * 100).toFixed(1) : 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Taxa de Conversão</h3>
          <p className="text-xs text-muted-foreground">Prospectos → Clientes (últimos 6 meses)</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20">
          <TrendingUp className="w-3 h-3 text-primary" />
          <span className="text-xs font-bold font-mono text-primary">{avgRate}% média</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} barGap={4}>
          <defs>
            <linearGradient id="prospectsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.9} />
              <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0.5} />
            </linearGradient>
            <linearGradient id="clientsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.9} />
              <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0.5} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 18%)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'hsl(187 100% 50%)' }} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
          <Tooltip content={<CustomTooltip />} />
          <Bar yAxisId="left" dataKey="prospects" fill="url(#prospectsGrad)" radius={[4, 4, 0, 0]} maxBarSize={28} name="Prospectos" />
          <Bar yAxisId="left" dataKey="clients" fill="url(#clientsGrad)" radius={[4, 4, 0, 0]} maxBarSize={28} name="Convertidos" />
          <Line yAxisId="right" type="monotone" dataKey="rate" stroke="hsl(187 100% 50%)" strokeWidth={2} dot={{ fill: 'hsl(187 100% 50%)', r: 3, strokeWidth: 0 }} name="Taxa %" />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex items-center justify-center gap-5 mt-2 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-info" />Prospectos</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-success" />Convertidos</span>
        <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 inline-block bg-primary" />Taxa %</span>
      </div>
    </div>
  );
}
