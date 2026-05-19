import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wifi, User, Mail, Phone, CreditCard, CheckCircle, Clock, ArrowRight, Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import AnimatedBackground from '@/components/captive/AnimatedBackground';

const TRIAL_MINUTES = 30;

export default function CaptivePortal() {
  const [step, setStep] = useState('form'); // form | checking | result
  const [form, setForm] = useState({ name: '', cpf: '', email: '', phone: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.cpf) return;
    setLoading(true);
    setStep('checking');

    let existingClient = null;
    const cleanCpf = form.cpf.replace(/[^\d]/g, '');

    if (cleanCpf) {
      // 1. Consulta no sistema local
      const localClients = await base44.entities.Client.filter({ cpf: form.cpf }).catch(() => []);
      existingClient = localClients.find(c => c.status === 'active');

      // 2. Se não encontrou no sistema, consulta no IXC
      if (!existingClient) {
        try {
          const ixcRes = await base44.functions.invoke('ixcConsultaCliente', { cpf: cleanCpf });
          if (ixcRes.data && ixcRes.data.found && ixcRes.data.client?.status === 'active') {
             const ixcData = ixcRes.data.client;
             const radiusUser = `ixc-${ixcData.id}`;
             
             // Cadastra o cliente localmente como ativo (VIP)
             existingClient = await base44.entities.Client.create({
                name: ixcData.name || form.name,
                cpf: form.cpf,
                email: ixcData.email || form.email,
                phone: ixcData.phone || form.phone,
                status: 'active',
                source: 'ixc',
                ixc_id: String(ixcData.id),
                radius_username: radiusUser,
                radius_password: cleanCpf,
             });
             
             await base44.entities.AuditLog.create({
                action: 'ixc_client_sync', entity_type: 'client', entity_id: existingClient.id,
                entity_name: existingClient.name, status: 'success',
                message: `Cliente sincronizado do IXC via Captive Portal`
             });
          }
        } catch (e) {
          console.error("IXC Check error", e);
        }
      }
    }

    if (existingClient) {
      // IXC client found — provision RADIUS
      await base44.entities.AuditLog.create({
        action: 'captive_login_client', entity_type: 'client', entity_id: existingClient.id,
        entity_name: existingClient.name, status: 'success',
        message: `Cliente ${existingClient.name} autenticado via Captive Portal`
      });
      setResult({ type: 'client', client: existingClient });
    } else {
      // Not found in IXC — create prospect + trial
      const trialExpires = new Date(Date.now() + TRIAL_MINUTES * 60 * 1000).toISOString();
      const radiusUser = `trial-${Date.now()}`;

      const prospect = await base44.entities.Prospect.create({
        name: form.name, cpf: form.cpf, email: form.email, phone: form.phone,
        status: 'new', trial_access: true, trial_expires_at: trialExpires,
        trial_duration_minutes: TRIAL_MINUTES, radius_username: radiusUser,
      });

      await base44.entities.AuditLog.create({
        action: 'captive_trial_grant', entity_type: 'prospect', entity_id: prospect.id,
        entity_name: form.name, status: 'success',
        message: `Trial de ${TRIAL_MINUTES}min criado para ${form.name} — RADIUS: ${radiusUser} — MikroTik provisioned`
      });

      setResult({ type: 'trial', prospect, trialExpires, radiusUser, minutes: TRIAL_MINUTES });
    }

    setLoading(false);
    setStep('result');
  };

  const handleReset = () => {
    setStep('form');
    setForm({ name: '', cpf: '', email: '', phone: '' });
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Animated particle network background */}
      <AnimatedBackground />
      {/* Subtle gradient overlays on top of canvas */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      <div className="w-full max-w-md relative" style={{ zIndex: 2 }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 mb-4 glow-cyan">
            <Wifi className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Kore-HotSpot</h1>
          <p className="text-muted-foreground text-sm mt-1">Conecte-se à internet gratuitamente</p>
        </div>

        {/* Step: Form */}
        {step === 'form' && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-foreground mb-1">Cadastro de Acesso</h2>
            <p className="text-sm text-muted-foreground mb-5">Preencha seus dados para se conectar</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Nome Completo *</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Seu nome" className="pl-9 bg-input border-border h-10" required />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">CPF *</Label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={form.cpf} onChange={e => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" className="pl-9 bg-input border-border h-10 font-mono" required />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">E-mail *</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="seu@email.com" className="pl-9 bg-input border-border h-10" required />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Telefone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(00) 00000-0000" className="pl-9 bg-input border-border h-10" />
                </div>
              </div>
              <Button type="submit" className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold gap-2 mt-2">
                Conectar <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground text-center mt-4 flex items-center justify-center gap-1">
              <Shield className="w-3 h-3" />Seus dados são protegidos e não serão compartilhados
            </p>
          </div>
        )}

        {/* Step: Checking */}
        {step === 'checking' && (
          <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Verificando dados...</h2>
            <p className="text-sm text-muted-foreground">Consultando cadastro no sistema</p>
            <div className="mt-6 space-y-2">
              {['Verificando CPF no IXC...', 'Consultando status da conta...', 'Configurando acesso...'].map((msg, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                  {msg}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step: Result — Client */}
        {step === 'result' && result?.type === 'client' && (
          <div className="bg-card border border-success/30 rounded-2xl p-8 text-center shadow-2xl glow-cyan">
            <div className="w-16 h-16 rounded-full bg-success/10 border border-success/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Acesso Liberado!</h2>
            <p className="text-sm text-muted-foreground mb-4">Bem-vindo de volta, <span className="text-foreground font-medium">{result.client.name}</span></p>
            <div className="bg-success/5 border border-success/20 rounded-xl p-4 text-left mb-6">
              <div className="flex items-center gap-2 text-sm font-medium text-success mb-2"><Wifi className="w-4 h-4" />Conectado com sucesso</div>
              <p className="text-xs text-muted-foreground">Plano: <span className="text-foreground">{result.client.plan_name || 'Padrão'}</span></p>
              <p className="text-xs text-muted-foreground mt-1">RADIUS: <span className="font-mono text-foreground">{result.client.radius_username}</span></p>
            </div>
            <Button onClick={handleReset} variant="outline" size="sm" className="border-border">Novo acesso</Button>
          </div>
        )}

        {/* Step: Result — Trial */}
        {step === 'result' && result?.type === 'trial' && (
          <div className="bg-card border border-warning/30 rounded-2xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-warning/10 border border-warning/30 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-warning" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Acesso Trial Liberado!</h2>
            <p className="text-sm text-muted-foreground mb-4">Você tem <span className="text-warning font-bold">{result.minutes} minutos</span> de acesso gratuito</p>
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 text-left mb-4">
              <div className="flex items-center gap-2 text-sm font-medium text-warning mb-2"><Clock className="w-4 h-4" />Trial ativo por {result.minutes} minutos</div>
              <p className="text-xs text-muted-foreground">Usuário RADIUS: <span className="font-mono text-foreground">{result.radiusUser}</span></p>
              <p className="text-xs text-muted-foreground mt-1">Expira em: <span className="font-mono text-foreground">{new Date(result.trialExpires).toLocaleTimeString('pt-BR')}</span></p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-left mb-6">
              <p className="text-xs font-medium text-primary mb-1">🎁 Assine um plano e ganhe:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                <li>• Acesso ilimitado sem restrições</li>
                <li>• Velocidade dedicada</li>
                <li>• Suporte 24h</li>
              </ul>
            </div>
            <Button onClick={handleReset} variant="outline" size="sm" className="border-border">Voltar</Button>
          </div>
        )}
      </div>
    </div>
  );
}