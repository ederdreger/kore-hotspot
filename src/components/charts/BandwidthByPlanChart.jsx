import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend
} from 'recharts';
import { Zap } from 'lucide-react';

const COLORS = ['#00E5FF', '#00FF88', '#A855F7', '#FFB800', '#FF4444'];

const TOOLTIP_STYLE = {
  background: 'hsl(220 24% 11%)',
  border: '1px solid hsl(220 18% 18%)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'hsl(210 40% 96%)',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE} className="p-3 min-w-[160px]">
      <p className="font-semibold mb-2 text-foreground">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-mono font-bold">{p.value} Mbps</span>
        </p>
      ))}
    </div>
  );
};

export default function BandwidthByPlanChart({ plans, clients }) {
  // Build per-plan bandwidth consumption data
  const hourlySlots = ['00h', '03h', '06h', '09h', '12h', '15h', '18h', '21h'];

  // Plan capacity breakdown
  const planCapacity = plans.slice(0, 5).map((p, i) => {
    const clientCount = clients.filter(c => c.plan_name === p.name).length;
    const avgUtil = 0.4 + Math.random() * 0.45; // simulated 40-85% utilization
    return {
      name: p.name.replace('Básico ', '').replace('Padrão ', '').replace('Premium ', ''),
      fullName: p.name,
      download: p.download_mbps,
      upload: p.upload_mbps,
      consumoAtual: parseFloat((p.download_mbps * clientCount * avgUtil).toFixed(1)),
      capacidade: p.download_mbps * Math.max(clientCount, 1),
      usuarios: clientCount,
      color: COLORS[i % COLORS.length],
    };
  });

  // Fallback demo data
  const hasPlans = planCapacity.length > 0;
  const barData = hasPlans ? planCapacity : [
    { name: '10MB', fullName: 'Básico 10MB', download: 10, upload: 5, consumoAtual: 28.4, capacidade: 50, usuarios: 5, color: '#00E5FF' },
    { name: '50MB', fullName: 'Padrão 50MB', download: 50, upload: 25, consumoAtual: 186.5, capacidade: 400, usuarios: 8, color: '#00FF88' },
    { name: '100MB', fullName: 'Premium 100MB', download: 100, upload: 50, consumoAtual: 420.2, capacidade: 600, usuarios: 6, color: '#A855F7' },
    { name: 'Trial', fullName: 'Trial 30min', download: 5, upload: 2, consumoAtual: 15.3, capacidade: 25, usuarios: 5, color: '#FFB800' },
  ];

  // Hourly heatmap-style area data per top plan
  const hourlyData = hourlySlots.map((slot, hi) => {
    const row = { slot };
    barData.slice(0, 3).forEach(p => {
      const peak = hi >= 3 && hi <= 6; // 09h-21h peak
      const factor = peak ? 0.6 + Math.random() * 0.4 : 0.1 + Math.random() * 0.35;
      row[p.name] = parseFloat((p.consumoAtual * factor).toFixed(1));
    });
    return row;
  });

  const topPlans = barData.slice(0, 3);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Consumo de Banda por Plano</h3>
          <p className="text-xs text-muted-foreground">Capacidade vs consumo atual (Mbps)</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary border border-border">
          <Zap className="w-3 h-3 text-warning" />
          <span className="text-xs font-mono text-muted-foreground">ao vivo</span>
        </div>
      </div>

      {/* Capacity vs Consumption bars */}
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={barData} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 18%)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} unit=" M" />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="capacidade" name="Capacidade" fill="hsl(220 18% 22%)" radius={[3, 3, 0, 0]} maxBarSize={32} />
          <Bar dataKey="consumoAtual" name="Consumo" radius={[3, 3, 0, 0]} maxBarSize={32}>
            {barData.map((entry, i) => (
              <Cell key={i} fill={entry.color} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Hourly consumption heatmap */}
      <div className="mt-4">
        <p className="text-xs text-muted-foreground mb-2 font-medium">Consumo por hora (top 3 planos)</p>
        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            {topPlans.map((plan, pi) => (
              <div key={pi} className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono w-14 flex-shrink-0 truncate" style={{ color: plan.color }}>{plan.name}</span>
                <div className="flex gap-0.5 flex-1">
                  {hourlySlots.map((slot, hi) => {
                    const val = hourlyData[hi][plan.name] || 0;
                    const max = Math.max(...hourlyData.map(d => d[plan.name] || 0));
                    const intensity = max > 0 ? val / max : 0;
                    return (
                      <div
                        key={hi}
                        className="flex-1 h-6 rounded-sm relative group cursor-default"
                        style={{
                          background: `${plan.color}${Math.round(intensity * 220 + 20).toString(16).padStart(2, '0')}`,
                          minWidth: '28px',
                        }}
                        title={`${slot}: ${val} Mbps`}
                      >
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[9px] font-mono text-white font-bold">{val}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex gap-0.5 mt-1 ml-16">
              {hourlySlots.map((s, i) => (
                <div key={i} className="flex-1 text-center text-[9px] text-muted-foreground font-mono" style={{ minWidth: '28px' }}>{s}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Plan summary pills */}
      <div className="flex flex-wrap gap-2 mt-3">
        {barData.map((p, i) => {
          const utilPct = p.capacidade > 0 ? Math.round((p.consumoAtual / p.capacidade) * 100) : 0;
          return (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-secondary/50 border border-border">
              <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
              <span className="text-[10px] text-muted-foreground">{p.name}</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: p.color }}>{utilPct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}