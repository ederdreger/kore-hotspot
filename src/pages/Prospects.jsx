import { useState, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { UserSearch, Search, RefreshCw, Clock, Trash2, Edit, ArrowRight, Eye, Crown } from 'lucide-react';
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
  const [viewing, setViewing] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [form, setForm] = useState({ name: '', cpf: '', email: '', phone: '', city: '', status: 'new', notes: '' });

  const load = async () => {
    setLoading(true);
    const data = await spedynet.entities.Prospect.list('-created_date', 200);
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
      await spedynet.entities.Prospect.update(editing.id, form);
      toast.success('Prospecto atualizado!');
    }
    setShowDialog(false);
    load();
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
  };

  const remainingTime = (value) => {
    if (!value) return '-';
    const diff = new Date(value).getTime() - Date.now();
    if (diff <= 0) return 'Expirado';
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours > 0 ? `${hours}h ${rest}min` : `${Math.max(1, rest)}min`;
  };

  const runConfirmed = async () => {
    if (!confirmAction?.onConfirm) return;
    const action = confirmAction;
    setConfirmAction(null);
    await action.onConfirm();
  };

  const handleConvertNow = async (p) => {
    const client = await spedynet.entities.Client.create({
      name: p.name, cpf: p.cpf, email: p.email, phone: p.phone, city: p.city,
      plan_id: p.plan_id || '',
      plan_name: p.plan_name || '',
      plan_type: p.plan_type || '',
      download_mbps: Number(p.download_mbps || p.speed_download || 0),
      upload_mbps: Number(p.upload_mbps || p.speed_upload || 0),
      speed_download: Number(p.download_mbps || p.speed_download || 0),
      speed_upload: Number(p.upload_mbps || p.speed_upload || 0),
      quota_gb: Number(p.quota_gb || 0),
      status: 'active', source: 'captive_portal', notes: `Convertido de prospecto #${p.id}`
    });
    await spedynet.entities.Prospect.update(p.id, { status: 'converted', converted_to_client_id: client.id });
    await spedynet.entities.AuditLog.create({ action: 'convert_prospect', entity_type: 'prospect', entity_id: p.id, entity_name: p.name, status: 'success', message: `Prospecto ${p.name} convertido para cliente` });
    toast.success(`${p.name} convertido para cliente!`);
    load();
  };

  const handleConvert = (p) => {
    setConfirmAction({
      title: 'Converter prospecto?',
      description: `O prospecto ${p.name || 'selecionado'} sera criado como cliente ativo.`,
      confirmLabel: 'Converter',
      onConfirm: () => handleConvertNow(p),
    });
  };

  const handleDeleteNow = async (p) => {
    await spedynet.entities.Prospect.delete(p.id);
    toast.success('Removido');
    load();
  };

  const handleDelete = (p) => {
    setConfirmAction({
      title: 'Excluir prospecto?',
      description: `Esta acao remove ${p.name || 'este prospecto'} da lista de cadastros capturados.`,
      confirmLabel: 'Excluir',
      destructive: true,
      onConfirm: () => handleDeleteNow(p),
    });
  };

  const handleVipNow = async (p, enabled) => {
    if (!p.mac_address && !p.ip_address) {
      toast.error('Prospecto sem MAC/IP capturado. O dispositivo precisa acessar o hotspot antes do VIP.');
      return;
    }
    const result = await spedynet.functions.invoke('hotspotVipAccess', {
      entity: 'prospect',
      id: p.id || p._id,
      enabled,
      mac: p.mac_address,
      ip: p.ip_address,
    });
    const updated = result.data?.item || {};
    await spedynet.entities.Prospect.update(p.id || p._id, {
      vip_access: enabled,
      vip_enabled: enabled,
      vip_authorized_at: updated.vip_authorized_at,
      vip_removed_at: updated.vip_removed_at,
      vip_authorization: updated.vip_authorization,
      status: enabled ? 'active' : p.status,
    });
    toast.success(enabled ? 'VIP ativado e liberado no MikroTik' : 'VIP removido do MikroTik');
    load();
  };

  const handleVip = (p) => {
    const enabled = !(p.vip_access || p.vip_enabled);
    setConfirmAction({
      title: enabled ? 'Ativar VIP?' : 'Remover VIP?',
      description: enabled
        ? `${p.name || 'Este prospecto'} tera conexao liberada por tempo indeterminado ate a autorizacao ser removida.`
        : `${p.name || 'Este prospecto'} perdera a autorizacao VIP permanente no MikroTik.`,
      confirmLabel: enabled ? 'Ativar VIP' : 'Remover VIP',
      destructive: !enabled,
      onConfirm: () => handleVipNow(p, enabled),
    });
  };

  const detailRows = viewing ? [
    ['Nome', viewing.name],
    ['CPF', viewing.cpf],
    ['E-mail', viewing.email],
    ['Telefone', viewing.phone],
    ['Cidade', viewing.city],
    ['CEP', viewing.cep],
    ['Status', viewing.status],
    ['Trial liberado', viewing.trial_access ? 'Sim' : 'Nao'],
    ['VIP', viewing.vip_access || viewing.vip_enabled ? 'Ativo' : 'Nao'],
    ['VIP ativado em', formatDateTime(viewing.vip_authorized_at)],
    ['Plano', viewing.plan_name],
    ['Velocidade', viewing.download_mbps || viewing.upload_mbps ? `${viewing.download_mbps || 0}/${viewing.upload_mbps || 0} Mbps` : ''],
    ['Tempo restante', remainingTime(viewing.trial_expires_at)],
    ['Expira em', formatDateTime(viewing.trial_expires_at)],
    ['Usuario RADIUS', viewing.radius_username],
    ['MAC', viewing.mac_address],
    ['IP capturado', viewing.ip_address],
    ['Origem', viewing.source],
    ['Link de origem', viewing.link_orig],
    ['Criado em', formatDateTime(viewing.created_date)],
    ['Observacoes', viewing.notes],
  ] : [];

  const trialActive = prospects.filter(p => p.trial_access && new Date(p.trial_expires_at) > new Date()).length;
  const trialEnded = prospects.filter(p => p.trial_access && p.trial_expires_at && new Date(p.trial_expires_at) <= new Date()).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: prospects.length, color: 'text-foreground' },
          { label: 'Novos', value: prospects.filter(p => p.status === 'new').length, color: 'text-primary' },
          { label: 'Trial Ativo', value: trialActive, color: 'text-warning' },
          { label: 'Conexao Encerrada', value: trialEnded, color: 'text-destructive' },
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
                const isVip = p.vip_access || p.vip_enabled;
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
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={p.status} />
                        {(p.vip_access || p.vip_enabled) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">
                            <Crown className="w-3 h-3" /> VIP
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {isVip ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">
                          <Crown className="w-3 h-3" /> VIP indeterminado
                        </span>
                      ) : p.trial_access && !trialActive ? (
                        <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
                          Conexao encerrada
                        </span>
                      ) : p.trial_access ? (
                        <div className="flex items-center gap-1.5">
                          <Clock className={`w-3.5 h-3.5 ${trialActive ? 'text-warning' : 'text-muted-foreground'}`} />
                          <span className={`text-xs font-mono ${trialActive ? 'text-warning' : 'text-muted-foreground'}`}>
                            {trialExp ? format(trialExp, 'dd/MM HH:mm', { locale: ptBR }) : '—'}
                          </span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-xs text-muted-foreground">
                      {formatDateTime(p.created_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewing(p)} title="Visualizar cadastro">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 ${(p.vip_access || p.vip_enabled) ? 'text-warning hover:text-destructive' : 'hover:text-warning'}`}
                          onClick={() => handleVip(p)}
                          title={(p.vip_access || p.vip_enabled) ? 'Remover VIP' : 'Ativar VIP'}
                        >
                          <Crown className="w-3.5 h-3.5" />
                        </Button>
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

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader><DialogTitle>Dados do Prospecto</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {detailRows.map(([label, value]) => (
              <div key={label} className={label === 'Observacoes' || label === 'Link de origem' ? 'sm:col-span-2' : ''}>
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="min-h-9 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground break-words">
                  {value || '-'}
                </p>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button variant="outline" onClick={() => setViewing(null)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={runConfirmed}
              className={confirmAction?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {confirmAction?.confirmLabel || 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
