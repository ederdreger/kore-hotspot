import { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MapPin, Flame } from 'lucide-react';

const TOOLTIP_STYLE = {
  background: 'hsl(220 24% 11%)',
  border: '1px solid hsl(220 18% 18%)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'hsl(210 40% 96%)',
};

// Hotspot access heat levels
const HEAT_COLORS = ['#1a3a4a', '#0d5c6e', '#007a8c', '#00a0b0', '#00c4cc', '#00e5ff', '#4af0ff'];

function getHeatColor(value, max) {
  const ratio = Math.min(value / max, 1);
  const idx = Math.floor(ratio * (HEAT_COLORS.length - 1));
  return HEAT_COLORS[idx];
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={TOOLTIP_STYLE} className="p-3 min-w-[160px]">
      <p className="font-semibold text-foreground mb-1">{d?.location}</p>
      <p className="text-primary">Acessos: <span className="font-mono font-bold">{d?.acessos}</span></p>
      <p className="text-info">Únicos: <span className="font-mono font-bold">{d?.unicos}</span></p>
      <p className="text-warning">Duração média: <span className="font-mono">{d?.duracao}min</span></p>
    </div>
  );
};

// Static location grid for the heatmap (simulated AP positions)
const AP_LOCATIONS = [
  { location: 'Recepção Principal', x: 2, y: 7, acessos: 312, unicos: 89, duracao: 42 },
  { location: 'Sala de Espera A', x: 4, y: 7, acessos: 248, unicos: 71, duracao: 38 },
  { location: 'Corredor Norte', x: 6, y: 8, acessos: 187, unicos: 54, duracao: 22 },
  { location: 'Café / Lanchonete', x: 2, y: 5, acessos: 421, unicos: 103, duracao: 55 },
  { location: 'Auditório', x: 5, y: 5, acessos: 89, unicos: 30, duracao: 95 },
  { location: 'Sala de Espera B', x: 8, y: 5, acessos: 156, unicos: 47, duracao: 28 },
  { location: 'Área Externa Sul', x: 3, y: 3, acessos: 203, unicos: 78, duracao: 18 },
  { location: 'Estacionamento', x: 6, y: 2, acessos: 67, unicos: 31, duracao: 12 },
  { location: 'Entrada Secundária', x: 9, y: 3, acessos: 134, unicos: 52, duracao: 25 },
  { location: 'Hall Central', x: 5, y: 9, acessos: 378, unicos: 94, duracao: 47 },
];

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOURS = ['00', '03', '06', '09', '12', '15', '18', '21'];

export default function HotspotHeatmap({ clients, prospects }) {
  // Generate weekly heatmap data (day × hour)
  const weeklyHeatmap = useMemo(() => {
    const grid = [];
    DAYS.forEach((day, di) => {
      HOURS.forEach((hour, hi) => {
        const isWeekend = di === 0 || di === 6;
        const isPeak = hi >= 3 && hi <= 6; // 09h-21h
        const isNight = hi === 0 || hi === 1;
        let base = isWeekend ? 60 : 40;
        if (isPeak) base += isWeekend ? 80 : 100;
        if (isNight) base = Math.round(base * 0.1);
        const val = Math.max(2, Math.round(base + (Math.random() - 0.5) * base * 0.4));
        grid.push({ day, hour: `${hour}h`, di, hi, value: val });
      });
    });
    return grid;
  }, []);

  const maxHeat = Math.max(...weeklyHeatmap.map(d => d.value));
  const maxAcessos = Math.max(...AP_LOCATIONS.map(l => l.acessos));

  const topLocations = [...AP_LOCATIONS].sort((a, b) => b.acessos - a.acessos).slice(0, 5);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Mapa de Calor de Acessos</h3>
          <p className="text-xs text-muted-foreground">Intensidade de uso por local e horário</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-destructive/10 border border-destructive/20">
          <Flame className="w-3 h-3 text-destructive" />
          <span className="text-xs font-mono text-destructive">{AP_LOCATIONS.reduce((a, l) => a + l.acessos, 0)} total</span>
        </div>
      </div>

      {/* Weekly usage heatmap grid */}
      <div className="mb-5">
        <p className="text-xs text-muted-foreground mb-2 font-medium">Acessos por dia × hora (semana)</p>
        <div className="overflow-x-auto">
          <div className="min-w-[400px]">
            {/* Header */}
            <div className="flex gap-0.5 mb-0.5 ml-9">
              {HOURS.map(h => (
                <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground font-mono">{h}h</div>
              ))}
            </div>
            {/* Rows */}
            {DAYS.map((day, di) => (
              <div key={day} className="flex items-center gap-0.5 mb-0.5">
                <span className="text-[10px] text-muted-foreground font-mono w-8 flex-shrink-0">{day}</span>
                {HOURS.map((_, hi) => {
                  const cell = weeklyHeatmap.find(d => d.di === di && d.hi === hi);
                  const val = cell?.value || 0;
                  const ratio = val / maxHeat;
                  const opacity = 0.08 + ratio * 0.92;
                  return (
                    <div
                      key={hi}
                      className="flex-1 h-6 rounded-sm cursor-default transition-all hover:ring-1 hover:ring-primary/50"
                      style={{
                        background: `hsl(187 100% 50% / ${opacity})`,
                      }}
                      title={`${day} ${hi * 3}h: ${val} acessos`}
                    />
                  );
                })}
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center gap-2 mt-2 ml-9">
              <span className="text-[9px] text-muted-foreground">Menos</span>
              <div className="flex gap-0.5">
                {[0.08, 0.25, 0.42, 0.58, 0.75, 0.92].map((o, i) => (
                  <div key={i} className="w-4 h-3 rounded-sm" style={{ background: `hsl(187 100% 50% / ${o})` }} />
                ))}
              </div>
              <span className="text-[9px] text-muted-foreground">Mais</span>
            </div>
          </div>
        </div>
      </div>

      {/* AP Location scatter */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium">Distribuição por ponto de acesso (AP)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Scatter plot */}
          <ResponsiveContainer width="100%" height={160}>
            <ScatterChart margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 18%)" />
              <XAxis dataKey="x" type="number" domain={[0, 11]} hide />
              <YAxis dataKey="y" type="number" domain={[0, 11]} hide />
              <ZAxis dataKey="acessos" range={[40, 600]} />
              <Tooltip content={<CustomTooltip />} />
              <Scatter data={AP_LOCATIONS} shape="circle">
                {AP_LOCATIONS.map((loc, i) => (
                  <Cell key={i} fill={getHeatColor(loc.acessos, maxAcessos)} fillOpacity={0.85} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          {/* Top locations list */}
          <div className="space-y-1.5">
            {topLocations.map((loc, i) => {
              const pct = Math.round((loc.acessos / maxAcessos) * 100);
              return (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 w-4 flex-shrink-0">
                    <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: getHeatColor(loc.acessos, maxAcessos) }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-foreground truncate">{loc.location}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: getHeatColor(loc.acessos, maxAcessos) }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground w-8 flex-shrink-0">{loc.acessos}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}