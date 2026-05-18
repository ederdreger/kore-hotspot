import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wifi, User, Lock, CheckCircle, XCircle, Loader2, Shield, ArrowRight, AlertTriangle } from 'lucide-react';

// Animated particle canvas background
function AnimatedBg() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;

    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);

    const NODES = 60;
    const nodes = Array.from({ length: NODES }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 1,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      // Draw connections
      for (let i = 0; i < NODES; i++) {
        for (let j = i + 1; j < NODES; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0,229,255,${0.12 * (1 - dist / 140)})`;
            ctx.lineWidth = 0.7;
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }
      // Draw nodes
      nodes.forEach(n => {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,229,255,0.5)';
        ctx.fill();
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      });
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />;
}

export default function HotspotLogin() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [step, setStep] = useState('form'); // form | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [clientData, setClientData] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) return;
    setStep('loading');
    setErrorMsg('');

    await new Promise(r => setTimeout(r, 1200));

    // Valida contra clientes cadastrados pelo admin
    // username = radius_username ou email, password = radius_password
    const byRadius = await base44.entities.Client.filter({ radius_username: form.username }).catch(() => []);
    const byEmail = byRadius.length === 0
      ? await base44.entities.Client.filter({ email: form.username }).catch(() => [])
      : [];

    const candidates = [...byRadius, ...byEmail];
    const client = candidates.find(c =>
      c.status === 'active' &&
      (c.radius_password === form.password || c.cpf === form.password)
    );

    if (client) {
      // Log successful access
      await base44.entities.AuditLog.create({
        action: 'hotspot_login', entity_type: 'client', entity_id: client.id,
        entity_name: client.name, status: 'success',
        message: `Login no hotspot: ${client.name} (${form.username})`
      }).catch(() => {});
      setClientData(client);
      setStep('success');
    } else {
      const exists = candidates.length > 0;
      if (exists) {
        setErrorMsg('Senha incorreta ou conta suspensa. Verifique suas credenciais.');
      } else {
        setErrorMsg('Usuário não encontrado. Apenas usuários cadastrados pelo administrador podem acessar.');
      }
      await base44.entities.AuditLog.create({
        action: 'hotspot_login_failed', entity_type: 'client', entity_id: '',
        entity_name: form.username, status: 'error',
        message: `Tentativa de login falhou: ${form.username}`
      }).catch(() => {});
      setStep('error');
    }
  };

  const handleReset = () => {
    setStep('form');
    setForm({ username: '', password: '' });
    setErrorMsg('');
    setClientData(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <AnimatedBg />

      {/* Top/bottom glow lines */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <div className="absolute top-0 left-0 bottom-0 w-px bg-gradient-to-b from-transparent via-primary/10 to-transparent" />
        <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-primary/10 to-transparent" />
      </div>

      <div className="w-full max-w-sm relative" style={{ zIndex: 2 }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 border border-primary/30 mb-4 glow-cyan relative">
            <Wifi className="w-10 h-10 text-primary" />
            <div className="absolute -inset-1 rounded-2xl bg-primary/5 blur-xl" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Kore<span className="text-primary">HotSpot</span></h1>
          <p className="text-muted-foreground text-sm mt-1">Acesso à Internet</p>
        </div>

        {/* FORM */}
        {step === 'form' && (
          <div className="bg-card/90 backdrop-blur-sm border border-border rounded-2xl p-6 shadow-2xl glow-cyan">
            <h2 className="text-base font-semibold text-foreground mb-1">Entrar na rede</h2>
            <p className="text-xs text-muted-foreground mb-5">Use as credenciais fornecidas pelo administrador</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Usuário ou E-mail</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={form.username}
                    onChange={e => setForm({ ...form, username: e.target.value })}
                    placeholder="usuario ou email@exemplo.com"
                    className="pl-9 bg-input border-border h-10 text-sm"
                    required
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="password"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="pl-9 bg-input border-border h-10 text-sm"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold gap-2 mt-2 glow-cyan">
                Conectar <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground text-center mt-4 flex items-center justify-center gap-1">
              <Shield className="w-3 h-3" /> Acesso restrito a usuários autorizados
            </p>
          </div>
        )}

        {/* LOADING */}
        {step === 'loading' && (
          <div className="bg-card/90 backdrop-blur-sm border border-border rounded-2xl p-10 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-5 glow-cyan">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Verificando acesso...</h2>
            <p className="text-sm text-muted-foreground">Validando credenciais no sistema</p>
            <div className="mt-6 space-y-2">
              {['Consultando usuário...', 'Verificando permissões...', 'Preparando conexão...'].map((msg, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                  {msg}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SUCCESS */}
        {step === 'success' && clientData && (
          <div className="bg-card/90 backdrop-blur-sm border border-success/40 rounded-2xl p-8 text-center shadow-2xl glow-cyan">
            <div className="w-16 h-16 rounded-full bg-success/10 border border-success/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-9 h-9 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Acesso Liberado!</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Bem-vindo, <span className="text-foreground font-semibold">{clientData.name}</span>
            </p>
            <div className="bg-success/5 border border-success/20 rounded-xl p-4 text-left mb-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-success">
                <Wifi className="w-4 h-4" /> Conectado com sucesso
              </div>
              {clientData.plan_name && (
                <p className="text-xs text-muted-foreground">Plano: <span className="text-foreground font-medium">{clientData.plan_name}</span></p>
              )}
              {clientData.radius_username && (
                <p className="text-xs text-muted-foreground">Usuário RADIUS: <span className="font-mono text-foreground">{clientData.radius_username}</span></p>
              )}
              {clientData.city && (
                <p className="text-xs text-muted-foreground">Localidade: <span className="text-foreground">{clientData.city}</span></p>
              )}
            </div>
            <Button onClick={handleReset} variant="outline" size="sm" className="border-border text-xs">
              Trocar usuário
            </Button>
          </div>
        )}

        {/* ERROR */}
        {step === 'error' && (
          <div className="bg-card/90 backdrop-blur-sm border border-destructive/40 rounded-2xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-9 h-9 text-destructive" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Acesso Negado</h2>
            <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 mb-6 flex items-start gap-3 text-left">
              <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{errorMsg}</p>
            </div>
            <div className="bg-secondary/50 rounded-xl p-4 mb-6 text-left">
              <p className="text-xs text-muted-foreground font-medium mb-1">Para obter acesso:</p>
              <p className="text-xs text-muted-foreground">Entre em contato com o administrador da rede para solicitar seu cadastro.</p>
            </div>
            <Button onClick={handleReset} className="bg-primary text-primary-foreground hover:bg-primary/90 w-full h-10 gap-2">
              <ArrowRight className="w-4 h-4" /> Tentar novamente
            </Button>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="absolute bottom-4 text-[10px] text-muted-foreground/50 font-mono" style={{ zIndex: 2 }}>
        Kore-HotSpot v1.0 · Powered by Base44
      </p>
    </div>
  );
}