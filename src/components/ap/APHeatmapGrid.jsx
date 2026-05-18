import { MapPin, Edit2 } from 'lucide-react';

const STATUS_CONFIG = {
  ok:           { ring: '#00FF88', fill: '#00FF8820', label: 'OK' },
  overloaded:   { ring: '#FF4444', fill: '#FF444420', label: 'Sobrecarregado' },
  interference: { ring: '#FFB800', fill: '#FFB80020', label: 'Interferência' },
  weak_signal:  { ring: '#A855F7', fill: '#A855F720', label: 'Sinal Fraco' },
  offline:      { ring: '#555555', fill: '#55555520', label: 'Offline' },
};

function SignalColor(dbm) {
  if (dbm >= -60) return '#00FF88';
  if (dbm >= -70) return '#00E5FF';
  if (dbm >= -80) return '#FFB800';
  return '#FF4444';
}

// Arrange APs into a smart grid based on neighborhood grouping
function getGridPosition(index, total) {
  const cols = Math.ceil(Math.sqrt(total));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const cellW = 90 / cols;
  const cellH = 90 / Math.ceil(total / cols);
  return {
    x: 5 + col * cellW + cellW / 2,
    y: 5 + row * cellH + cellH / 2,
  };
}

export default function APHeatmapGrid({ aps, loading, selectedAP, onSelectAP, onEditAP }) {
  if (loading) {
    return <div className="bg-card border border-border rounded-xl h-96 animate-pulse" />;
  }

  const ap = selectedAP;

  // Build a neighborhood→aps map for visual grouping
  const byNeighborhood = aps.reduce((acc, a) => {
    const key = a.neighborhood || 'Sem Bairro';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  // Assign positions: group by neighborhood in columns
  const neighborhoods = Object.keys(byNeighborhood);
  const positioned = [];
  let globalIdx = 0;
  neighborhoods.forEach((nbh, nbhIdx) => {
    byNeighborhood[nbh].forEach((apItem, apIdx) => {
      const cols = neighborhoods.length;
      const colW = 88 / cols;
      const apCount = byNeighborhood[nbh].length;
      const rows = Math.ceil(apCount / 1);
      const rowH = Math.min(80 / rows, 28);
      positioned.push({
        ...apItem,
        px: 6 + nbhIdx * colW + colW / 2,
        py: 12 + apIdx * rowH + rowH / 2,
      });
      globalIdx++;
    });
  });

  // Fallback: simple grid if no neighborhood info
  const withPos = aps.map((apItem, i) => {
    const found = positioned.find(p => p.id === apItem.id);
    if (found) return found;
    const pos = getGridPosition(i, aps.length);
    return { ...apItem, px: pos.x, py: pos.y };
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Mapa de Calor — APs por Localização</h3>
          <p className="text-xs text-muted-foreground">Agrupado por bairro/localidade · clique para detalhes</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px]">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: cfg.ring }} />
              {cfg.label}
            </span>
          ))}
        </div>
      </div>

      {/* Map area */}
      {aps.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
          <MapPin className="w-10 h-10 opacity-20" />
          <p className="text-sm font-medium">Nenhum AP cadastrado</p>
          <p className="text-xs">Clique em "Cadastrar AP" para adicionar o primeiro equipamento</p>
        </div>
      ) : (
        <div className="relative bg-secondary/10" style={{ paddingBottom: '65%' }}>
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            {/* Background grid — represents urban blocks */}
            {Array.from({ length: 10 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 10} y1={0} x2={i * 10} y2={100} stroke="hsl(220 18% 15%)" strokeWidth={0.2} />
            ))}
            {Array.from({ length: 10 }).map((_, i) => (
              <line key={`h${i}`} x1={0} y1={i * 10} x2={100} y2={i * 10} stroke="hsl(220 18% 15%)" strokeWidth={0.2} />
            ))}

            {/* Neighborhood zone labels */}
            {neighborhoods.map((nbh, nbhIdx) => {
              const cols = neighborhoods.length;
              const colW = 88 / cols;
              const x = 6 + nbhIdx * colW + colW / 2;
              return (
                <text key={nbh} x={x} y={7} textAnchor="middle" fontSize={2.8} fill="hsl(215 20% 40%)" fontFamily="monospace">
                  {nbh.length > 14 ? nbh.slice(0, 12) + '…' : nbh}
                </text>
              );
            })}

            {/* Neighborhood column dividers */}
            {neighborhoods.length > 1 && neighborhoods.map((_, nbhIdx) => {
              if (nbhIdx === 0) return null;
              const cols = neighborhoods.length;
              const colW = 88 / cols;
              const x = 6 + nbhIdx * colW;
              return (
                <line key={`div${nbhIdx}`} x1={x} y1={8} x2={x} y2={96} stroke="hsl(220 18% 22%)" strokeWidth={0.5} strokeDasharray="2 2" />
              );
            })}

            {/* AP nodes */}
            {withPos.map(apItem => {
              const cfg = STATUS_CONFIG[apItem.status] || STATUS_CONFIG.ok;
              const sigColor = SignalColor(apItem.signalAvg);
              const loadRatio = apItem.clients / apItem.maxClients;
              const r = 5 + loadRatio * 4;
              const isSelected = selectedAP?.id === apItem.id;
              return (
                <g key={apItem.id} transform={`translate(${apItem.px}, ${apItem.py})`} style={{ cursor: 'pointer' }} onClick={() => onSelectAP(isSelected ? null : apItem)}>
                  {/* Coverage ripple */}
                  <circle r={r + 8} fill={cfg.fill} stroke={cfg.ring} strokeWidth={0.3} strokeDasharray="2 2" opacity={0.4} />
                  <circle r={r + 4} fill={cfg.fill} stroke={cfg.ring} strokeWidth={0.5} opacity={0.6} />
                  {/* AP body */}
                  <circle r={r} fill={isSelected ? cfg.ring + '50' : cfg.fill} stroke={cfg.ring} strokeWidth={isSelected ? 1.5 : 1} />
                  {/* Client count */}
                  <text y={1.5} textAnchor="middle" fontSize={3.2} fill={sigColor} fontWeight="bold">{apItem.clients}</text>
                  {/* Name (street short) */}
                  <text y={-r - 3} textAnchor="middle" fontSize={2.5} fill="hsl(210 40% 75%)" fontFamily="monospace">
                    {(apItem.name || '').replace('AP-', '').slice(0, 12)}
                  </text>
                  {/* Channel */}
                  <text y={r + 5} textAnchor="middle" fontSize={2.2} fill="hsl(215 20% 50%)">CH{apItem.channel}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Selected AP detail */}
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