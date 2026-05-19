import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { UserPlus, Server, Zap, CheckCircle, RefreshCw, AlertCircle } from 'lucide-react';

export default function QuickProvision() {
  const [mikrotiks, setMikrotiks] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    mikrotikId: '',
    name: '',
    username: '',
    password: '',
    planId: '',
    cpf: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [mtiksRaw, plansData] = await Promise.all([
        base44.entities.Setting.filter({ category: 'mikrotik_device' }),
        base44.entities.Plan.list()
      ]);

      const mtiks = mtiksRaw.map(s => {
        try { return { id: s.id, ...JSON.parse(s.value) }; } catch { return null; }
      }).filter(Boolean);

      setMikrotiks(mtiks);
      setPlans(plansData);

      if (mtiks.length > 0) setForm(f => ({ ...f, mikrotikId: mtiks[0].id }));
      if (plansData.length > 0) setForm(f => ({ ...f, planId: plansData[0].id }));
    } catch (e) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.mikrotikId || !form.username || !form.planId) {
      toast.error('Preencha os campos obrigatórios');
      return;
    }

    setSaving(true);
    try {
      const mtik = mikrotiks.find(m => m.id === form.mikrotikId);
      const plan = plans.find(p => p.id === form.planId);

      if (!mtik || !plan) throw new Error('Equipamento ou plano inválido');

      // 1. Create client in DB
      await base44.entities.Client.create({
        name: form.name || form.username,
        email: `${form.username}@hotspot.local`,
        cpf: form.cpf || '',
        radius_username: form.username,
        radius_password: form.password,
        plan_id: plan.id,
        plan_name: plan.name,
        mikrotik_profile: plan.mikrotik_profile_name || 'default',
        status: 'active',
        source: 'manual'
      });

      // 2. Send SSH command to Mikrotik
      const sshRes = await base44.functions.invoke('mikrotikAddUser', {
        host: mtik.host,
        port: mtik.port,
        user: mtik.user,
        password: mtik.password,
        username: form.username,
        userPassword: form.password,
        profile: plan.mikrotik_profile_name || 'default',
        server: 'all'
      });

      toast.success('Usuário criado no banco e provisionado no MikroTik com sucesso!');
      setForm(f => ({ ...f, name: '', username: '', password: '', cpf: '' }));
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || 'Erro ao provisionar usuário');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cadastro Simplificado</h1>
        <p className="text-muted-foreground mt-1">Crie clientes rapidamente e adicione-os diretamente no MikroTik via SSH.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Equipamento */}
            <div className="space-y-2 col-span-1 md:col-span-2">
              <Label className="flex items-center gap-2"><Server className="w-4 h-4 text-primary" /> Equipamento MikroTik</Label>
              <select 
                value={form.mikrotikId} 
                onChange={e => setForm({...form, mikrotikId: e.target.value})}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                <option value="">Selecione um equipamento...</option>
                {mikrotiks.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.host})</option>
                ))}
              </select>
            </div>

            {/* Plano / Velocidade */}
            <div className="space-y-2 col-span-1 md:col-span-2">
              <Label className="flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Velocidade Contratada (Plano)</Label>
              <select 
                value={form.planId} 
                onChange={e => setForm({...form, planId: e.target.value})}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                <option value="">Selecione a velocidade...</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.download_mbps} Mbps - Perfil: {p.mikrotik_profile_name || 'default'})</option>
                ))}
              </select>
            </div>

            {/* Dados do Usuário */}
            <div className="space-y-2">
              <Label>Nome do Cliente</Label>
              <Input 
                value={form.name} 
                onChange={e => setForm({...form, name: e.target.value})} 
                placeholder="Ex: João da Silva" 
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label>CPF</Label>
              <Input 
                value={form.cpf} 
                onChange={e => setForm({...form, cpf: e.target.value})} 
                placeholder="000.000.000-00" 
              />
            </div>

            <div className="space-y-2">
              <Label>Usuário (Login Hotspot)</Label>
              <Input 
                value={form.username} 
                onChange={e => setForm({...form, username: e.target.value})} 
                placeholder="joao123" 
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Senha (Hotspot)</Label>
              <Input 
                value={form.password} 
                onChange={e => setForm({...form, password: e.target.value})} 
                type="text"
                placeholder="Deixe em branco para sem senha" 
              />
            </div>
          </div>

          <div className="pt-4 flex items-center justify-end border-t border-border">
            <Button type="submit" disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Cadastrar e Provisionar
            </Button>
          </div>
        </form>
      </div>

      <div className="bg-info/10 border border-info/20 rounded-xl p-4 flex items-start gap-3 text-info">
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p className="text-sm">
          Este processo cria o cliente no banco de dados e <strong>envia o comando SSH</strong> para criar o usuário local (<code>/ip hotspot user add</code>) no MikroTik selecionado, aplicando o profile do plano.
        </p>
      </div>
    </div>
  );
}