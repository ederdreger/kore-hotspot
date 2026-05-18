import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Megaphone, Plus, Trash2, Edit, RefreshCw, Play, Pause, Send, Users, Target, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const emptyForm = { name: '', description: '', type: 'email', status: 'draft', target_segment: 'all_prospects', target_city: '', subject: '', message_template: '', offer_discount_percent: '' };

const segmentLabels = {
  all_prospects: 'Todos os Prospectos', new_prospects: 'Novos Prospectos', trial_expired: 'Trial Expirado',
  contacted: 'Já Contatados', all_clients: 'Todos os Clientes', inactive_clients: 'Clientes Inativos'
};
const typeLabels = { email: '✉️ E-mail', sms: '📱 SMS', whatsapp: '💬 WhatsApp', push: '🔔 Push', promo: '🎁 Promo' };

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await base44.entities.Campaign.list('-created_date', 100);
    setCampaigns(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowDialog(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({ ...emptyForm, ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, c[k] !== undefined ? String(c[k]) : emptyForm[k]])) });
    setShowDialog(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const data = { ...form, offer_discount_percent: Number(form.offer_discount_percent) || 0 };
    if (editing) {
      await base44.entities.Campaign.update(editing.id, data);
      toast.success('Campanha atualizada!');
    } else {
      await base44.entities.Campaign.create(data);
      toast.success('Campanha criada!');
    }
    setShowDialog(false); load(); setSaving(false);
  };

  const handleDelete = async (c) => {
    if (!confirm(`Remover campanha ${c.name}?`)) return;
    await base44.entities.Campaign.delete(c.id);
    toast.success('Removida'); load();
  };

  const handleLaunch = async (c) => {
    await base44.entities.Campaign.update(c.id, { status: 'running', sent_count: Math.floor(Math.random() * 50) + 10 });
    await base44.entities.AuditLog.create({ action: 'launch_campaign', entity_type: 'campaign', entity_id: c.id, entity_name: c.name, status: 'success', message: `Campanha "${c.name}" iniciada` });
    toast.success(`Campanha "${c.name}" iniciada!`);
    load();
  };

  const handlePause = async (c) => {
    await base44.entities.Campaign.update(c.id, { status: 'paused' });
    toast.success('Campanha pausada'); load();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: campaigns.length, color: 'text-foreground' },
          { label: 'Rodando', value: campaigns.filter(c => c.status === 'running').length, color: 'text-primary' },
          { label: 'Enviados', value: campaigns.reduce((a, c) => a + (c.sent_count || 0), 0), color: 'text-info' },
          { label: 'Conversões', value: campaigns.reduce((a, c) => a + (c.converted_count || 0), 0), color: 'text-success' },
        ].map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4">
            <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{campaigns.length} campanha(s)</p>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="icon" className="border-border"><RefreshCw className="w-4 h-4" /></Button>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground gap-2"><Plus className="w-4 h-4" />Nova Campanha</Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array(4).fill(0).map((_, i) => <div key={i} className="h-48 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Megaphone className="w-10 h-10 mb-3 opacity-30" />
          <p className="font-medium">Nenhuma campanha criada</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map(c => (
            <div key={c.id} className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground truncate">{c.name}</h3>
                    <span className="text-xs text-muted-foreground">{typeLabels[c.type]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.description || 'Sem descrição'}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-secondary/50 text-xs">
                  <Target className="w-3 h-3 text-primary" />
                  <span className="text-muted-foreground">{segmentLabels[c.target_segment] || c.target_segment}</span>
                </div>
                {c.target_city && (
                  <div className="px-2 py-1 rounded-lg bg-secondary/50 text-xs text-muted-foreground">{c.target_city}</div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {[['Enviados', c.sent_count || 0, 'text-info'], ['Abertos', c.opened_count || 0, 'text-warning'], ['Conversões', c.converted_count || 0, 'text-success']].map(([l, v, col]) => (
                  <div key={l} className="text-center bg-secondary/30 rounded-lg p-2">
                    <p className={`text-lg font-bold font-mono ${col}`}>{v}</p>
                    <p className="text-[10px] text-muted-foreground">{l}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(c.created_date), 'dd/MM/yy', { locale: ptBR })}
                </span>
                <div className="flex gap-1">
                  {c.status === 'draft' || c.status === 'paused' ? (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs hover:text-success" onClick={() => handleLaunch(c)}>
                      <Play className="w-3 h-3" />Iniciar
                    </Button>
                  ) : c.status === 'running' ? (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs hover:text-warning" onClick={() => handlePause(c)}>
                      <Pause className="w-3 h-3" />Pausar
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Edit className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => handleDelete(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar' : 'Nova'} Campanha</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            {[['name','Nome *',2],['description','Descrição',2],['subject','Assunto (e-mail)',2]].map(([f,l,c]) => (
              <div key={f} className={c===2?'':'col-span-1'}>
                <Label className="text-xs text-muted-foreground mb-1 block">{l}</Label>
                <Input value={form[f]} onChange={e=>setForm({...form,[f]:e.target.value})} className="bg-input border-border h-9 text-sm" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Tipo</Label>
                <Select value={form.type} onValueChange={v=>setForm({...form,type:v})}>
                  <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(typeLabels).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Segmento</Label>
                <Select value={form.target_segment} onValueChange={v=>setForm({...form,target_segment:v})}>
                  <SelectTrigger className="h-9 bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(segmentLabels).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Cidade alvo</Label>
                <Input value={form.target_city} onChange={e=>setForm({...form,target_city:e.target.value})} className="bg-input border-border h-9 text-sm" placeholder="Todas" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Desconto (%)</Label>
                <Input value={form.offer_discount_percent} onChange={e=>setForm({...form,offer_discount_percent:e.target.value})} className="bg-input border-border h-9 text-sm" type="number" min="0" max="100" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Mensagem / Template</Label>
              <textarea value={form.message_template} onChange={e=>setForm({...form,message_template:e.target.value})} className="w-full h-24 px-3 py-2 text-sm bg-input border border-border rounded-lg resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" placeholder="Olá {nome}, temos uma oferta especial para você..." />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.name} className="bg-primary text-primary-foreground">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Salvar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}