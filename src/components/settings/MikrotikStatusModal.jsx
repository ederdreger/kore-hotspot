import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, CheckCircle, RefreshCw, Router, X } from 'lucide-react';

export default function MikrotikStatusModal({ mikrotik, token, onClose }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  const checkStatus = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('mikrotikStatus', {
      host: mikrotik.host,
      port: mikrotik.port || '22',
      user: mikrotik.user,
      password: mikrotik.password,
      token,
    });
    setStatus(res.data);
    setLoading(false);
  };

  useEffect(() => { checkStatus(); }, []);

  const online = status?.connected && !status?.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${online ? 'bg-success/10' : 'bg-primary/10'}`}>
              <Router className={`w-4 h-4 ${online ? 'text-success' : 'text-primary'}`} />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Status do MikroTik</h3>
              <p className="text-xs text-muted-foreground font-mono">{mikrotik.host}:{mikrotik.port || '22'} · {mikrotik.user}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Verificando conexão SSH e status do RouterOS...
            </div>
          ) : status?.error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex gap-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{status.error}</span>
            </div>
          ) : (
            <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success flex gap-3">
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Equipamento online e respondendo comandos RouterOS.</span>
            </div>
          )}

          {!loading && !status?.error && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Uptime</p><p className="text-sm font-semibold">{status.uptime || 'N/A'}</p></div>
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">CPU</p><p className="text-sm font-semibold">{status.cpu_load ?? 'N/A'}%</p></div>
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Versão</p><p className="text-sm font-semibold">{status.version || 'N/A'}</p></div>
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Hotspot</p><p className="text-sm font-semibold">{status.hotspot_count ?? 0} servidor(es)</p></div>
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Usuários ativos</p><p className="text-sm font-semibold">{status.active_users ?? 0}</p></div>
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">RADIUS Hotspot</p><p className="text-sm font-semibold">{status.radius_hotspot_count ?? 0} configurado(s)</p></div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} className="border-border">Fechar</Button>
            <Button size="sm" onClick={checkStatus} disabled={loading} className="gap-2">
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              Verificar novamente
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}