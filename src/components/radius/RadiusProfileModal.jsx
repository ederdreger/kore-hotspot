import { useState } from 'react';
import { X, Zap, ShieldAlert, Turtle, Gauge, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const EMERGENCY_PROFILES = [
  {
    id: 'throttle_1m',
    label: 'Throttle 1 Mbps',
    description: 'Reduz drasticamente para liberar capacidade de rede',
    icon: Turtle,
    downloadRate: 1.0,
    uploadRate: 0.5,
    color: 'warning',
    status: 'warning',
    badge: 'Emergência',
  },
  {
    id: 'throttle_5m',
    label: 'Throttle 5 Mbps',
    description: 'Limitação moderada — mantém acesso básico',
    icon: Gauge,
    downloadRate: 5.0,
    uploadRate: 2.0,
    color: 'info',
    status: null,
    badge: 'Moderado',
  },
  {
    id: 'block_quota',
    label: 'Bloquear por Quota',
    description: 'Aplica perfil de bloqueio até renovação de quota',
    icon: ShieldAlert,
    downloadRate: 0.1,
    uploadRate: 0.05,
    color: 'destructive',
    status: 'quota_exceeded',
    badge: 'Bloqueio',
  },
  {
    id: 'restore_default',
    label: 'Restaurar Padrão',
    description: 'Remove restrições e restaura velocidade do plano original',
    icon: Zap,
    downloadRate: 50.0,
    uploadRate: 25.0,
    color: 'success',
    status: 'active',
    badge: 'Restaurar',
  },
];

const colorMap = {
  warning: 'border-warning/30 hover:bg-warning/5 hover:border-warning/60',
  info: 'border-info/30 hover:bg-info/5 hover:border-info/60',
  destructive: 'border-destructive/30 hover:bg-destructive/5 hover:border-destructive/60',
  success: 'border-success/30 hover:bg-success/5 hover:border-success/60',
};

const textMap = {
  warning: 'text-warning',
  info: 'text-info',
  destructive: 'text-destructive',
  success: 'text-success',
};

const badgeMap = {
  warning: 'bg-warning/10 text-warning border-warning/20',
  info: 'bg-info/10 text-info border-info/20',
  destructive: 'bg-destructive/10 text-destructive border-destructive/20',
  success: 'bg-success/10 text-success border-success/20',
};

export default function RadiusProfileModal({ session, onApply, onClose }) {
  const [selected, setSelected] = useState(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-foreground">Perfil de Emergência</h2>
            <p className="text-xs text-muted-foreground font-mono">{session.username} · {session.framedIp}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current info */}
        <div className="px-5 py-3 bg-secondary/30 border-b border-border flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">Plano atual: <span className="font-mono text-foreground font-medium">{session.planName}</span></span>
          <span className="text-muted-foreground">Taxa: <span className="font-mono text-primary">{session.downloadRate}↓ / {session.uploadRate}↑ Mbps</span></span>
        </div>

        {/* Profile options */}
        <div className="p-5 space-y-2">
          {EMERGENCY_PROFILES.map(profile => {
            const Icon = profile.icon;
            const isSelected = selected?.id === profile.id;
            return (
              <button
                key={profile.id}
                onClick={() => setSelected(profile)}
                className={`w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${colorMap[profile.color]} ${isSelected ? `ring-1 ring-offset-1 ring-offset-card ${textMap[profile.color].replace('text-', 'ring-')}` : 'border-border'}`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${badgeMap[profile.color]}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground">{profile.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${badgeMap[profile.color]}`}>{profile.badge}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{profile.description}</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    ↓ {profile.downloadRate} / ↑ {profile.uploadRate} Mbps
                  </p>
                </div>
                {isSelected && <ChevronRight className={`w-4 h-4 flex-shrink-0 ${textMap[profile.color]}`} />}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => selected && onApply(selected)}
            className="gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            Aplicar Perfil
          </Button>
        </div>
      </div>
    </div>
  );
}