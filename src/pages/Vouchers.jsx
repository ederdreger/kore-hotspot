import { useState, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Ticket, Plus, Search, RefreshCw, Copy, Trash2, Clock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function generateCode(len = 8) {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, len);
}

export default function Vouchers() {
  const [vouchers, setVouchers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ plan_id: '', duration_minutes: '30', quantity: '1', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [vs, ps] = await Promise.all([spedynet.entities.Voucher.list('-created_date', 200), spedynet.entities.Plan.filter({ status: 'active' })]);
    setVouchers(vs); setPlans(ps); setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = vouchers.filter(v => {
    const q = search.toLowerCase();
    const matchSearch = !q || v.code?.toLowerCase().includes(q) || v.used_by_name?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleCreate = async () => {
    setSaving(true);
    const plan = plans.find(p => p.id === form.plan_id);
    const qty = Math.min(Number(form.quantity) || 1, 100);
    const batch = `BATCH-${Date.now()}`;
    const vouchersToCreate = Array(qty).fill(0).map(() => ({
      code: generateCode(8),
      plan_id: form.plan_id || '',
      plan_name: plan?.name || 'Sem plano',
      plan_type: plan?.plan_type || (plan?.is_trial ? 'trial' : Number(plan?.price || 0) > 0 ? 'paid' : 'free'),
      download_mbps: Number(plan?.download_mbps || plan?.speed_download || 0),
      upload_mbps: Number(plan?.upload_mbps || plan?.speed_upload || 0),
      speed_download: Number(plan?.download_mbps || plan?.speed_download || 0),
      speed_upload: Number(plan?.upload_mbps || plan?.speed_upload || 0),
      quota_gb: Number(plan?.quota_gb || 0),
      duration_minutes: Number(form.duration_minutes) || 30,
      status: 'available',
      batch_id: batch,
      notes: form.notes
    }));
    await Promise.all(vouchersToCreate.map(v => spedynet.entities.Voucher.create(v)));
    await spedynet.entities.AuditLog.create({ action: 'create_vouchers', entity_type: 'voucher', entity_name: `Lote ${batch}`, status: 'success', message: `${qty} voucher(s) criado(s)` });
    toast.success(`${qty} voucher(s) criado(s)!`);
    setShowDialog(false);
    load();
    setSaving(false);
  };

  const handleDelete = async (v) => {
    if (!confirm(`Remover voucher ${v.code}?`)) return;
    await spedynet.entities.Voucher.delete(v.id);
    toast.success('Voucher removido');
    load();
  };

  const [copiedCode, setCopiedCode] = useState(null);
  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success(`Código ${code} copiado!`);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const stats = [
    { label: 'Disponíveis', value: vouchers.filter(v => v.status === 'available').length, color: 'text-success' },
    { label: 'Usados', value: vouchers.filter(v => v.status === 'used').length, color: 'text-muted-foreground' },
    { label: 'Expirados', value: vouchers.filter(v => v.status === 'expired').length, color: 'text-destructive' },
    { label: 'Total', value: vouchers.length, color: 'text-foreground' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4">
            <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar código ou usuário..." className="pl-9 bg-card border-border" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="available">Disponível</SelectItem>
            <SelectItem value="used">Usado</SelectItem>
            <SelectItem value="expired">Expirado</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={load} variant="outline" size="icon" className="border-border"><RefreshCw className="w-4 h-4" /></Button>
        <Button onClick={() => setShowDialog(true)} className="bg-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" />Gerar Vouchers
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Código</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Plano / Duração</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden lg:table-cell">Usado por</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden xl:table-cell">Expiração</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array(5).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array(6).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-secondary rounded animate-pulse" /></td>)}
                </tr>
              )) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground"><Ticket className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>Nenhum voucher encontrado</p></td></tr>
              ) : filtered.map(v => (
                <tr key={v.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-primary text-sm">{v.code}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyCode(v.code)}>
                        {copiedCode === v.code ? <CheckCircle className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <p className="text-xs text-foreground">{v.plan_name || '—'}</p>
                    <div className="flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3 text-muted-foreground" /><span className="text-xs text-muted-foreground font-mono">{v.duration_minutes}min</span></div>
                    {(v.download_mbps || v.upload_mbps) && <p className="text-[10px] text-muted-foreground font-mono">{v.download_mbps || 0}/{v.upload_mbps || 0} Mbps</p>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {v.used_by_name ? (
                      <div>
                        <p className="text-xs text-foreground">{v.used_by_name}</p>
                        <p className="text-[10px] text-muted-foreground">{v.used_by_email}</p>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell text-xs text-muted-foreground font-mono">
                    {v.expires_at ? format(new Date(v.expires_at), 'dd/MM/yy HH:mm', { locale: ptBR }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => handleDelete(v)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">{filtered.length} registro(s)</div>}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader><DialogTitle>Gerar Vouchers</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Plano (opcional)</Label>
              <Select value={form.plan_id} onValueChange={v => setForm({ ...form, plan_id: v })}>
                <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue placeholder="Selecionar plano" /></SelectTrigger>
                <SelectContent>{plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Duração (minutos)</Label>
              <Input value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })} className="bg-input border-border h-9 text-sm" type="number" min="1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Quantidade (máx. 100)</Label>
              <Input value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="bg-input border-border h-9 text-sm" type="number" min="1" max="100" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Observações</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-input border-border h-9 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving} className="bg-primary text-primary-foreground">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Gerar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
