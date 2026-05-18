import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Zap, Trash2, Edit, RefreshCw, ArrowDown, ArrowUp,
  Clock, Wifi, Users, DollarSign, ChevronRight, CheckCircle, AlertCircle
} from 'lucide-react';

const emptyForm = {
  name: '',
  description: '',
  download_mbps: '',
  upload_mbps: '',
  burst_download_mbps: '',
  burst_upload_mbps: '',
  burst_threshold_mbps: '',
  burst_time_seconds: '10',
  quota_gb: '0',
  validity_days: '30',
  price: '0',
  mikrotik_profile_name: '',
  radius_group: '',
  priority: '8',
  is_trial: false,
  trial_duration_minutes: '30',
  status: 'active',
  color: '#00E5FF',
};

function PlanCard({ plan, clients, onEdit, onDelete }) {
  const clientCount = clients.filter(c => c.plan_id === plan.id).length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-all group relative">
      {/* Color stripe */}
      <div className="h-1 w-full" style={{ background: plan.color || '#00E5FF' }} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-foreground">{plan.name}</h3>
              {plan.is_trial && (
                <span className="px-1.5 py-0.5 text-[9px] rounded bg-warning/10 text-warning border border-warning/20 font-bold tracking-wide">TRIAL</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{plan.description || 'Sem descrição'}</p>
          </div>
          <StatusBadge status={plan.status} />
        </div>

        {/* Speed badges */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-secondary/60 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <ArrowDown className="w-3 h-3 text-primary" />
              <span className="text-[10px] text-muted-foreground">Download</span>
            </div>
            <p className="text-xl font-bold font-mono text-foreground leading-none">
              {plan.download_mbps}<span className="text-xs font-normal text-muted-foreground ml-0.5">M</span>
            </p>
          </div>
          <div className="bg-secondary/60 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <ArrowUp className="w-3 h-3 text-success" />
              <span className="text-[10px] text-muted-foreground">Upload</span>
            </div>
            <p className="text-xl font-bold font-mono text-foreground leading-none">
              {plan.upload_mbps}<span className="text-xs font-normal text-muted-foreground ml-0.5">M</span>
            </p>
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3 flex-wrap gap-1">
          <span className="flex items-center gap-1">
            <Wifi className="w-3 h-3" />
            {plan.quota_gb > 0 ? `${plan.quota_gb}GB` : '∞ ilimitado'}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {plan.validity_days}d validade
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {clientCount} cliente{clientCount !== 1 ? 's' : ''}
          </span>
          {plan.price > 0 && (
            <span className="flex items-center gap-1 text-success font-medium">
              <DollarSign className="w-3 h-3" />
              R$ {Number(plan.price).toFixed(2)}
            </span>
          )}
        </div>

        {/* Trial info */}
        {plan.is_trial && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-warning/5 border border-warning/20 mb-3 text-xs text-warning">
            <Clock className="w-3 h-3 flex-shrink-0" />
            Trial: {plan.trial_duration_minutes} minutos de acesso gratuito
          </div>
        )}

        {/* Profile tags */}
        {(plan.mikrotik_profile_name || plan.radius_group) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {plan.mikrotik_profile_name && (
              <span className="px-2 py-0.5 text-[10px] rounded bg-info/10 text-info border border-info/20 font-mono">
                MK: {plan.mikrotik_profile_name}
              </span>
            )}
            {plan.radius_group && (
              <span className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary border border-primary/20 font-mono">
                R: {plan.radius_group}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-1 pt-2 border-t border-border">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onEdit(plan)}>
            <Edit className="w-3.5 h-3.5" /> Editar
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs hover:text-destructive" onClick={() => onDelete(plan)}>
            <Trash2 className="w-3.5 h-3.5" /> Remover
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function HotspotPlans() {
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [filter, setFilter] = useState('all'); // all | active | trial

  const load = async () => {
    setLoading(true);
    const [p, c] = await Promise.all([
      base44.entities.Plan.list('-created_date'),
      base44.entities.Client.list(),
    ]);
    setPlans(p);
    setClients(c);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowDialog(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      ...emptyForm,
      ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, p[k] !== undefined ? String(p[k]) : emptyForm[k]])),
      is_trial: p.is_trial || false,
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const data = {
      ...form,
      download_mbps: Number(form.download_mbps),
      upload_mbps: Number(form.upload_mbps),
      burst_download_mbps: Number(form.burst_download_mbps) || 0,
      burst_upload_mbps: Number(form.burst_upload_mbps) || 0,
      burst_threshold_mbps: Number(form.burst_threshold_mbps) || 0,
      burst_time_seconds: Number(form.burst_time_seconds) || 10,
      quota_gb: Number(form.quota_gb) || 0,
      validity_days: Number(form.validity_days) || 30,
      price: Number(form.price) || 0,
      priority: Number(form.priority) || 8,
      trial_duration_minutes: Number(form.trial_duration_minutes) || 30,
    };

    if (editing) {
      await base44.entities.Plan.update(editing.id, data);
    } else {
      await base44.entities.Plan.create(data);
    }

    setSaveMsg({ type: 'success', text: editing ? 'Plano atualizado com sucesso!' : 'Plano criado com sucesso!' });
    setTimeout(() => setSaveMsg(null), 3000);
    setShowDialog(false);
    load();
    setSaving(false);
  };

  const handleDelete = async (p) => {
    if (!confirm(`Remover plano "${p.name}"? Clientes vinculados não serão afetados.`)) return;
    await base44.entities.Plan.delete(p.id);
    setSaveMsg({ type: 'success', text: 'Plano removido.' });
    setTimeout(() => setSaveMsg(null), 3000);
    load();
  };

  const filtered = plans.filter(p => {
    if (filter === 'active') return p.status === 'active' && !p.is_trial;
    if (filter === 'trial') return p.is_trial;
    return true;
  });

  const activePlans = plans.filter(p => p.status === 'active').length;
  const trialPlans = plans.filter(p => p.is_trial).length;
  const totalClients = clients.length;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total de Planos', value: plans.length, icon: Zap, color: 'text-primary' },
          { label: 'Planos Ativos', value: activePlans, icon: CheckCircle, color: 'text-success' },
          { label: 'Planos Trial', value: trialPlans, icon: Clock, color: 'text-warning' },
          { label: 'Clientes Vinculados', value: totalClients, icon: Users, color: 'text-info' },
        ].map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <div>
              <p className="text-xl font-bold font-mono text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-secondary p-1 rounded-lg">
          {[['all', 'Todos'], ['active', 'Ativos'], ['trial', 'Trial']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === v ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="icon" className="border-border h-9 w-9">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground gap-2 h-9">
            <Plus className="w-4 h-4" /> Novo Plano
          </Button>
        </div>
      </div>

      {/* Feedback */}
      {saveMsg && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${saveMsg.type === 'success' ? 'bg-success/10 border border-success/30 text-success' : 'bg-destructive/10 border border-destructive/30 text-destructive'}`}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {saveMsg.text}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => <div key={i} className="h-64 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Zap className="w-12 h-12 mb-3 opacity-20" />
          <p className="font-medium text-foreground">Nenhum plano encontrado</p>
          <p className="text-xs mt-1">
            {filter !== 'all' ? 'Altere o filtro ou crie um novo plano' : 'Crie seu primeiro plano de velocidade hotspot'}
          </p>
          {filter === 'all' && (
            <Button onClick={openCreate} className="mt-4 bg-primary text-primary-foreground gap-2" size="sm">
              <Plus className="w-4 h-4" /> Criar Plano
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <PlanCard key={p.id} plan={p} clients={clients} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Modal */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              {editing ? 'Editar Plano' : 'Novo Plano Hotspot'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Básico */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Identificação</p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Nome do Plano *</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-input border-border h-9 text-sm" placeholder="Ex: Plano 10 Mega" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Descrição</Label>
                  <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-input border-border h-9 text-sm" placeholder="Descrição opcional" />
                </div>
              </div>
            </div>

            {/* Velocidade */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Velocidade</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Download (Mbps) *</Label>
                  <Input type="number" value={form.download_mbps} onChange={e => setForm({ ...form, download_mbps: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" placeholder="10" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Upload (Mbps) *</Label>
                  <Input type="number" value={form.upload_mbps} onChange={e => setForm({ ...form, upload_mbps: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" placeholder="5" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Burst Download</Label>
                  <Input type="number" value={form.burst_download_mbps} onChange={e => setForm({ ...form, burst_download_mbps: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Burst Upload</Label>
                  <Input type="number" value={form.burst_upload_mbps} onChange={e => setForm({ ...form, burst_upload_mbps: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Burst Threshold</Label>
                  <Input type="number" value={form.burst_threshold_mbps} onChange={e => setForm({ ...form, burst_threshold_mbps: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Burst Time (s)</Label>
                  <Input type="number" value={form.burst_time_seconds} onChange={e => setForm({ ...form, burst_time_seconds: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" />
                </div>
              </div>
            </div>

            {/* Limites e Preço */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Limites & Preço</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Quota (GB, 0 = ilimitado)</Label>
                  <Input type="number" value={form.quota_gb} onChange={e => setForm({ ...form, quota_gb: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Validade (dias)</Label>
                  <Input type="number" value={form.validity_days} onChange={e => setForm({ ...form, validity_days: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Preço (R$)</Label>
                  <Input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Prioridade (1-10)</Label>
                  <Input type="number" min="1" max="10" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" />
                </div>
              </div>
            </div>

            {/* Integração */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Integração</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Perfil MikroTik</Label>
                  <Input value={form.mikrotik_profile_name} onChange={e => setForm({ ...form, mikrotik_profile_name: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" placeholder="hotspot-10m" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Grupo RADIUS</Label>
                  <Input value={form.radius_group} onChange={e => setForm({ ...form, radius_group: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" placeholder="plano-10m" />
                </div>
              </div>
            </div>

            {/* Aparência e Status */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Aparência</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Status</Label>
                  <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                    <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Cor do Plano</Label>
                  <div className="flex gap-2">
                    <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-9 w-12 rounded border border-border bg-input cursor-pointer" />
                    <Input value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" />
                  </div>
                </div>
              </div>
            </div>

            {/* Trial */}
            <div className="p-4 bg-secondary/50 rounded-xl border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Plano Trial / Gratuito</p>
                  <p className="text-xs text-muted-foreground">Liberação temporária sem cadastro de pagamento</p>
                </div>
                <Switch checked={form.is_trial} onCheckedChange={v => setForm({ ...form, is_trial: v })} />
              </div>
              {form.is_trial && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Duração Trial (minutos)</Label>
                  <Input type="number" min="1" value={form.trial_duration_minutes} onChange={e => setForm({ ...form, trial_duration_minutes: e.target.value })} className="bg-input border-border h-9 text-sm font-mono w-40" />
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name || !form.download_mbps || !form.upload_mbps}
              className="bg-primary text-primary-foreground gap-2"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {saving ? 'Salvando...' : editing ? 'Salvar Alterações' : 'Criar Plano'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}