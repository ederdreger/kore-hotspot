import { useEffect, useMemo, useState } from 'react';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowRight, Check, CheckCircle2, Copy, Loader2, Phone, QrCode, User, Users, Wifi } from 'lucide-react';
import { toast } from 'sonner';

function getPortalParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    mac: params.get('mac') || '',
    ip: params.get('ip') || '',
    linkLogin: params.get('link-login') || params.get('link_login') || '',
    linkOrig: params.get('link-orig') || params.get('link_orig') || ''
  };
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeMac(value) {
  const clean = String(value || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return clean.length === 12 ? clean.match(/.{1,2}/g).join(':') : String(value || '').toUpperCase();
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function planType(plan) {
  return plan?.plan_type || (plan?.is_trial ? 'trial' : Number(plan?.price || 0) > 0 ? 'paid' : 'free');
}

function planHours(plan) {
  if (Number(plan?.validity_hours || 0) > 0) return Number(plan.validity_hours);
  if (Number(plan?.trial_duration_hours || 0) > 0) return Number(plan.trial_duration_hours);
  if (Number(plan?.trial_duration_minutes || 0) > 0) return Number(plan.trial_duration_minutes) / 60;
  return Math.max(1, Number(plan?.validity_days || 1) * 24);
}

function redirectToInternet(linkOrig) {
  window.location.href = linkOrig?.startsWith('http') ? linkOrig : 'http://neverssl.com';
}

function loginToMikrotik(login, fallbackUrl) {
  const params = getPortalParams();
  if (login?.active_login) {
    redirectToInternet(fallbackUrl || params.linkOrig);
    return;
  }
  if (!params.linkLogin || !login?.username || !login?.password) {
    redirectToInternet(fallbackUrl || params.linkOrig);
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = params.linkLogin;
  [
    ['username', login.username],
    ['password', login.password],
    ['dst', fallbackUrl || params.linkOrig || 'http://neverssl.com'],
    ['popup', 'false']
  ].forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value || '';
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

function Brand({ logoUrl, title = 'Kore-HotSpot' }) {
  return (
    <div className="h-12 bg-white flex items-center px-5">
      {logoUrl ? (
        <img src={logoUrl} alt={title} className="max-h-8 max-w-[180px] object-contain" />
      ) : (
        <div className="text-2xl font-black tracking-tight text-[#c72eb5]">
          Kore<span className="text-[#0ea5e9]">HotSpot</span>
        </div>
      )}
    </div>
  );
}

function Shell({ children, settings }) {
  return (
    <div className="min-h-screen bg-[#060b16] text-slate-950 flex items-center justify-center p-0 sm:p-6">
      <div className="w-full min-h-screen sm:min-h-0 sm:w-[282px] sm:h-[520px] sm:rounded-[38px] sm:border-[6px] sm:border-zinc-600 sm:bg-zinc-900 sm:p-1.5 sm:shadow-2xl">
        <div className="hidden sm:block absolute" />
        <div className="relative w-full min-h-screen sm:min-h-0 sm:h-full overflow-hidden bg-[#dff3ff] sm:rounded-[30px]">
          <div className="hidden sm:flex h-10 bg-zinc-900 text-white text-[11px] items-end justify-between px-7 pb-1">
            <span>18:08</span>
            <span>Wi-Fi 100%</span>
          </div>
          <Brand logoUrl={settings?.captive_portal_logo_url} title={settings?.captive_portal_title} />
          <div className="p-4">{children}</div>
          <div className="hidden sm:block absolute bottom-3 left-1/2 -translate-x-1/2 h-1 w-20 rounded-full bg-zinc-500" />
        </div>
      </div>
    </div>
  );
}

function PlanCard({ plan, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(plan)}
      className={`w-full text-left rounded-lg border-2 bg-white p-3 transition ${selected ? 'border-[#7c3aed]' : 'border-white hover:border-[#b58cff]'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-sm">{plan.name}</p>
          <p className="mt-2 text-xl font-black">{money(plan.price)}</p>
        </div>
        {selected && <span className="text-[10px] text-[#7c3aed]">selecionado</span>}
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-slate-600">
        <p className="flex gap-1"><Check className="w-3 h-3 text-emerald-500" /> Velocidade: {plan.download_mbps || plan.speed_download || 0} Mbps</p>
        <p className="flex gap-1"><Check className="w-3 h-3 text-emerald-500" /> Tempo de conexao: {planHours(plan).toFixed(1).replace('.0', '')} hora(s)</p>
        {planType(plan) === 'paid' && <p className="flex gap-1"><Check className="w-3 h-3 text-emerald-500" /> Pagamento via Pix</p>}
      </div>
    </button>
  );
}

export default function CaptivePortal() {
  const [stage, setStage] = useState(() => window.location.pathname.includes('captive-plans') ? 'plans' : 'choice');
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [settings, setSettings] = useState({});
  const [phone, setPhone] = useState('');
  const [clientIdentifier, setClientIdentifier] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', cpf: '', cep: '' });
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [activeClient, setActiveClient] = useState(null);
  const [activeProspect, setActiveProspect] = useState(null);
  const [notice, setNotice] = useState('');
  const [pixPayment, setPixPayment] = useState(null);
  const [hotspotLogin, setHotspotLogin] = useState(null);
  const [loading, setLoading] = useState(false);

  const visiblePlans = useMemo(
    () => plans.filter((plan) => plan.status === 'active' && planType(plan) !== 'trial'),
    [plans]
  );
  const freeAccessPlan = useMemo(
    () => plans.find((plan) => (plan.id || plan._id) === settings.captive_prospect_plan_id) ||
      plans.find((plan) => plan.status === 'active' && planType(plan) === 'trial'),
    [plans, settings.captive_prospect_plan_id]
  );
  const selectedPlan = useMemo(
    () => visiblePlans.find((plan) => (plan.id || plan._id) === selectedPlanId) || visiblePlans[0],
    [visiblePlans, selectedPlanId]
  );

  useEffect(() => {
    async function load() {
      const [planData, clientData, prospectData, settingsData] = await Promise.all([
        spedynet.functions.invoke('captivePlans', {}).then((res) => res.data || []).catch(() => []),
        spedynet.entities.Client.list('-created_date', 500).catch(() => []),
        spedynet.functions.invoke('captiveProspects', {}).then((res) => res.data || []).catch(() => []),
        spedynet.entities.Setting.list().catch(() => [])
      ]);
      setPlans(planData);
      setClients(clientData);
      setProspects(prospectData);
      setSettings(Object.fromEntries(settingsData.map((item) => [item.key, item.value])));

      const params = getPortalParams();
      const mac = normalizeMac(params.mac);
      const known = prospectData.find((item) => mac && normalizeMac(item.mac_address) === mac);
      if (known?.trial_expires_at && new Date(known.trial_expires_at) <= new Date()) {
        setActiveProspect(known);
        setNotice('Seu periodo gratis terminou. Escolha um plano para continuar navegando.');
        setStage('plans');
      }
    }
    load();
  }, []);

  const findClient = (value) => {
    const d = digits(value);
    const q = String(value || '').toLowerCase().trim();
    return clients.find((client) =>
      digits(client.phone) === d ||
      digits(client.cpf) === d ||
      String(client.email || '').toLowerCase() === q ||
      String(client.radius_username || '').toLowerCase() === q
    );
  };

  const findProspect = (value) => {
    const d = digits(value);
    const params = getPortalParams();
    const mac = normalizeMac(params.mac);
    return prospects.find((item) =>
      (d && digits(item.phone) === d) ||
      (mac && normalizeMac(item.mac_address) === mac)
    );
  };

  const startByPhone = async (event) => {
    event.preventDefault();
    if (!digits(phone)) return;
    setLoading(true);
    try {
      const client = findClient(phone);
      if (client) {
        setActiveClient(client);
        const params = getPortalParams();
        const res = await spedynet.functions.invoke('captiveClientLogin', {
          identifier: phone,
          plan_id: settings.captive_vip_plan_id || '',
          mac: params.mac,
          ip: params.ip,
          link_orig: settings.captive_redirect_url || params.linkOrig
        });
        setHotspotLogin(res.data?.login || res.data?.authorization);
        setStage('welcome');
        return;
      }

      const prospect = findProspect(phone);
      if (prospect?.trial_expires_at && new Date(prospect.trial_expires_at) <= new Date()) {
        setActiveProspect(prospect);
        setNotice('Seu periodo gratis terminou. Escolha um plano para continuar navegando.');
        setStage('plans');
        return;
      }

      setForm((current) => ({ ...current, phone }));
      setStage('register');
    } catch (error) {
      toast.error(error.message || 'Nao foi possivel liberar este acesso.');
    } finally {
      setLoading(false);
    }
  };

  const startAsClient = async (event) => {
    event.preventDefault();
    if (!String(clientIdentifier || '').trim()) return;
    setLoading(true);
    try {
      const params = getPortalParams();
      const res = await spedynet.functions.invoke('captiveClientLogin', {
        identifier: clientIdentifier,
        plan_id: settings.captive_vip_plan_id || '',
        mac: params.mac,
        ip: params.ip,
        link_orig: settings.captive_redirect_url || params.linkOrig
      });
      setHotspotLogin(res.data?.login || res.data?.authorization);
      setActiveClient(res.data?.client || findClient(clientIdentifier) || { name: 'Cliente' });
      setStage('welcome');
    } catch (error) {
      const message = error.message || 'Nao foi possivel liberar cliente.';
      toast.error(message);
      if (/nao encontrado no sistema nem no IXC/i.test(message)) {
        setNotice('CPF nao localizado no IXC. Use Nao sou cliente para realizar o cadastro.');
      }
    } finally {
      setLoading(false);
    }
  };

  const registerFreeAccess = async (event) => {
    event.preventDefault();
    if (!form.name || !digits(form.phone) || !digits(form.cpf)) return;
    setLoading(true);
    try {
      if (!freeAccessPlan) {
        toast.error('Nenhum plano de primeiro acesso configurado.');
        setStage('plans');
        return;
      }
      const params = getPortalParams();
      const res = await spedynet.functions.invoke('captiveRegister', {
        ...form,
        plan_id: freeAccessPlan?.id || freeAccessPlan?._id || '',
        plan_name: freeAccessPlan?.name || '',
        plan_price: freeAccessPlan?.price || 0,
        mac: params.mac,
        ip: params.ip,
        link_orig: settings.captive_redirect_url || params.linkOrig,
        minutes: freeAccessPlan.trial_duration_minutes
      });
      setActiveProspect(res.data?.prospect || null);
      setHotspotLogin(res.data?.login || res.data?.authorization);
      setStage('welcome');
    } catch (error) {
      toast.error(error.message || 'Erro ao cadastrar.');
    } finally {
      setLoading(false);
    }
  };

  const ensureClientForPlan = async () => {
    if (activeClient) return activeClient;
    const existing = findClient(form.phone || phone);
    if (existing) return existing;
    const created = await spedynet.entities.Client.create({
      name: form.name || activeProspect?.name || 'Cliente Hotspot',
      phone: form.phone || activeProspect?.phone || phone,
      cpf: form.cpf || activeProspect?.cpf || '',
      cep: form.cep || activeProspect?.cep || '',
      status: 'pending_payment',
      source: 'captive_portal'
    });
    setActiveClient(created);
    return created;
  };

  const continuePlan = async () => {
    if (!selectedPlan) return;
    setLoading(true);
    try {
      const params = getPortalParams();
      const client = await ensureClientForPlan();
      if (planType(selectedPlan) === 'paid') {
        const res = await spedynet.functions.invoke('createPixPayment', {
          clientId: client.id || client._id,
          planId: selectedPlan.id || selectedPlan._id,
          mac: params.mac,
          ip: params.ip
        });
        setPixPayment(res.data.payment);
        setStage('pix');
      } else {
        const res = await spedynet.functions.invoke('activateFreePlan', {
          clientId: client.id || client._id,
          planId: selectedPlan.id || selectedPlan._id,
          mac: params.mac,
          ip: params.ip
        });
        setHotspotLogin(res.data?.login || res.data?.authorization);
        setStage('welcome');
      }
    } catch (error) {
      toast.error(error.message || 'Nao foi possivel continuar.');
    } finally {
      setLoading(false);
    }
  };

  const checkPix = async () => {
    if (!pixPayment) return;
    setLoading(true);
    try {
      const res = await spedynet.functions.invoke('checkPixPayment', {
        id: pixPayment.id,
        provider_payment_id: pixPayment.provider_payment_id
      });
      setPixPayment(res.data.payment);
      if (res.data.payment?.status === 'approved') {
        setHotspotLogin(res.data.payment?.authorization || null);
        setStage('welcome');
      }
      else toast.info('Pagamento ainda pendente.');
    } catch (error) {
      toast.error(error.message || 'Erro ao verificar pagamento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell settings={settings}>
      {stage === 'choice' && (
        <div className="space-y-5">
          <div className="text-center">
            <h1 className="font-black text-base">Ola, seja bem-vindo(a)</h1>
            <p className="mt-4 text-sm leading-6 text-slate-600 text-left">Escolha como deseja acessar nossa rede wi-fi.</p>
          </div>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setStage('client')}
              className="w-full rounded-lg bg-white p-4 text-left shadow-sm border-2 border-white hover:border-[#7c3aed]"
            >
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-[#7c3aed]" />
                <div>
                  <p className="font-black">Sou cliente</p>
                  <p className="text-xs text-slate-600">Liberar direto pelo CPF, telefone ou login</p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setStage('phone')}
              className="w-full rounded-lg bg-white p-4 text-left shadow-sm border-2 border-white hover:border-[#7c3aed]"
            >
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-[#7c3aed]" />
                <div>
                  <p className="font-black">Nao sou cliente</p>
                  <p className="text-xs text-slate-600">Primeiro acesso gratis e cadastro rapido</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {stage === 'client' && (
        <form onSubmit={startAsClient} className="space-y-5">
          <div className="text-center">
            <h1 className="font-black text-base">Ja sou cliente</h1>
            <p className="mt-4 text-sm leading-6 text-slate-600 text-left">Digite seu CPF, telefone ou usuario para liberar o acesso.</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <Label className="text-sm font-semibold">Identificacao</Label>
            <Input value={clientIdentifier} onChange={(e) => setClientIdentifier(e.target.value)} className="mt-2 h-10 border-slate-900 bg-white" placeholder="CPF, telefone ou usuario" />
            <Button disabled={loading} className="mt-4 h-10 w-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Liberar acesso'}
            </Button>
            <button type="button" onClick={() => setStage('choice')} className="mt-3 w-full text-xs text-slate-500">Voltar</button>
          </div>
        </form>
      )}

      {stage === 'phone' && (
        <form onSubmit={startByPhone} className="space-y-5">
          <div className="text-center">
            <h1 className="font-black text-base">Ola, seja bem-vindo(a)</h1>
            <p className="mt-4 text-sm leading-6 text-slate-600 text-left">Notamos que este dispositivo esta acessando nossa rede wi-fi.</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <Label className="text-sm font-semibold">Digite seu Telefone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2 h-10 border-slate-900 bg-white" placeholder="(99) 9 9999-9999" />
            <Button disabled={loading} className="mt-4 h-10 w-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Vamos iniciar!'}
            </Button>
            <button type="button" onClick={() => setStage('choice')} className="mt-3 w-full text-xs text-slate-500">Voltar</button>
          </div>
        </form>
      )}

      {stage === 'register' && (
        <form onSubmit={registerFreeAccess} className="rounded-md bg-white p-4 shadow-sm space-y-3">
          <div className="text-center">
            <h1 className="font-black text-base">Crie sua conta</h1>
            <p className="text-xs text-slate-500">Campos marcados com * sao obrigatorios</p>
          </div>
          <div>
            <Label>Nome*</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 border-slate-900 bg-white" placeholder="Digite seu nome completo" />
          </div>
          <div>
            <Label>Telefone*</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 border-slate-900 bg-white" placeholder="(99) 9 9999-9999" />
          </div>
          <div>
            <Label>CPF*</Label>
            <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} className="mt-1 border-slate-900 bg-white" placeholder="Digite seu CPF" />
          </div>
          <div>
            <Label>CEP</Label>
            <Input value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} className="mt-1 border-slate-900 bg-white" placeholder="Digite seu CEP" />
          </div>
          <Button disabled={loading} className="mt-8 h-10 w-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cadastrar'}
          </Button>
        </form>
      )}

      {stage === 'welcome' && (
        <div className="min-h-[370px] flex flex-col">
          <div className="text-center">
            <h1 className="font-black text-base">Ola {activeClient?.name || activeProspect?.name || form.name || 'cliente'}!</h1>
            <p className="mt-5 text-sm leading-5 text-slate-600 text-left">Seja muito bem-vindo(a) a nossa rede wi-fi. Aproveite a conexao com internet e volte sempre!</p>
          </div>
          <Button onClick={() => loginToMikrotik(hotspotLogin, settings.captive_redirect_url || getPortalParams().linkOrig)} className="mt-auto mx-auto h-10 bg-[#7c3aed] px-6 text-white hover:bg-[#6d28d9]">
            Conectar-se
          </Button>
        </div>
      )}

      {stage === 'plans' && (
        <div className="min-h-[390px] flex flex-col">
          <div className="text-center">
            <h1 className="font-black text-base">Selecione um plano</h1>
            <p className="mt-3 text-sm leading-5 text-slate-600 text-left">{notice || 'Clique em uma das opcoes abaixo para selecionar um plano de internet.'}</p>
          </div>
          <div className="mt-4 space-y-3">
            {visiblePlans.map((plan) => (
              <PlanCard
                key={plan.id || plan._id}
                plan={plan}
                selected={(selectedPlan?.id || selectedPlan?._id) === (plan.id || plan._id)}
                onSelect={(item) => setSelectedPlanId(item.id || item._id)}
              />
            ))}
            {!visiblePlans.length && <p className="text-center text-sm text-slate-600">Nenhum plano disponivel.</p>}
          </div>
          <Button disabled={loading || !selectedPlan} onClick={continuePlan} className="mt-auto h-10 w-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{selectedPlan && planType(selectedPlan) === 'paid' ? 'Continuar para pagamento' : 'Liberar acesso'} <ArrowRight className="w-4 h-4 ml-1" /></>}
          </Button>
        </div>
      )}

      {stage === 'pix' && pixPayment && (
        <div className="min-h-[390px] flex flex-col">
          <div className="text-center">
            <QrCode className="w-7 h-7 mx-auto text-[#7c3aed]" />
            <h1 className="mt-2 font-black text-base">Pagamento Pix</h1>
            <p className="mt-2 text-sm text-slate-600">{pixPayment.plan_name} - {money(pixPayment.amount)}</p>
          </div>
          {pixPayment.qr_code_base64 && (
            <img src={`data:image/png;base64,${pixPayment.qr_code_base64}`} alt="QR Code Pix" className="mx-auto mt-4 w-44 rounded-lg bg-white p-2" />
          )}
          <div className="mt-3 max-h-24 overflow-auto rounded bg-white p-2 text-[10px] break-all text-slate-600">{pixPayment.qr_code}</div>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(pixPayment.qr_code || '').then(() => toast.success('Pix copiado'))}>
              <Copy className="w-4 h-4 mr-1" /> Copiar
            </Button>
            <Button disabled={loading} onClick={checkPix} className="bg-[#7c3aed] text-white hover:bg-[#6d28d9]">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />} Verificar
            </Button>
          </div>
        </div>
      )}
    </Shell>
  );
}
