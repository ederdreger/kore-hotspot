import { useState, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollText, Search, RefreshCw, Trash2, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

const statusIcons = {
  success: { Icon: CheckCircle, color: 'text-success' },
  error: { Icon: AlertCircle, color: 'text-destructive' },
  warning: { Icon: AlertTriangle, color: 'text-warning' },
  info: { Icon: Info, color: 'text-info' },
};

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    const data = await spedynet.entities.AuditLog.list('-created_date', 500);
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = logs.filter(l => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.message?.toLowerCase().includes(q) || l.action?.toLowerCase().includes(q) || l.entity_name?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchEntity = entityFilter === 'all' || l.entity_type === entityFilter;
    return matchSearch && matchStatus && matchEntity;
  });

  const handleClearAll = async () => {
    if (!confirm('Limpar todos os logs? Esta ação não pode ser desfeita.')) return;
    await Promise.all(logs.map(l => spedynet.entities.AuditLog.delete(l.id)));
    toast.success('Logs limpos');
    load();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: logs.length, color: 'text-foreground' },
          { label: 'Sucesso', value: logs.filter(l => l.status === 'success').length, color: 'text-success' },
          { label: 'Erros', value: logs.filter(l => l.status === 'error').length, color: 'text-destructive' },
          { label: 'Avisos', value: logs.filter(l => l.status === 'warning').length, color: 'text-warning' },
        ].map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4">
            <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar nos logs..." className="pl-9 bg-card border-border" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="success">Sucesso</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
            <SelectItem value="warning">Aviso</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-36 bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Entidades</SelectItem>
            <SelectItem value="client">Cliente</SelectItem>
            <SelectItem value="prospect">Prospecto</SelectItem>
            <SelectItem value="radius">RADIUS</SelectItem>
            <SelectItem value="mikrotik">MikroTik</SelectItem>
            <SelectItem value="ixc">IXC</SelectItem>
            <SelectItem value="voucher">Voucher</SelectItem>
            <SelectItem value="campaign">Campanha</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={load} variant="outline" size="icon" className="border-border"><RefreshCw className="w-4 h-4" /></Button>
        {logs.length > 0 && (
          <Button onClick={handleClearAll} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-2">
            <Trash2 className="w-4 h-4" />Limpar
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="space-y-px">
            {Array(10).fill(0).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border">
                <div className="w-4 h-4 bg-secondary rounded animate-pulse" />
                <div className="flex-1 h-4 bg-secondary rounded animate-pulse" />
                <div className="w-20 h-4 bg-secondary rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ScrollText className="w-10 h-10 mb-3 opacity-30" />
            <p>Nenhum log encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/30">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase w-10"></th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Ação / Mensagem</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Entidade</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden lg:table-cell">Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(log => {
                  const conf = statusIcons[log.status] || statusIcons.info;
                  return (
                    <tr key={log.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3">
                        <conf.Icon className={`w-4 h-4 ${conf.color}`} />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-foreground">{log.message}</p>
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">{log.action}</p>
                        {log.details && <p className="text-xs text-muted-foreground mt-0.5 opacity-70">{log.details}</p>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div>
                          <span className="px-2 py-0.5 rounded bg-secondary text-xs text-muted-foreground font-mono">{log.entity_type}</span>
                          {log.entity_name && <p className="text-xs text-muted-foreground mt-0.5">{log.entity_name}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground font-mono">
                        {format(new Date(log.created_date), 'dd/MM/yy HH:mm:ss', { locale: ptBR })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">{filtered.length} de {logs.length} registro(s)</div>}
      </div>
    </div>
  );
}