import { useEffect, useState } from 'react';
import { Building2, Plus, RefreshCw, Edit2, Trash2, X, CheckCircle, Globe2, Users, Server, CreditCard, QrCode, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const emptyForm = {
  name: '',
  tenant_id: '',
  domain: '',
  legal_name: '',
  document: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  commercial_plan: 'starter',
  status: 'active',
  monthly_price: '',
  contract_due_date: '',
  grace_days: '5',
  last_payment_date: '',
  block_on_overdue: true,
  max_clients: '',
  max_mikrotiks: '',
  notes: ''
};

const statusLabel = {
  active: 'Ativo',
  trial: 'Teste',
  suspended: 'Suspenso',
  canceled: 'Cancelado'
};

const statusClass = {
  active: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  trial: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  suspended: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  canceled: 'bg-red-500/10 text-red-500 border-red-500/20'
};

export default function Providers() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [pixResult, setPixResult] = useState(null);
  const [checkingPix, setCheckingPix] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await spedynet.functions.invoke('providersManager', { action: 'list' });
      setProviders(res.data.providers || []);
    } catch (error) {
      toast.error(error.message || 'Erro ao carregar provedores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (provider) => {
    setEditing(provider);
    setForm({
      ...emptyForm,
      ...provider,
      max_clients: provider.max_clients || '',
      max_mikrotiks: provider.max_mikrotiks || '',
      monthly_price: provider.monthly_price || '',
      contract_due_date: provider.contract_due_date || '',
      grace_days: provider.grace_days ?? '5',
      last_payment_date: provider.last_payment_date || '',
      block_on_overdue: provider.block_on_overdue !== false
    });
    setShowForm(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await spedynet.functions.invoke('providersManager', {
        ...form,
        action: editing ? 'update' : 'create',
        id: editing?.id || editing?._id || editing?.tenant_id
      });
      toast.success(editing ? 'Provedor atualizado' : 'Provedor criado');
      closeForm();
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao salvar provedor');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (provider) => {
    if (!window.confirm(`Excluir o provedor ${provider.name}? Os dados do tenant serao preservados no servidor.`)) return;
    try {
      await spedynet.functions.invoke('providersManager', { action: 'delete', id: provider.id || provider.tenant_id });
      toast.success('Provedor removido da lista');
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao excluir provedor');
    }
  };

  const markPaid = async (provider) => {
    if (!window.confirm(`Registrar pagamento mensal de ${provider.name}?`)) return;
    try {
      await spedynet.functions.invoke('providersManager', {
        id: provider.id || provider.tenant_id,
        action: 'markPaid',
        last_payment_date: new Date().toISOString().slice(0, 10),
        months: 1
      });
      toast.success('Pagamento registrado e vencimento renovado');
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao registrar pagamento');
    }
  };

  const createPix = async (provider) => {
    try {
      const res = await spedynet.functions.invoke('providersManager', {
        id: provider.id || provider.tenant_id,
        action: 'createPix'
      });
      setPixResult({ provider, billing: res.data.billing });
      toast.success('Pix gerado para a mensalidade do provedor');
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao gerar Pix');
    }
  };

  const checkPix = async () => {
    if (!pixResult?.billing) return;
    setCheckingPix(true);
    try {
      const res = await spedynet.functions.invoke('providersManager', {
        id: pixResult.provider?.id || pixResult.provider?.tenant_id || pixResult.billing.provider_id,
        action: 'checkPix',
        billing_id: pixResult.billing.id,
        provider_payment_id: pixResult.billing.provider_payment_id
      });
      setPixResult({ provider: res.data.provider || pixResult.provider, billing: res.data.billing });
      toast.success(res.data.billing?.status === 'approved' ? 'Pagamento aprovado e provedor renovado' : 'Pagamento consultado');
      load();
    } catch (error) {
      toast.error(error.message || 'Erro ao consultar Pix');
    } finally {
      setCheckingPix(false);
    }
  };

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(pixResult?.billing?.qr_code || '');
      toast.success('Codigo Pix copiado');
    } catch {
      toast.error('Nao foi possivel copiar o codigo Pix');
    }
  };

  const isOverdue = (provider) => {
    if (!provider.contract_due_date) return false;
    const grace = Number(provider.grace_days || 0);
    const due = new Date(`${provider.contract_due_date}T23:59:59`);
    const limit = new Date(due.getTime() + grace * 24 * 60 * 60 * 1000);
    return new Date() > limit && provider.block_on_overdue !== false;
  };

  const renderForm = () => (
    <form onSubmit={save} className="p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Nome do provedor</Label>
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Tenant ID</Label>
          <Input value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })} disabled={!!editing} placeholder="provedor-a" className="bg-input border-border h-9 font-mono" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Dominio</Label>
          <Input value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} placeholder="wifi.provedor.com.br" className="bg-input border-border h-9 font-mono" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Status</Label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground">
            <option value="active">Ativo</option>
            <option value="trial">Teste</option>
            <option value="suspended">Suspenso</option>
            <option value="canceled">Cancelado</option>
          </select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Responsavel</Label>
          <Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">E-mail</Label>
          <Input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Telefone</Label>
          <Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Plano comercial</Label>
          <select value={form.commercial_plan} onChange={e => setForm({ ...form, commercial_plan: e.target.value })} className="w-full h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground">
            <option value="starter">Starter</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Mensalidade (R$)</Label>
          <Input type="number" step="0.01" value={form.monthly_price} onChange={e => setForm({ ...form, monthly_price: e.target.value })} className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Vencimento do contrato</Label>
          <Input type="date" value={form.contract_due_date} onChange={e => setForm({ ...form, contract_due_date: e.target.value })} className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Dias de tolerancia</Label>
          <Input type="number" value={form.grace_days} onChange={e => setForm({ ...form, grace_days: e.target.value })} className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Ultimo pagamento</Label>
          <Input type="date" value={form.last_payment_date} onChange={e => setForm({ ...form, last_payment_date: e.target.value })} className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Limite de clientes</Label>
          <Input type="number" value={form.max_clients} onChange={e => setForm({ ...form, max_clients: e.target.value })} placeholder="0 = ilimitado" className="bg-input border-border h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Limite de MikroTiks</Label>
          <Input type="number" value={form.max_mikrotiks} onChange={e => setForm({ ...form, max_mikrotiks: e.target.value })} placeholder="0 = ilimitado" className="bg-input border-border h-9" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={form.block_on_overdue !== false} onChange={e => setForm({ ...form, block_on_overdue: e.target.checked })} className="accent-primary" />
        Bloquear automaticamente apos vencer o periodo de tolerancia
      </label>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">Observacoes</Label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full min-h-20 rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={closeForm}>Cancelar</Button>
        <Button type="submit" disabled={saving} className="gap-2">{saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Salvar</Button>
      </div>
    </form>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><Building2 className="w-5 h-5 text-primary" /> Provedores</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gerencie tenants, dominios, limites e status comercial dos provedores.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" /> Atualizar</Button>
          <Button size="sm" onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Novo Provedor</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Provedores ativos</p><p className="text-2xl font-bold text-foreground">{providers.filter(p => p.status === 'active').length}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Em teste</p><p className="text-2xl font-bold text-foreground">{providers.filter(p => p.status === 'trial').length}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Clientes totais</p><p className="text-2xl font-bold text-foreground">{providers.reduce((sum, p) => sum + Number(p.stats?.clients || 0), 0)}</p></div>
        <div className="rounded-xl border border-border bg-card p-4 md:col-span-3"><p className="text-xs text-muted-foreground">Receita mensal prevista</p><p className="text-2xl font-bold text-foreground">R$ {providers.reduce((sum, p) => sum + Number(p.monthly_price || 0), 0).toFixed(2)}</p></div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/30">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Provedores cadastrados ({providers.length})</p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : providers.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Nenhum provedor cadastrado</div>
        ) : providers.map((provider) => (
          <div key={provider.id || provider.tenant_id} className={`grid grid-cols-12 gap-3 items-center px-4 py-4 border-b border-border last:border-0 ${['suspended', 'canceled'].includes(provider.status) || isOverdue(provider) ? 'bg-destructive/5' : ''}`}>
            <div className="col-span-12 md:col-span-4 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{provider.name}</p>
              <p className="text-xs text-muted-foreground font-mono truncate">{provider.tenant_id}</p>
            </div>
            <div className="col-span-12 md:col-span-3 text-xs text-muted-foreground min-w-0">
              <p className="flex items-center gap-1 truncate"><Globe2 className="w-3 h-3" /> {provider.domain || '-'}</p>
              <p className="truncate">{provider.contact_email || provider.contact_phone || '-'}</p>
              <p className={isOverdue(provider) ? 'text-destructive font-medium' : ''}>Vence: {provider.contract_due_date || '-'}</p>
            </div>
            <div className="col-span-6 md:col-span-2 flex gap-3 text-xs text-muted-foreground">
              <span className={`flex items-center gap-1 ${provider.max_clients && provider.stats?.clients >= provider.max_clients ? 'text-warning' : ''}`}><Users className="w-3 h-3" /> {provider.stats?.clients || 0}/{provider.max_clients || '∞'}</span>
              <span className={`flex items-center gap-1 ${provider.max_mikrotiks && provider.stats?.mikrotiks >= provider.max_mikrotiks ? 'text-warning' : ''}`}><Server className="w-3 h-3" /> {provider.stats?.mikrotiks || 0}/{provider.max_mikrotiks || '∞'}</span>
            </div>
            <div className="col-span-4 md:col-span-2">
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass[provider.status] || statusClass.active}`}>{statusLabel[provider.status] || provider.status}</span>
            </div>
            <div className="col-span-2 md:col-span-1 flex justify-end gap-1">
              <button onClick={() => createPix(provider)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary" title="Gerar Pix"><QrCode className="w-3.5 h-3.5" /></button>
              <button onClick={() => markPaid(provider)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-success" title="Registrar pagamento"><CreditCard className="w-3.5 h-3.5" /></button>
              <button onClick={() => openEdit(provider)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary" title="Editar"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => remove(provider)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-destructive" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-sm">{editing ? 'Editar provedor' : 'Novo provedor'}</h3>
              <button onClick={closeForm} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            {renderForm()}
          </div>
        </div>
      )}

      {pixResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2"><QrCode className="w-4 h-4 text-primary" /> Pix da mensalidade</h3>
                <p className="text-xs text-muted-foreground">{pixResult.provider?.name || pixResult.billing?.provider_name}</p>
              </div>
              <button onClick={() => setPixResult(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">Valor</p>
                  <p className="font-bold text-foreground">R$ {Number(pixResult.billing?.amount || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-bold text-foreground">{pixResult.billing?.status || '-'}</p>
                </div>
              </div>
              {pixResult.billing?.qr_code_base64 && (
                <div className="flex justify-center rounded-xl border border-border bg-white p-4">
                  <img alt="QR Code Pix" className="h-52 w-52 object-contain" src={`data:image/png;base64,${pixResult.billing.qr_code_base64}`} />
                </div>
              )}
              {pixResult.billing?.qr_code && (
                <div className="rounded-lg border border-border bg-input p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Pix copia e cola</p>
                  <p className="max-h-24 overflow-auto break-all font-mono text-xs text-foreground">{pixResult.billing.qr_code}</p>
                  <Button type="button" variant="outline" size="sm" onClick={copyPix} className="mt-3 gap-2"><Copy className="w-4 h-4" /> Copiar</Button>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPixResult(null)}>Fechar</Button>
                <Button type="button" onClick={checkPix} disabled={checkingPix} className="gap-2">
                  {checkingPix ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Consultar pagamento
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
