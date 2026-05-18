import { MapPin, Edit2, Wifi, Users, Signal } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const STATUS_CONFIG = {
  ok:           { color: '#00FF88', label: 'OK',             bg: 'border-green-500/30 bg-green-500/5' },
  overloaded:   { color: '#FF4444', label: 'Sobrecarregado', bg: 'border-red-500/30 bg-red-500/5' },
  interference: { color: '#FFB800', label: 'Interferência',  bg: 'border-yellow-500/30 bg-yellow-500/5' },
  weak_signal:  { color: '#A855F7', label: 'Sinal Fraco',    bg: 'border-purple-500/30 bg-purple-500/5' },
  offline:      { color: '#555555', label: 'Offline',        bg: 'border-border bg-secondary/20' },
};

function SignalColor(dbm) {
  if (dbm >= -60) return '#00FF88';
  if (dbm >= -70) return '#00E5FF';
  if (dbm >= -80) return '#FFB800';
  return '#FF4444';
}

function UtilBar({ value }) {
  const color = value > 85 ? '#FF4444' : value > 65 ? '#FFB800' : '#00FF88';
  return (
    <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
    </div>
  );
}

function APCard({ ap, selected, onSelect, onEdit }) {
  const cfg = STATUS_CONFIG[ap.status] || STATUS_CONFIG.ok;
  const sigColor = SignalColor(ap.signalAvg);
  const loadPct = Math.round((ap.clients / ap.maxClients) * 100);

  // Mini bar chart data: utilization, clients%, signal strength (normalized 0-100)
  const signalNorm = Math.round(Math.max(0, Math.min(100, ((ap.signalAvg + 100) / 55) * 100)));
  const chartData = [
    { name: 'Util.', value: ap.utilization,  color: ap.utilization > 85 ? '#FF4444' : ap.utilization > 65 ? '#FFB800' : '#00FF88' },
    { name: 'Client.', value: loadPct,        color: loadPct > 85 ? '#FF4444' : loadPct > 65 ? '#FFB800' : '#00E5FF' },
    { name: 'Sinal',  value: signalNorm,      color: sigColor },
  ];

  return (
    <div
      onClick={() => onSelect(selected ? null : ap)}
      className={`relative rounded-xl border p-3 cursor-pointer transition-all hover:scale-[1.02] ${cfg.bg} ${selected ? 'ring-2 ring-primary/60' : ''}`}
      style={{ borderColor: selected ? cfg.color : undefined }}
    >
      {/* Edit button */}
      {onEdit && (
        <button
          onClick={e => { e.stopPropagation(); onEdit(ap); }}
          className="absolute top-2 right-2 p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          <Edit2 className="w-3 h-3" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-start gap-2 mb-2 pr-5">
        <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: cfg.color }} />
        <div className="min-w-0">
          <p className="text-xs font-bold text-foreground leading-tight truncate">{ap.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {ap.street}{ap.number ? `, ${ap.number}` : ''}
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/70">{ap.ip} · CH{ap.channel}</p>
        </div>
      </div>

      {/* Mini bar chart */}
      <div className="h-16 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barSize={14} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 8, fill: 'hsl(215 20% 50%)' }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              cursor={{ fill: 'hsl(220 20% 16%)' }}
              contentStyle={{ background: 'hsl(220 24% 11%)', border: '1px solid hsl(220 18% 18%)', borderRadius: 6, fontSize: 10 }}
              formatter={(val, name) => [`${val}%`, name]}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer metrics */}
      <div className="flex items-center justify-between mt-1 pt-2 border-t border-border/50">
        <span className="flex items-center gap-1 text-[10px]">
          <Users className="w-3 h-3 text-muted-foreground" />
          <span className="font-mono font-bold" style={{ color: loadPct > 85 ? '#FF4444' : '#00FF88' }}>{ap.clients}/{ap.maxClients}</span>
        </span>
        <span className="flex items-center gap-1 text-[10px]">
          <Signal className="w-3 h-3 text-muted-foreground" />
          <span className="font-mono font-bold" style={{ color: sigColor }}>{ap.signalAvg} dBm</span>
        </span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: cfg.color + '20', color: cfg.color }}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}

export default function APHeatmapGrid({ aps, loading, selectedAP, onSelectAP, onEditAP }) {
  if (loading) {
    return <div className="bg-card border border-border rounded-xl h-64 animate-pulse" />;
  }

  const ap = selectedAP;

  // Group by neighborhood
  const byNeighborhood = aps.reduce((acc, a) => {
    const key = a.neighborhood || 'Sem Bairro';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" />
            Visão Geral — APs por Localização
          </h3>
          <p className="text-xs text-muted-foreground">Agrupado por bairro · clique no card para detalhes</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px]">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: cfg.color }} />
              {cfg.label}
            </span>
          ))}
        </div>
      </div>

      {/* Cards grid */}
      {aps.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <MapPin className="w-10 h-10 opacity-20" />
          <p className="text-sm font-medium">Nenhum AP cadastrado</p>
          <p className="text-xs">Clique em "Cadastrar AP" para adicionar o primeiro equipamento</p>
        </div>
      ) : (
        <div className="p-4 space-y-5 max-h-[520px] overflow-y-auto scrollbar-thin">
          {Object.entries(byNeighborhood).map(([nbh, apList]) => (
            <div key={nbh}>
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-3 h-3 text-primary" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{nbh}</p>
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground">{apList.length} AP{apList.length > 1 ? 's' : ''}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {apList.map(apItem => (
                  <APCard
                    key={apItem.id}
                    ap={apItem}
                    selected={selectedAP?.id === apItem.id}
                    onSelect={onSelectAP}
                    onEdit={onEditAP}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected AP detail panel */}
      {ap && (
        <div className="border-t border-border px-5 py-4 bg-secondary/20">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                <p className="text-sm font-bold text-foreground">{ap.name}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ap.street}{ap.number ? `, ${ap.number}` : ''}{ap.neighborhood ? ` — ${ap.neighborhood}` : ''}{ap.city ? `, ${ap.city}` : ''}
              </p>
              {ap.reference && <p className="text-[11px] text-muted-foreground/70 italic mt-0.5">Ref: {ap.reference}</p>}
              <p className="text-xs font-mono text-muted-foreground mt-0.5">{ap.ip} · {ap.band} · Canal {ap.channel}</p>
            </div>
            <div className="flex items-center gap-2">
              {onEditAP && (
                <button onClick={() => onEditAP(ap)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => onSelectAP(null)} className="text-muted-foreground hover:text-foreground text-xs p-1">✕</button>
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { label: 'Clientes', value: `${ap.clients}/${ap.maxClients}`, color: ap.clients >= ap.maxClients * 0.9 ? 'text-destructive' : 'text-success' },
              { label: 'Utilização', value: `${ap.utilization}%`, color: ap.utilization > 85 ? 'text-destructive' : ap.utilization > 65 ? 'text-warning' : 'text-success' },
              { label: 'Sinal Médio', value: `${ap.signalAvg} dBm`, color: ap.signalAvg >= -60 ? 'text-success' : ap.signalAvg >= -75 ? 'text-warning' : 'text-destructive' },
              { label: 'Ruído', value: `${ap.noise} dBm`, color: 'text-muted-foreground' },
              { label: 'TX Power', value: `${ap.txPower} dBm`, color: 'text-info' },
              { label: 'Uptime', value: ap.uptime, color: 'text-muted-foreground' },
            ].map((item, i) => (
              <div key={i} className="bg-secondary/50 rounded-lg px-3 py-2">
                <p className="text-[10px] text-muted-foreground">{item.label}</p>
                <p className={`text-sm font-bold font-mono ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}