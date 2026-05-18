import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { UserSearch, Search, RefreshCw, UserPlus, Clock, Trash2, Edit, Megaphone, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Prospects() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', cpf: '', email: '', phone: '', city: '', status: 'new', notes: '' });

  const load = async () => {
    setLoading(true);
    const data = await base44.entities.Prospect.list('-created_date', 200);
    setProspects(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = prospects.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || p.cpf?.includes(q);
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openEdit = (p) => {
    setEditing(p);
    setForm({ name: p.name || '', cpf: p.cpf || '', email: p.email || '', phone: p.phone || '', city: p.city || '', status: p.status || 'new', notes: p.notes || '' });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (editing) {
      await base44.entities.Prospect.update(editing.id, form);
      toast.success('Prospecto atualizado!');
    }
    setShowDialog(false);
    load();
  };

  const handleConvert = async (p) => {
    const client = await base44.entities.Client.create({
      name: p.name, cpf: p.cpf, email: p.email, phone: p.phone, city: p.city,
      status: 'active', source: 'captive_portal', notes: `Convertido de prospecto #${p.id}`
    });
    await base44.entities.Prospect.update(p.id, { status: 'converted', converted_to_client_id: client.id });
    await base44.entities.AuditLog.create({ action: 'convert_prospect', entity_type: 'prospect', entity_id: p.id, entity_name: p.name, status: 'success', message: `Prospecto ${p.name} convertido para cliente` });
    toast.success(`${p.name} convertido para cliente!`);
    load();
  };

  const handleDelete = async (p) => {
    if (!confirm(`Remover prospecto ${p.name}?`)) return;
    await base44.entities.Prospect.delete(p.id);
    toast.success('Removido');
    load();
  };

  const trialActive = prospects.filter(p => p.trial_access && new Date(p.trial_expires_at) > new Date()).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: prospects.length, color: 'text-foreground' },
          { label: 'Novos', value: prospects.filter(p => p.status === 'new').length, color: 'text-primary' },
          { label: 'Trial Ativo', value: trialActive, color: 'text-warning' },
          { label: 'Convertidos', value: prospects.filter(p => p.status === 'converted').length, color: 'text-success' },
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
          <Input placeholder="Buscar prospecto..." className="pl-9 bg-card border-border" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="new">Novo</SelectItem>
            <SelectItem value="contacted">Contatado</SelectItem>
            <SelectItem value="converted">Convertido</SelectItem>
            <SelectItem value="lost">Perdido</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={load} variant="outline" size="icon" className="border-border"><RefreshCw className="w-4 h-4" /></Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Prospecto</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Contato</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden lg:table-cell">Trial</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase hidden xl:table-cell">Cadastro</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array(5).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array(6).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-secondary rounded animate-pulse" /></td>)}
                </tr>
              )) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground"><UserSearch className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>Nenhum prospecto</p></td></tr>
              ) : filtered.map(p => {
                const trialExp = p.trial_expires_at ? new Date(p.trial_expires_at) : null;
                const trialActive = trialExp && trialExp > new Date();
                return (
                  <tr key={p.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
                          {p.name?.charAt(0).toUpperCase()}
                        </div>
                        <div><p className="font-medium text-foreground text-sm">{p.name}</p><p className="text-xs text-muted-foreground">{p.city || '—'}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-xs text-foreground">{p.email}</p>
                      <p className="text-xs text-muted-foreground font-mono">{p.phone || '—'}</p>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {p.trial_access ? (
                        <div className="flex items-center gap-1.5">
                          <Clock className={`w-3.5 h-3.5 ${trialActive ? 'text-warning' : 'text-muted-foreground'}`} />
                          <span className={`text-xs font-mono ${trialActive ? 'text-warning' : 'text-muted-foreground'}`}>
                            {trialExp ? format(trialExp, 'dd/MM HH:mm', { locale: ptBR }) : '—'}
                          </span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-xs text-muted-foreground">
                      {format(new Date(p.created_date), 'dd/MM/yy HH:mm', { locale: ptBR })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {p.status !== 'converted' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-success" onClick={() => handleConvert(p)} title="Converter para cliente">
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => handleDelete(p)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">{filtered.length} registro(s)</div>}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle>Editar Prospecto</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[['name','Nome',2],['email','E-mail',2],['cpf','CPF',1],['phone','Telefone',1],['city','Cidade',2]].map(([field,label,cols]) => (
              <div key={field} className={cols === 2 ? 'col-span-2' : ''}>
                <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
                <Input value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} className="bg-input border-border h-9 text-sm" />
              </div>
            ))}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Novo</SelectItem>
                  <SelectItem value="contacted">Contatado</SelectItem>
                  <SelectItem value="converted">Convertido</SelectItem>
                  <SelectItem value="lost">Perdido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Cidade</Label>
              <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="bg-input border-border h-9 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleSave} className="bg-primary text-primary-foreground">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}