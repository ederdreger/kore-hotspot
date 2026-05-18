import { useState } from 'react';
import { ArrowRight, Shuffle, CheckCircle, Zap, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

function computeSuggestions(aps) {
  const suggestions = [];
  const overloaded = aps.filter(a => a.utilization > 80 || a.clients >= a.maxClients * 0.9);
  const underloaded = aps.filter(a => a.utilization < 40 && a.clients < a.maxClients * 0.5);

  overloaded.forEach(src => {
    // find nearest underloaded AP (same band preferred)
    const targets = underloaded
      .filter(t => t.id !== src.id)
      .sort((a, b) => {
        const bandBonus = (t) => t.band === src.band ? 0 : 5;
        const dist = (t) => Math.hypot(t.location.x - src.location.x, t.location.y - src.location.y);
        return (dist(a) + bandBonus(a)) - (dist(b) + bandBonus(b));
      });

    if (!targets.length) return;
    const dst = targets[0];
    const clientsToMove = Math.max(1, Math.floor((src.clients - dst.clients) / 3));
    const utilizationDrop = Math.round((clientsToMove / src.maxClients) * 100);
    const utilizationGain = Math.round((clientsToMove / dst.maxClients) * 100);

    suggestions.push({
      id: `${src.id}-${dst.id}`,
      from: src,
      to: dst,
      clientsToMove,
      utilizationDrop,
      utilizationGain,
      reason: src.utilization > 85 ? 'Sobrecarga crítica' : src.clients >= src.maxClients * 0.9 ? 'Máximo de clientes' : 'Alta utilização',
      severity: src.utilization > 90 ? 'critical' : 'warning',
    });
  });

  return suggestions;
}

function UtilBar({ value, projected }) {
  const color = projected > 85 ? '#FF4444' : projected > 65 ? '#FFB800' : '#00FF88';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden relative">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%`, background: color, opacity: 0.4 }} />
        <div className="absolute inset-y-0 left-0 h-full rounded-full" style={{ width: `${Math.min(projected, 100)}%`, background: color, opacity: 0.9 }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8">{projected}%</span>
    </div>
  );
}

export default function APLoadBalancer({ aps, onBalance }) {
  const [applied, setApplied] = useState(new Set());
  const [applying, setApplying] = useState(null);

  const suggestions = computeSuggestions(aps);

  const handleApply = async (suggestion) => {
    setApplying(suggestion.id);
    await new Promise(r => setTimeout(r, 700));
    onBalance(suggestion.from, suggestion.to, suggestion);
    setApplied(prev => new Set([...prev, suggestion.id]));
    setApplying(null);
  };

  const handleApplyAll = async () => {
    for (const s of suggestions.filter(s => !applied.has(s.id))) {
      await handleApply(s);
      await new Promise(r => setTimeout(r, 300));
    }
  };

  const pending = suggestions.filter(s => !applied.has(s.id));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Shuffle className="w-4 h-4 text-primary" />
            Balanceamento de Carga Automático
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pending.length} sugestão(ões) de redistribuição de clientes
          </p>
        </div>
        {pending.length > 1 && (
          <Button size="sm" onClick={handleApplyAll} disabled={applying !== null} className="gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            Aplicar Todas
          </Button>
        )}
      </div>

      {suggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <CheckCircle className="w-10 h-10 mb-2 opacity-20" />
          <p className="text-sm font-medium">Carga balanceada</p>
          <p className="text-xs">Nenhuma redistribuição necessária no momento</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {suggestions.map(s => {
            const isDone = applied.has(s.id);
            const isApplying = applying === s.id;
            const projFrom = Math.max(0, s.from.utilization - s.utilizationDrop);
            const projTo = Math.min(100, s.to.utilization + s.utilizationGain);

            return (
              <div key={s.id} className={`px-5 py-4 transition-colors ${isDone ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-4">
                  {/* From AP */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${s.severity === 'critical' ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-warning/10 text-warning border-warning/20'}`}>
                        {s.reason}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-foreground">{s.from.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mb-1">{s.from.clients} clientes · {s.from.band}</p>
                    <UtilBar value={s.from.utilization} projected={isDone ? projFrom : s.from.utilization} />
                  </div>

                  {/* Arrow + transfer info */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-4">
                    <div className="flex items-center gap-1 text-primary">
                      <Users className="w-3 h-3" />
                      <span className="text-xs font-bold font-mono">{s.clientsToMove}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-primary" />
                  </div>

                  {/* To AP */}
                  <div className="flex-1 min-w-0">
                    <div className="h-5 mb-1" />
                    <p className="text-xs font-bold text-foreground">{s.to.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mb-1">{s.to.clients} clientes · {s.to.band}</p>
                    <UtilBar value={s.to.utilization} projected={isDone ? projTo : s.to.utilization + s.utilizationGain} />
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0 pt-4">
                    {isDone ? (
                      <div className="flex items-center gap-1 text-success text-xs">
                        <CheckCircle className="w-4 h-4" />
                        <span>Aplicado</span>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isApplying || applying !== null}
                        onClick={() => handleApply(s)}
                        className="gap-1.5 text-xs"
                      >
                        {isApplying ? (
                          <span className="w-3.5 h-3.5 border border-primary border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Shuffle className="w-3.5 h-3.5" />
                        )}
                        {isApplying ? 'Aplicando...' : 'Balancear'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}