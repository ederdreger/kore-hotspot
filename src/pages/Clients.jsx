import { useState, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Search, RefreshCw, UserCheck, Trash2, Edit, Network, EyeOff, Eye, Crown } from 'lucide-react';
import { toast } from 'sonner';

const emptyForm = { name: '', cpf: '', email: '', phone: '', city: '', address: '', plan_id: '', status: 'active', notes: '', source: 'manual', mikrotikId: 'none', username: '', password: '' };

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [mikrotiks, setMikrotiks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const load = async () => {
    setLoading(true);
    const [cls, pls, mtiksRaw] = await Promise.all([
      spedynet.entities.Client.list('-created_date', 200),
      spedynet.entities.Plan.filter({ status: 'active' }),
      spedynet.entities.Setting.filter({ category: 'mikrotik_device' })
    ]);
    const mtiks = mtiksRaw.map(s => {
      try { return { id: s.id, ...JSON.parse(s.value) }; } catch { return null; }
    }).filter(Boolean);
    setClients(cls);
    setPlans(pls);
    setMikrotiks(mtiks);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.name?.toLowerCase().includes(q) || c.cpf?.includes(q) || c.email?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const openCreate = () => { 
    setEditing(null); 
    setForm({ ...emptyForm, mikrotikId: mikrotiks.length > 0 ? mikrotiks[0].id : 'none' }); 
    setShowDialog(true); 
  };
  const openEdit = (c) => {
    setEditing(c);
    setForm({ ...emptyForm, ...c });
    setShowDialog(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const plan = plans.find(p => p.id === form.plan_id);
    const username = form.username || form.cpf || (form.email ? form.email.split('@')[0] : form.name.toLowerCase().replace(/\s+/g, ''));
    
    const data = { 
      ...form, 
      plan_name: plan?.name || '', 
      plan_type: plan?.plan_type || (plan?.is_trial ? 'trial' : Number(plan?.price || 0) > 0 ? 'paid' : 'free'),
      download_mbps: Number(plan?.download_mbps || plan?.speed_download || 0),
      upload_mbps: Number(plan?.upload_mbps || plan?.speed_upload || 0),
      speed_download: Number(plan?.download_mbps || plan?.speed_download || 0),
      speed_upload: Number(plan?.upload_mbps || plan?.speed_upload || 0),
      quota_gb: Number(plan?.quota_gb || 0),
      mikrotik_profile: plan?.mikrotik_profile_name || 'default', 
      radius_username: username, 
      radius_password: form.password || '',
      provisioned_at: new Date().toISOString() 
    };
    
    try {
      if (editing) {
        await spedynet.entities.Client.update(editing.id, data);
        await spedynet.entities.AuditLog.create({ action: 'update_client', entity_type: 'client', entity_id: editing.id, entity_name: form.name, status: 'success', message: `Cliente ${form.name} atualizado` });
        toast.success('Cliente atualizado!');
      } else {
        const c = await spedynet.entities.Client.create(data);
        await spedynet.entities.AuditLog.create({ action: 'create_client', entity_type: 'client', entity_id: c.id, entity_name: form.name, status: 'success', message: `Cliente ${form.name} criado` });
        
        if (form.mikrotikId && form.mikrotikId !== 'none') {
          const mtik = mikrotiks.find(m => m.id === form.mikrotikId);
          if (mtik) {
            await spedynet.functions.invoke('mikrotikAddUser', {
              host: mtik.host,
              port: mtik.port,
              user: mtik.user,
              password: mtik.password,
              username: username,
              userPassword: form.password,
              profile: plan?.mikrotik_profile_name || 'default',
              server: 'all'
            });
            await spedynet.entities.AuditLog.create({ action: 'provision_mikrotik', entity_type: 'mikrotik', entity_id: c.id, entity_name: c.name, status: 'success', message: `Provisionamento MikroTik SSH: ${form.name}` });
            toast.success('Cliente criado e provisionado via SSH!');
          }
        } else {
          toast.success('Cliente criado!');
        }
      }
      setShowDialog(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || 'Erro ao salvar cliente');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c) => {
    if (!confirm(`Remover ${c.name}?`)) return;
    try {
      await spedynet.entities.Client.delete(c.id || c._id);
      await spedynet.entities.AuditLog.create({ action: 'delete_client', entity_type: 'client', entity_id: c.id || c._id, entity_name: c.name, status: 'warning', message: `Cliente ${c.name} removido` });
      toast.success('Cliente removido');
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao remover cliente');
    }
  };

  const handleToggleStatus = async (c) => {
    const inactive = ['inactive', 'suspended', 'blocked'].includes(c.status);
    const nextStatus = inactive ? 'active' : 'inactive';
    const label = inactive ? 'reativar' : 'desativar';
    if (!confirm(`Deseja ${label} ${c.name}?`)) return;
    try {
      await spedynet.entities.Client.update(c.id || c._id, { status: nextStatus });
      await spedynet.entities.AuditLog.create({ action: `${label}_client`, entity_type: 'client', entity_id: c.id || c._id, entity_name: c.name, status: 'warning', message: `Cliente ${c.name} ${inactive ? 'reativado' : 'desativado'}` });
      toast.success(inactive ? 'Cliente reativado' : 'Cliente desativado');
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao atualizar status');
    }
  };

  const handleToggleVip = async (c) => {
    const enabled = !(c.vip_access || c.vip_enabled);
    const label = enabled ? 'ativar VIP' : 'remover VIP';
    if (!c.mac_address && !c.ip_address) {
      toast.error('Cliente sem MAC/IP capturado. Conecte o cliente ao hotspot uma vez antes de liberar VIP.');
      return;
    }
    if (!confirm(`Deseja ${label} para ${c.name}?`)) return;
    try {
      const result = await spedynet.functions.invoke('hotspotVipAccess', {
        entity: 'client',
        id: c.id || c._id,
        enabled,
        mac: c.mac_address,
        ip: c.ip_address,
      });
      const updated = result.data?.item || {};
      await spedynet.entities.Client.update(c.id || c._id, {
        vip_access: enabled,
        vip_enabled: enabled,
        vip_authorized_at: updated.vip_authorized_at,
        vip_removed_at: updated.vip_removed_at,
        vip_authorization: updated.vip_authorization,
        status: enabled ? 'active' : c.status,
      });
      await spedynet.entities.AuditLog.create({
        action: enabled ? 'enable_client_vip' : 'disable_client_vip',
        entity_type: 'client',
        entity_id: c.id || c._id,
        entity_name: c.name,
        status: 'success',
        message: enabled ? `VIP permanente ativado para ${c.name}` : `VIP removido para ${c.name}`
      });
      toast.success(enabled ? 'VIP ativado e liberado no MikroTik' : 'VIP removido do MikroTik');
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao atualizar VIP');
    }
  };

  const handleProvision = async (c) => {
    await spedynet.entities.AuditLog.create({ action: 'provision_mikrotik', entity_type: 'mikrotik', entity_id: c.id, entity_name: c.name, status: 'success', message: `Provisionamento MikroTik iniciado para ${c.name} — perfil: ${c.mikrotik_profile || 'default'}` });
    toast.success(`Provisionamento enviado para MikroTik: ${c.name}`);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, CPF ou e-mail..." className="pl-9 bg-card border-border" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
            <SelectItem value="suspended">Suspensos</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={load} variant="outline" size="icon" className="border-border"><RefreshCw className="w-4 h-4" /></Button>
        <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="w-4 h-4" />Novo Cliente
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">CPF / Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Plano</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden xl:table-cell">RADIUS</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array(6).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-secondary rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground"><UserCheck className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>Nenhum cliente encontrado</p></td></tr>
              ) : paginated.map(c => (
                <tr key={c.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                        {c.name?.charAt(0).toUpperCase()}
                      </div>
                      <div><p className="font-medium text-foreground text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.city || '—'}</p></div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <p className="font-mono text-xs text-foreground">{c.cpf || '—'}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="space-y-1">
                      <span className="px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-xs text-primary font-medium">{c.plan_name || '—'}</span>
                      {(c.download_mbps || c.upload_mbps) && (
                        <p className="text-[10px] text-muted-foreground font-mono">{c.download_mbps || 0}/{c.upload_mbps || 0} Mbps</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={c.status} />
                      {(c.vip_access || c.vip_enabled) && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">
                          <Crown className="w-3 h-3" /> VIP
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell font-mono text-xs text-muted-foreground">{c.radius_username || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleProvision(c)} title="Provisionar MikroTik">
                        <Network className="w-3.5 h-3.5 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-7 w-7 ${(c.vip_access || c.vip_enabled) ? 'text-warning hover:text-destructive' : 'hover:text-warning'}`}
                        onClick={() => handleToggleVip(c)}
                        title={(c.vip_access || c.vip_enabled) ? 'Remover VIP' : 'Ativar VIP'}
                      >
                        <Crown className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-warning" onClick={() => handleToggleStatus(c)} title={['inactive', 'suspended', 'blocked'].includes(c.status) ? 'Reativar cliente' : 'Desativar cliente'}>
                        {['inactive', 'suspended', 'blocked'].includes(c.status) ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => handleDelete(c)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && (
          <div className="px-4 py-2 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{filtered.length} registro(s) · página {page} de {totalPages} · 20 por página</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Próxima</Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {!editing && (
              <div className="col-span-2 p-4 bg-primary/5 border border-primary/20 rounded-xl mb-2">
                <Label className="text-sm text-primary font-bold mb-3 flex items-center gap-2"><Network className="w-4 h-4"/> Integração MikroTik (Cadastro Rápido)</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground mb-1 block">Equipamento</Label>
                    <Select value={form.mikrotikId} onValueChange={v => setForm({ ...form, mikrotikId: v })}>
                      <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue placeholder="Não provisionar automaticamente" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Somente no Banco de Dados (Sem SSH)</SelectItem>
                        {mikrotiks.map(m => <SelectItem key={m.id} value={m.id}>{m.name} ({m.host})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Usuário Hotspot (Login)</Label>
                    <Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="Deixar vazio gera auto" className="bg-input border-border h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Senha Hotspot</Label>
                    <Input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Ex: 123456" className="bg-input border-border h-9 text-sm" />
                  </div>
                </div>
              </div>
            )}
            
            {[['name','Nome Completo',true,1],['cpf','CPF (opcional)',false,1],['email','E-mail (opcional)',false,1],['phone','Telefone',false,1]].map(([field, label, req, cols]) => (
              <div key={field} className={cols === 2 ? 'col-span-2' : ''}>
                <Label className="text-xs text-muted-foreground mb-1 block">{label}{req && ' *'}</Label>
                <Input value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} className="bg-input border-border h-9 text-sm" />
              </div>
            ))}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Velocidade / Plano *</Label>
              <Select value={form.plan_id} onValueChange={v => setForm({ ...form, plan_id: v })}>
                <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue placeholder="Selecionar plano" /></SelectTrigger>
                <SelectContent>{plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                  <SelectItem value="suspended">Suspenso</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.plan_id} className="bg-primary text-primary-foreground">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : editing ? 'Salvar' : 'Criar & Provisionar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
