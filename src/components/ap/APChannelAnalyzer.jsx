import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Radio, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Non-overlapping channels: 2.4GHz = 1,6,11 | 5GHz = 36,40,44,48,149,153,157,161
const GOOD_CHANNELS_24 = [1, 6, 11];
const GOOD_CHANNELS_5  = [36, 40, 44, 48, 149, 153, 157, 161];

function interferenceLevel(ap, allAPs) {
  const same = allAPs.filter(a => a.id !== ap.id && a.channel === ap.channel && a.band === ap.band);
  if (ap.band === '2.4GHz') {
    const adjacent = allAPs.filter(a => a.id !== ap.id && a.band === '2.4GHz' && Math.abs(a.channel - ap.channel) <= 4 && a.channel !== ap.channel);
    return same.length * 2 + adjacent.length;
  }
  return same.length;
}

function bestChannel(ap, allAPs) {
  const pool = ap.band === '2.4GHz' ? GOOD_CHANNELS_24 : GOOD_CHANNELS_5;
  const usage = pool.map(ch => ({
    ch,
    score: allAPs.filter(a => a.id !== ap.id && a.channel === ch && a.band === ap.band).length,
  }));
  usage.sort((a, b) => a.score - b.score);
  return usage[0].ch;
}

const TOOLTIP_STYLE = {
  background: 'hsl(220 24% 11%)',
  border: '1px solid hsl(220 18% 18%)',
  borderRadius: '8px',
  fontSize: '11px',
  color: 'hsl(210 40% 96%)',
};

export default function APChannelAnalyzer({ aps, onChangeChannel }) {
  const [applying, setApplying] = useState(null);

  // Build channel utilization chart data
  const allChannels = [...new Set(aps.map(a => a.channel))].sort((a, b) => a - b);
  const chartData = allChannels.map(ch => {
    const apsCh = aps.filter(a => a.channel === ch);
    const band = apsCh[0]?.band || '2.4GHz';
    const good = band === '2.4GHz' ? GOOD_CHANNELS_24.includes(ch) : true;
    return {
      channel: `CH${ch}`,
      aps: apsCh.length,
      clients: apsCh.reduce((s, a) => s + a.clients, 0),
      good,
      band,
    };
  });

  // APs with interference issues
  const apIssues = aps.map(ap => ({
    ...ap,
    interferenceScore: interferenceLevel(ap, aps),
    suggestedChannel: bestChannel(ap, aps),
  })).filter(a => a.interferenceScore > 0 || a.status === 'interference').sort((a, b) => b.interferenceScore - a.interferenceScore);

  const handleApply = async (ap) => {
    setApplying(ap.id);
    await new Promise(r => setTimeout(r, 600));
    onChangeChannel(ap, ap.suggestedChannel);
    setApplying(null);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden h-full flex flex-col">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          Analisador de Canais
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Interferência e canais recomendados</p>
      </div>

      {/* Channel usage chart */}
      <div className="px-5 pt-4">
        <p className="text-xs text-muted-foreground mb-2 font-medium">Uso de canais (APs + clientes)</p>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 18%)" vertical={false} />
            <XAxis dataKey="channel" tick={{ fontSize: 9, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(val, name) => [val, name === 'aps' ? 'APs' : 'Clientes']}
            />
            <Bar dataKey="aps" name="aps" radius={[3, 3, 0, 0]} maxBarSize={20}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.good ? 'hsl(187 100% 50%)' : 'hsl(38 92% 50%)'} fillOpacity={0.8} />
              ))}
            </Bar>
            <Bar dataKey="clients" name="clients" radius={[3, 3, 0, 0]} maxBarSize={20} fill="hsl(142 71% 45%)" fillOpacity={0.6} />
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-primary" />Canal livre</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-warning" />Sobreposição</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-success" />Clientes</span>
        </div>
      </div>

      {/* Interference issues list */}
      <div className="px-5 py-4 flex-1 overflow-y-auto scrollbar-thin">
        <p className="text-xs text-muted-foreground mb-2 font-medium">Problemas detectados</p>
        {apIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Radio className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-xs">Nenhuma interferência detectada</p>
          </div>
        ) : (
          <div className="space-y-2">
            {apIssues.map(ap => (
              <div key={ap.id} className="flex items-center gap-3 p-3 rounded-xl border border-warning/20 bg-warning/5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">{ap.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {ap.band} · CH{ap.channel} · score {ap.interferenceScore}
                  </p>
                  <p className="text-[10px] text-primary mt-0.5 flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" />
                    Sugestão: CH{ap.suggestedChannel}
                    {ap.suggestedChannel === ap.channel ? ' (já ótimo)' : ` (←  CH${ap.channel})`}
                  </p>
                </div>
                {ap.suggestedChannel !== ap.channel && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={applying === ap.id}
                    onClick={() => handleApply(ap)}
                    className="text-xs border-primary/30 text-primary hover:bg-primary/10 flex-shrink-0"
                  >
                    {applying === ap.id ? '...' : 'Aplicar'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}