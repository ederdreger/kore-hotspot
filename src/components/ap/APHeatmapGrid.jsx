import { useMemo } from 'react';
import { Wifi, Users, Signal } from 'lucide-react';

const STATUS_CONFIG = {
  ok:           { ring: '#00FF88', fill: '#00FF8820', label: 'OK' },
  overloaded:   { ring: '#FF4444', fill: '#FF444420', label: 'Sobrecarregado' },
  interference: { ring: '#FFB800', fill: '#FFB80020', label: 'Interferência' },
  weak_signal:  { ring: '#A855F7', fill: '#A855F720', label: 'Sinal Fraco' },
  offline:      { ring: '#555',    fill: '#55555520', label: 'Offline' },
};

function SignalStrengthColor(dbm) {
  if (dbm >= -60) return '#00FF88';
  if (dbm >= -70) return '#00E5FF';
  if (dbm >= -80) return '#FFB800';
  return '#FF4444';
}

function APNode({ ap, selected, onSelect }) {
  const cfg = STATUS_CONFIG[ap.status] || STATUS_CONFIG.ok;
  const sigColor = SignalStrengthColor(ap.signalAvg);
  const radiusSize = 28 + (ap.clients / ap.maxClients) * 20;

  return (
    <g transform={`translate(${ap.location.x}%, ${ap.location.y}%)`} style={{ cursor: 'pointer' }} onClick={() => onSelect(ap)}>
      {/* Signal ripple */}
      <circle r={radiusSize + 12} fill={cfg.fill} stroke={cfg.ring} strokeWidth={0.5} strokeDasharray="3 3" opacity={0.5} />
      <circle r={radiusSize + 6} fill={cfg.fill} stroke={cfg.ring} strokeWidth={0.8} opacity={0.7} />
      {/* Core */}
      <circle
        r={radiusSize}
        fill={selected ? cfg.ring + '40' : cfg.fill}
        stroke={cfg.ring}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {/* Label */}
      <text x={0} y={-radiusSize - 8} textAnchor="middle" fontSize={9} fill="hsl(210 40% 80%)" fontFamily="monospace">
        {ap.name.replace('AP-', '')}
      </text>
      <text x={0} y={5} textAnchor="middle" fontSize={10} fill={sigColor} fontWeight="bold" fontFamily="monospace">
        {ap.clients}
      </text>
      <text x={0} y={17} textAnchor="middle" fontSize={8} fill="hsl(215 20% 55%)" fontFamily="monospace">
        CH{ap.channel}
      </text>
    </g>
  );
}

export default function APHeatmapGrid({ aps, loading, selectedAP, onSelectAP }) {
  const ap = selectedAP;

  if (loading) {
    return <div className="bg-card border border-border rounded-xl h-96 animate-pulse" />;
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Mapa de Calor — Access Points</h3>
          <p className="text-xs text-muted-foreground">Clique em um AP para detalhes</p>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: cfg.ring }} />
              {cfg.label}
            </span>
          ))}
        </div>
      </div>

      {/* SVG floor plan */}
      <div className="relative bg-secondary/20" style={{ paddingBottom: '70%' }}>
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Floor plan outline */}
          <rect x="5" y="5" width="90" height="90" rx="2" fill="none" stroke="hsl(220 18% 22%)" strokeWidth={0.5} />
          {/* Rooms */}
          <rect x="5" y="5"  width="30" height="35" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          <rect x="35" y="5" width="30" height="35" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          <rect x="65" y="5" width="30" height="35" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          <rect x="5" y="40" width="30" height="30" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          <rect x="35" y="40" width="30" height="30" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          <rect x="65" y="40" width="30" height="30" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          <rect x="10" y="72" width="40" height="23" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          <rect x="55" y="72" width="40" height="23" rx="1" fill="hsl(220 24% 9%)" stroke="hsl(220 18% 20%)" strokeWidth={0.3} />
          {/* Room labels */}
          {[
            [20, 8, 'Recepção'], [50, 8, 'Café'], [80, 8, 'Auditório'],
            [20, 43, 'Corredor N'], [50, 43, 'Hall'], [80, 43, 'Corredor S'],
            [28, 75, 'Ext. Sul'], [73, 75, 'Estacion.'],
          ].map(([x, y, lbl], i) => (
            <text key={i} x={x} y={y} textAnchor="middle" fontSize={3.5} fill="hsl(215 20% 35%)">{lbl}</text>
          ))}

          {/* AP nodes rendered with foreignObject positioning trick via SVG */}
          {aps.map(ap => {
            const x = ap.location.x;
            const y = ap.location.y;
            const cfg = STATUS_CONFIG[ap.status] || STATUS_CONFIG.ok;
            const sigColor = SignalStrengthColor(ap.signalAvg);
            const r = 6 + (ap.clients / ap.maxClients) * 4;
            const isSelected = selectedAP?.id === ap.id;
            return (
              <g key={ap.id} transform={`translate(${x}, ${y})`} style={{ cursor: 'pointer' }} onClick={() => onSelectAP(isSelected ? null : ap)}>
                {/* Coverage pulse */}
                <circle r={r + 7} fill={cfg.fill} stroke={cfg.ring} strokeWidth={0.4} strokeDasharray="2 2" opacity={0.5} />
                <circle r={r + 3} fill={cfg.fill} stroke={cfg.ring} strokeWidth={0.6} opacity={0.7} />
                {/* AP body */}
                <circle r={r} fill={isSelected ? cfg.ring + '60' : cfg.fill} stroke={cfg.ring} strokeWidth={isSelected ? 1.5 : 1} />
                {/* Client count */}
                <text y={1.5} textAnchor="middle" fontSize={3.5} fill={sigColor} fontWeight="bold">{ap.clients}</text>
                {/* Name */}
                <text y={-r - 3} textAnchor="middle" fontSize={3} fill="hsl(210 40% 75%)">{ap.name.replace('AP-', '')}</text>
                <text y={r + 5} textAnchor="middle" fontSize={2.5} fill="hsl(215 20% 50%)">CH{ap.channel}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected AP detail panel */}
      {ap && (
        <div className="border-t border-border px-5 py-4 bg-secondary/20">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-foreground">{ap.name}</p>
              <p className="text-xs font-mono text-muted-foreground">{ap.ip} · {ap.band} · Canal {ap.channel}</p>
            </div>
            <button onClick={() => onSelectAP(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mt-3">
            {[
              { label: 'Clientes', value: `${ap.clients}/${ap.maxClients}`, color: ap.clients >= ap.maxClients * 0.9 ? 'text-destructive' : 'text-success' },
              { label: 'Utilização', value: `${ap.utilization}%`, color: ap.utilization > 85 ? 'text-destructive' : ap.utilization > 65 ? 'text-warning' : 'text-success' },
              { label: 'Sinal Médio', value: `${ap.signalAvg} dBm`, color: SignalStrengthColor(ap.signalAvg) === '#00FF88' ? 'text-success' : ap.signalAvg > -75 ? 'text-warning' : 'text-destructive' },
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