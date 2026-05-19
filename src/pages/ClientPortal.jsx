import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { LogOut, Zap, Clock, Shield, CreditCard, Activity, Wifi, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ClientPortal() {
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const clientId = localStorage.getItem('portal_client_id');
    if (!clientId) {
      navigate('/portal/login');
      return;
    }

    const loadData = async () => {
      try {
        const res = await base44.functions.invoke('getClientPortalData', { clientId });
        if (res.data.success) {
          setClient(res.data.client);
          setPlans(res.data.plans);
        } else {
          throw new Error('Falha ao carregar dados');
        }
      } catch (e) {
        localStorage.removeItem('portal_client_id');
        navigate('/portal/login');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [navigate]);

  const handleCheckout = async (plan) => {
    setProcessing(true);
    try {
      // Endpoint to be created after Stripe installation
      const res = await base44.functions.invoke('createStripeCheckout', {
         clientId: client.id,
         planId: plan.id
      });
      if (res.data && res.data.url) {
         window.location.href = res.data.url;
      } else {
         toast.info("Aguardando aprovação e configuração do Gateway de Pagamento pelo administrador.");
      }
    } catch (e) {
      toast.info("Aguardando aprovação e configuração do Gateway de Pagamento pelo administrador.");
    }
    setProcessing(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('portal_client_id');
    navigate('/portal/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Activity className="w-8 h-8 text-primary animate-pulse mb-4" />
        <p className="text-muted-foreground">Carregando portal...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <nav className="border-b border-border bg-card px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center border border-primary/30">
            <Wifi className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-lg hidden sm:block">Kore Portal</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold">{client.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{client.radius_username}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2 border-border hover:bg-destructive/10 hover:text-destructive transition-colors">
            <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Sair</span>
          </Button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Status Header */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-xl p-6 lg:col-span-2 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
            
            <h2 className="text-lg font-semibold text-muted-foreground mb-4">Status da Conexão</h2>
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="p-4 bg-secondary rounded-2xl border border-border relative z-10">
                <Zap className={`w-8 h-8 ${client.status === 'active' ? 'text-primary' : 'text-destructive'}`} />
              </div>
              <div className="relative z-10">
                <p className="text-3xl font-bold mb-1">{client.plan_name || 'Nenhum plano ativo'}</p>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${client.status === 'active' ? 'bg-success' : 'bg-destructive'}`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${client.status === 'active' ? 'bg-success' : 'bg-destructive'}`}></span>
                  </span>
                  <span className={`font-medium ${client.status === 'active' ? 'text-success' : 'text-destructive'}`}>
                    {client.status === 'active' ? 'Internet Liberada' : client.status === 'suspended' ? 'Acesso Suspenso' : 'Acesso Inativo'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="mt-8 pt-6 border-t border-border grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Usuário Hotspot</p>
                <p className="font-mono text-sm">{client.radius_username}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Endereço MAC / IP</p>
                <p className="font-mono text-sm">{client.mac_address || '--'} / {client.ip_address || '--'}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 flex flex-col">
            <h3 className="font-semibold text-sm mb-6 flex items-center gap-2 text-muted-foreground">
              <Activity className="w-4 h-4" /> Franquia e Consumo
            </h3>
            <div className="flex-1 flex flex-col justify-center">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">Tráfego Ilimitado</span>
                <span className="font-mono text-primary">~ GB</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-3 overflow-hidden">
                <div className="bg-primary h-full w-[25%] rounded-full relative">
                  <div className="absolute inset-0 bg-white/20 w-full animate-[slide-in_2s_ease-in-out_infinite]"></div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center mt-6 p-3 bg-secondary/50 rounded-lg">
                Seu plano atual não possui limites rígidos de franquia de dados. Navegue à vontade!
              </p>
            </div>
          </div>
        </div>

        {/* Upgrade / Renew Section */}
        <div className="pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <CreditCard className="w-6 h-6 text-primary" /> Assinaturas e Planos
              </h2>
              <p className="text-muted-foreground text-sm mt-1">Renove seu acesso ou faça upgrade para mais velocidade pagando com PIX ou Cartão.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {plans.map(plan => {
              const isCurrent = client.plan_name === plan.name;
              
              return (
                <div key={plan.id} className={`bg-card border-2 transition-all duration-300 rounded-2xl p-6 flex flex-col relative overflow-hidden group hover:-translate-y-1 ${isCurrent ? 'border-primary shadow-[0_8px_30px_rgba(0,229,255,0.15)]' : 'border-border hover:border-primary/50'}`}>
                  {isCurrent && (
                    <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-lg">
                      PLANO ATUAL
                    </div>
                  )}
                  
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  <div className="my-6">
                    <span className="text-4xl font-extrabold tracking-tight">R$ {plan.price || '0'}</span>
                    <span className="text-sm text-muted-foreground font-medium">/{plan.validity_days || 30} dias</span>
                  </div>
                  
                  <ul className="space-y-3 mb-8 flex-1">
                    <li className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                      <span><strong className="text-foreground">{plan.download_mbps} Mbps</strong> de Download</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                      <span><strong className="text-foreground">{plan.upload_mbps} Mbps</strong> de Upload</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">Suporte técnico prioritário</span>
                    </li>
                  </ul>

                  <Button 
                    onClick={() => handleCheckout(plan)} 
                    disabled={processing}
                    variant={isCurrent ? "outline" : "default"}
                    className={`w-full py-6 font-bold text-base ${isCurrent ? 'border-primary text-primary hover:bg-primary/10' : 'shadow-[0_0_15px_rgba(0,229,255,0.3)] hover:shadow-[0_0_25px_rgba(0,229,255,0.5)]'}`}
                  >
                    {processing ? <Activity className="w-5 h-5 animate-spin" /> : isCurrent ? 'Renovar Acesso' : 'Assinar Plano'}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}