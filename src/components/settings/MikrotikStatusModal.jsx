import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, CheckCircle, RefreshCw, Router, X } from 'lucide-react';

function formatRouterUptime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (!match) return text || 'N/A';

  const weeks = parseInt(match[1] || '0');
  const days = parseInt(match[2] || '0');
  const hours = parseInt(match[3] || '0');
  const minutes = parseInt(match[4] || '0');
  const parts = [];
  if (weeks) parts.push(`${weeks} sem`);
  if (days) parts.push(`${days} dia${days > 1 ? 's' : ''}`);
  parts.push(`${hours}h ${minutes}min`);
  return parts.join(' ');
}

export default function MikrotikStatusModal({ mikrotik, token, onClose }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('mikrotikStatus', {
        host: mikrotik.host,
        port: mikrotik.port || '22',
        snmp_port: mikrotik.snmp_port || '161',
        snmp_community: mikrotik.snmp_community || 'public',
        token,
      });
      setStatus(res.data);
    } catch (error) {
      setStatus({
        online: false,
        snmp_connected: false,
        snmp_error: error?.response?.status === 504 ? 'A consulta demorou demais. Verifique se o IP/porta SNMP estão acessíveis pela internet.' : 'Falha ao consultar MikroTik',
        ping: { online: null },
        ssh: { reachable: null, port: mikrotik.port || '22' },
      });
    }
    setLoading(false);
  };

  useEffect(() => { checkStatus(); }, []);

  const online = status?.online || status?.connected;
  const snmpOk = status?.snmp_connected && !status?.snmp_error;

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
              <p className="text-xs text-muted-foreground font-mono">{mikrotik.host} · SSH {mikrotik.port || '22'} · SNMP {mikrotik.snmp_port || '161'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Verificando ping, SSH e coleta SNMP...
            </div>
          ) : (
            <div className={`rounded-xl border p-4 text-sm flex gap-3 ${online ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
              {online ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              <span>{online ? 'Equipamento online. Veja abaixo o status do SNMP e SSH.' : 'Equipamento sem resposta por ping e SSH.'}</span>
            </div>
          )}

          {!loading && status && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Ping</p><p className="text-sm font-semibold">{status.ping?.online ? `Online${status.ping.latency_ms ? ` · ${status.ping.latency_ms}ms` : ''}` : 'Sem resposta'}</p></div>
              <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">SSH</p><p className="text-sm font-semibold">{status.ssh?.reachable ? `Porta ${status.ssh.port} aberta` : `Porta ${status.ssh?.port || mikrotik.port || '22'} fechada`}</p></div>
              <div className="bg-background border border-border rounded-xl p-3 col-span-2"><p className="text-xs text-muted-foreground">SNMP</p><p className={`text-sm font-semibold ${snmpOk ? 'text-success' : 'text-destructive'}`}>{snmpOk ? 'Coletando informações' : (status.snmp_error || 'SNMP sem resposta')}</p></div>
              {snmpOk && <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Uptime</p><p className="text-sm font-semibold">{formatRouterUptime(status.uptime)}</p></div>}
              {snmpOk && <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">CPU</p><p className="text-sm font-semibold">{status.cpu_load ?? 'N/A'}%</p></div>}
              {snmpOk && <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Versão</p><p className="text-sm font-semibold">{status.version || 'N/A'}</p></div>}
              {snmpOk && <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Hotspot</p><p className="text-sm font-semibold">{status.hotspot_count ?? 0} servidor(es)</p></div>}
              {snmpOk && <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">Usuários ativos</p><p className="text-sm font-semibold">{status.active_users ?? 0}</p></div>}
              {snmpOk && <div className="bg-background border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">RADIUS Hotspot</p><p className="text-sm font-semibold">{status.radius_hotspot_count ?? 0} configurado(s)</p></div>}
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