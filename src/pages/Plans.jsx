import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Zap, Trash2, Edit, RefreshCw, ArrowDown, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';

const emptyForm = { name: '', description: '', download_mbps: '', upload_mbps: '', burst_download_mbps: '', burst_upload_mbps: '', burst_threshold_mbps: '', burst_time_seconds: '10', quota_gb: '0', validity_days: '30', price: '', mikrotik_profile_name: '', radius_group: '', priority: '8', is_trial: false, trial_duration_minutes: '30', status: 'active', color: '#00E5FF' };

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await base44.entities.Plan.list('-created_date');
    setPlans(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowDialog(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ ...emptyForm, ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, p[k] !== undefined ? String(p[k]) : emptyForm[k]])), is_trial: p.is_trial || false });
    setShowDialog(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const data = {
      ...form,
      download_mbps: Number(form.download_mbps), upload_mbps: Number(form.upload_mbps),
      burst_download_mbps: Number(form.burst_download_mbps) || 0, burst_upload_mbps: Number(form.burst_upload_mbps) || 0,
      burst_threshold_mbps: Number(form.burst_threshold_mbps) || 0, burst_time_seconds: Number(form.burst_time_seconds) || 10,
      quota_gb: Number(form.quota_gb) || 0, validity_days: Number(form.validity_days) || 30,
      price: Number(form.price) || 0, priority: Number(form.priority) || 8,
      trial_duration_minutes: Number(form.trial_duration_minutes) || 30,
    };
    if (editing) {
      await base44.entities.Plan.update(editing.id, data);
      toast.success('Plano atualizado!');
    } else {
      await base44.entities.Plan.create(data);
      toast.success('Plano criado!');
    }
    setShowDialog(false);
    load();
    setSaving(false);
  };

  const handleDelete = async (p) => {
    if (!confirm(`Remover plano ${p.name}?`)) return;
    await base44.entities.Plan.delete(p.id);
    toast.success('Plano removido');
    load();
  };

  const fields = [
    [['name','Nome do Plano',2],['description','Descrição',2]],
    [['download_mbps','Download (Mbps)',1],['upload_mbps','Upload (Mbps)',1]],
    [['burst_download_mbps','Burst Download',1],['burst_upload_mbps','Burst Upload',1]],
    [['burst_threshold_mbps','Burst Threshold',1],['burst_time_seconds','Burst Time (s)',1]],
    [['quota_gb','Quota (GB, 0=∞)',1],['validity_days','Validade (dias)',1]],
    [['price','Preço (R$)',1],['priority','Prioridade (1-10)',1]],
    [['mikrotik_profile_name','Perfil MikroTik',1],['radius_group','Grupo RADIUS',1]],
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{plans.length} plano(s) cadastrado(s)</p>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="icon" className="border-border"><RefreshCw className="w-4 h-4" /></Button>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground gap-2"><Plus className="w-4 h-4" />Novo Plano</Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => <div key={i} className="h-48 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : plans.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Zap className="w-10 h-10 mb-3 opacity-30" />
          <p className="font-medium">Nenhum plano cadastrado</p>
          <p className="text-xs mt-1">Crie seu primeiro plano de velocidade</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => (
            <div key={p.id} className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-all group relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: p.color || '#00E5FF' }} />
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">{p.name}</h3>
                    {p.is_trial && <span className="px-1.5 py-0.5 text-[9px] rounded bg-warning/10 text-warning border border-warning/20 font-medium">TRIAL</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{p.description || 'Sem descrição'}</p>
                </div>
                <StatusBadge status={p.status} />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-secondary/50 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1"><ArrowDown className="w-3 h-3 text-primary" /><span className="text-[10px] text-muted-foreground">Download</span></div>
                  <p className="text-lg font-bold font-mono text-foreground">{p.download_mbps}<span className="text-xs font-normal text-muted-foreground"> Mbps</span></p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1"><ArrowUp className="w-3 h-3 text-success" /><span className="text-[10px] text-muted-foreground">Upload</span></div>
                  <p className="text-lg font-bold font-mono text-foreground">{p.upload_mbps}<span className="text-xs font-normal text-muted-foreground"> Mbps</span></p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                <span>Quota: <span className="text-foreground font-mono">{p.quota_gb > 0 ? `${p.quota_gb}GB` : '∞'}</span></span>
                <span>Validade: <span className="text-foreground font-mono">{p.validity_days}d</span></span>
                {p.price > 0 && <span>R$ <span className="text-foreground font-mono">{Number(p.price).toFixed(2)}</span></span>}
              </div>

              {(p.mikrotik_profile_name || p.radius_group) && (
                <div className="flex gap-2 mb-3">
                  {p.mikrotik_profile_name && <span className="px-2 py-0.5 text-[10px] rounded bg-info/10 text-info border border-info/20 font-mono">{p.mikrotik_profile_name}</span>}
                  {p.radius_group && <span className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary border border-primary/20 font-mono">{p.radius_group}</span>}
                </div>
              )}

              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Edit className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => handleDelete(p)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar Plano' : 'Novo Plano'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            {fields.map((row, ri) => (
              <div key={ri} className="grid grid-cols-2 gap-3">
                {row.map(([field, label, cols]) => (
                  <div key={field} className={cols === 2 ? 'col-span-2' : ''}>
                    <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
                    <Input value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} className="bg-input border-border h-9 text-sm" />
                  </div>
                ))}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Cor</Label>
                <div className="flex gap-2">
                  <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-9 w-14 rounded border border-border bg-input cursor-pointer" />
                  <Input value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="bg-input border-border h-9 text-sm font-mono" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-foreground">Plano Trial/Gratuito</p>
                <p className="text-xs text-muted-foreground">Habilitar liberação temporária</p>
              </div>
              <Switch checked={form.is_trial} onCheckedChange={v => setForm({ ...form, is_trial: v })} />
            </div>
            {form.is_trial && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Duração Trial (minutos)</Label>
                <Input value={form.trial_duration_minutes} onChange={e => setForm({ ...form, trial_duration_minutes: e.target.value })} className="bg-input border-border h-9 text-sm" type="number" min="1" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.download_mbps || !form.upload_mbps} className="bg-primary text-primary-foreground">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : editing ? 'Salvar' : 'Criar Plano'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}