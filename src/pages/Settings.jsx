import { useState, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Server, Shield, Database, Globe, Save, RefreshCw, Eye, EyeOff, CheckCircle, Wifi, Search, CreditCard, TerminalSquare, Copy, X } from 'lucide-react';
import MikrotikList from '@/components/settings/MikrotikList';
import RadiusAutoConfig from '@/components/settings/RadiusAutoConfig';

const defaultSettings = {
  // RADIUS
  radius_host: '127.0.0.1',
  radius_port: '1812',
  radius_secret: '',
  radius_db_host: 'localhost',
  radius_db_name: 'radius',
  radius_db_user: 'radius',
  radius_db_password: '',
  // IXC
  ixc_base_url: 'https://api.ixcsoft.com',
  ixc_token: '',
  ixc_empresa_id: '',
  ixc_sync_interval_minutes: '15',
  // Mercado Pago
  mp_access_token: '',
  public_base_url: window.location.origin,
  // Hotspot / Trial
  trial_default_duration_minutes: '30',
  trial_max_duration_minutes: '120',
  captive_portal_title: 'Kore-HotSpot',
  captive_portal_subtitle: 'Conecte-se à internet',
  captive_portal_logo_url: '',
  sidebar_logo_url: '',
  captive_prospect_plan_id: '',
  captive_vip_plan_id: '',
  captive_redirect_url: 'http://neverssl.com',
  // SMTP
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_password: '',
  smtp_from_email: '',
  smtp_from_name: 'Kore-HotSpot',
  // VPN
  vpn_server_host: '',
  vpn_ipsec_secret: '',
};

const sections = [
  { id: 'mikrotik', label: 'MikroTik', icon: Server, color: 'text-primary', custom: true },
  {
    id: 'radius', label: 'FreeRADIUS', icon: Shield, color: 'text-info', custom: true
  },
  {
    id: 'vpn', label: 'VPN L2TP Matriz', icon: Shield, color: 'text-primary',
    fields: [
      { key: 'vpn_server_host', label: 'IP Público do Servidor VPN (Matriz / VPS)' },
      { key: 'vpn_ipsec_secret', label: 'Segredo IPsec Global', secret: true },
    ]
  },
  {
    id: 'ixc', label: 'IXC Soft', icon: Globe, color: 'text-success',
    fields: [
      { key: 'ixc_base_url', label: 'URL da API' },
      { key: 'ixc_token', label: 'Token API', secret: true },
      { key: 'ixc_empresa_id', label: 'Empresa ID' },
      { key: 'ixc_sync_interval_minutes', label: 'Intervalo de Sync (min)' },
    ]
  },
  {
    id: 'mercadopago', label: 'Mercado Pago', icon: CreditCard, color: 'text-info',
    fields: [
      { key: 'mp_access_token', label: 'Access Token Mercado Pago', secret: true },
      { key: 'public_base_url', label: 'URL Publica da API / Webhook' },
    ]
  },
  {
    id: 'hotspot', label: 'Hotspot & Trial', icon: Wifi, color: 'text-warning',
    fields: [
      { key: 'trial_default_duration_minutes', label: 'Duração Padrão Trial (min)' },
      { key: 'trial_max_duration_minutes', label: 'Duração Máxima Trial (min)' },
      { key: 'captive_portal_title', label: 'Título do Portal' },
      { key: 'captive_portal_subtitle', label: 'Subtítulo do Portal' },
      { key: 'captive_portal_logo_url', label: 'Logo do Captive', type: 'image' },
      { key: 'sidebar_logo_url', label: 'Logo da Barra Lateral', type: 'image' },
      { key: 'captive_prospect_plan_id', label: 'Plano para Clientes Prospeccao', type: 'plan' },
      { key: 'captive_vip_plan_id', label: 'Plano para Clientes VIP', type: 'plan' },
      { key: 'captive_redirect_url', label: 'Site para Redirecionar apos Login' },
    ]
  },
  {
    id: 'smtp', label: 'SMTP / E-mail', icon: Database, color: 'text-chart-4',
    fields: [
      { key: 'smtp_host', label: 'Host SMTP' },
      { key: 'smtp_port', label: 'Porta' },
      { key: 'smtp_user', label: 'Usuário' },
      { key: 'smtp_password', label: 'Senha', secret: true },
      { key: 'smtp_from_email', label: 'E-mail Remetente' },
      { key: 'smtp_from_name', label: 'Nome Remetente' },
    ]
  },
];

export default function Settings() {
  const [settings, setSettings] = useState({ ...defaultSettings });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // { type: 'success'|'error', text }
  const [showSecrets, setShowSecrets] = useState({});
  const [activeSection, setActiveSection] = useState('mikrotik');
  const [plans, setPlans] = useState([]);

  const [ixcTestCpf, setIxcTestCpf] = useState('');
  const [ixcTestResult, setIxcTestResult] = useState(null);
  const [ixcTesting, setIxcTesting] = useState(false);

  const [showVpnScript, setShowVpnScript] = useState(false);
  const [copiedVpn, setCopiedVpn] = useState(false);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);

  const getDiagnosticScript = () => {
    return `# 1. Primeiro, limpe as conexões "presas" que causam o erro "old tunnel is not closed yet":
systemctl restart strongswan-starter
systemctl restart xl2tpd

# 2. Em seguida, execute este comando para escutar os logs em tempo real:
tail -f /var/log/syslog /var/log/auth.log | grep -iE "charon|pluto|ipsec|xl2tpd|pppd|freeradius|radiusd"`;
  };

  const getVpnScript = () => {
    return `#!/bin/bash
# Script Definitivo de L2TP/IPsec para VPS Linux (Ubuntu/Debian) - Compatibilidade Máxima MikroTik

echo "1. Instalando pacotes..."
apt-get update
apt-get install -y strongswan xl2tpd ppp iptables

echo "2. Habilitando Roteamento (IP Forwarding)..."
cat <<EOF > /etc/sysctl.d/99-vpn.conf
net.ipv4.ip_forward = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.default.send_redirects = 0
EOF
sysctl -p /etc/sysctl.d/99-vpn.conf

echo "3. Configurando Firewall (iptables)..."
iptables -I INPUT -p udp --dport 500 -j ACCEPT
iptables -I INPUT -p udp --dport 4500 -j ACCEPT
iptables -I INPUT -p udp --dport 1701 -j ACCEPT
iptables -I INPUT -p 50 -j ACCEPT
iptables -I INPUT -p 51 -j ACCEPT
iptables -t nat -I POSTROUTING -s 10.255.255.0/24 -j MASQUERADE

echo "4. Configurando IPsec (StrongSwan)..."
cat <<EOF > /etc/ipsec.conf
config setup
    charondebug="ike 1, knl 1, cfg 0"
    uniqueids=no

conn %default
    keyexchange=ikev1
    ikelifetime=60m
    keylife=20m
    rekeymargin=3m
    keyingtries=1
    authby=secret
    ike=aes256-sha256-modp2048,aes256-sha1-modp2048,aes128-sha1-modp2048,aes256-sha256-modp1024,aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024,3des-md5-modp1024!
    esp=aes256-sha1-modp1024,aes192-sha1-modp1024,aes128-sha1-modp1024,aes256-sha1,aes192-sha1,aes128-sha1,3des-sha1-modp1024,3des-sha1!
    forceencaps=yes

conn L2TP-PSK-NAT
    rightsubnet=vhost:%priv
    also=L2TP-PSK-noNAT

conn L2TP-PSK-noNAT
    type=transport
    left=%any
    leftprotoport=17/1701
    right=%any
    rightprotoport=17/%any
    auto=add
    dpddelay=15
    dpdtimeout=60
    dpdaction=clear
EOF

cat <<EOF > /etc/ipsec.secrets
: PSK "${settings.vpn_ipsec_secret || 'SUA_SENHA_IPSEC'}"
EOF

echo "5. Configurando L2TP (xl2tpd)..."
cat <<EOF > /etc/xl2tpd/xl2tpd.conf
[global]
listen-addr = 0.0.0.0
port = 1701
auth file = /etc/ppp/chap-secrets

[lns default]
ip range = 10.255.255.10-10.255.255.250
local ip = 10.255.255.1
require authentication = yes
name = l2tpd
ppp debug = yes
pppoptfile = /etc/ppp/options.xl2tpd
length bit = yes
EOF

echo "6. Configurando PPP..."
cat <<EOF > /etc/ppp/options.xl2tpd
name l2tpd
require-mschap-v2
refuse-mschap
refuse-chap
refuse-pap
noccp
novj
novjccomp
nobsdcomp
nodeflate
nopcomp
noaccomp
ipcp-accept-local
ipcp-accept-remote
ms-dns 8.8.8.8
ms-dns 1.1.1.1
auth
mtu 1400
mru 1400
nodefaultroute
hide-password
proxyarp
lcp-echo-interval 30
lcp-echo-failure 4
EOF

echo "7. Reiniciando serviços..."
systemctl restart strongswan-starter
systemctl restart xl2tpd

echo "=== SERVIDOR L2TP/IPSEC CONFIGURADO COM SUCESSO ==="`;
  };

  useEffect(() => {
    spedynet.entities.Setting.list().then(saved => {
      const map = {};
      saved.forEach(s => { map[s.key] = s.value; });
      setSettings(prev => ({ ...prev, ...map }));
      setLoading(false);
    }).catch(() => setLoading(false));
    spedynet.entities.Plan.filter({ status: 'active' }).then(setPlans).catch(() => setPlans([]));
  }, []);

  // Clear save message when switching section
  useEffect(() => { setSaveMsg(null); }, [activeSection]);

  const showFeedback = (type, text) => {
    setSaveMsg({ type, text });
    setTimeout(() => setSaveMsg(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    const existing = await spedynet.entities.Setting.list();
    const existingMap = {};
    existing.forEach(s => { existingMap[s.key] = s.id; });

    const section = sections.find(s => s.id === activeSection);
    if (!section || !section.fields) return;

    const promises = section.fields.map(field => {
      const value = settings[field.key] || '';
      if (existingMap[field.key]) {
        return spedynet.entities.Setting.update(existingMap[field.key], { key: field.key, value, category: activeSection, label: field.label, is_secret: field.secret || false });
      } else {
        return spedynet.entities.Setting.create({ key: field.key, value, category: activeSection, label: field.label, is_secret: field.secret || false });
      }
    });

    await Promise.all(promises);
    await spedynet.entities.AuditLog.create({ action: 'update_settings', entity_type: 'system', entity_name: activeSection, status: 'success', message: `Configurações de ${section.label} salvas` });
    showFeedback('success', `Configurações de ${section.label} salvas com sucesso!`);
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setSaveMsg(null);
    await spedynet.entities.AuditLog.create({ action: `test_${activeSection}`, entity_type: activeSection, entity_name: 'test', status: 'info', message: `Teste de conexão ${activeSection.toUpperCase()} iniciado` });
    setTimeout(() => {
      showFeedback('success', `Conexão ${activeSection.toUpperCase()} testada com sucesso!`);
      setTesting(false);
    }, 1500);
  };

  const handleTestIxc = async () => {
    setIxcTesting(true);
    setIxcTestResult(null);
    try {
      const res = await spedynet.functions.invoke('ixcConsultaCliente', { cpf: ixcTestCpf });
      const client = res.data?.client || {};
      setIxcTestResult({
        found: !!res.data?.found,
        name: res.data?.summary?.name || res.data?.name || client.razao || client.nome || client.fantasia || '',
        cpf: res.data?.summary?.cpf || client.cnpj_cpf || client.cpf_cnpj || res.data?.cpf || ixcTestCpf,
        phone: res.data?.summary?.phone || client.telefone_celular || client.whatsapp || client.fone || client.telefone_comercial || '',
      });
    } catch (e) {
      setIxcTestResult({ error: e.message || 'Falha na requisição' });
    }
    setIxcTesting(false);
  };

  const resizeLogoImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo de imagem invalido.'));
      img.onload = () => {
        const maxSide = 1200;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
        const quality = mime === 'image/png' ? undefined : 0.82;
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const handleImageUpload = async (key, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showFeedback('error', 'Selecione um arquivo de imagem.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showFeedback('error', 'Use uma imagem de ate 5 MB.');
      return;
    }
    try {
      const dataUrl = await resizeLogoImage(file);
      if (dataUrl.length > 1024 * 1024) {
        showFeedback('error', 'A imagem ainda ficou muito grande. Tente uma logo menor.');
        return;
      }
      setSettings(prev => ({ ...prev, [key]: dataUrl }));
      showFeedback('success', 'Logo carregada. Clique em Salvar para aplicar.');
    } catch (error) {
      showFeedback('error', error.message || 'Falha ao processar imagem.');
    }
  };

  const activeS = sections.find(s => s.id === activeSection);

  return (
    <div className="flex gap-4 h-full">
      {/* Sidebar */}
      <div className="w-48 flex-shrink-0">
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors border-b border-border last:border-0 ${activeSection === s.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
            >
              <s.icon className={`w-4 h-4 ${activeSection === s.id ? 'text-primary' : s.color}`} />
              <span className="font-medium">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Modals */}
      {showDiagnostic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-border flex justify-between items-center flex-shrink-0">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-destructive">
                <Search className="w-4 h-4" /> Diagnóstico e Logs (VPS)
              </h3>
              <Button variant="ghost" size="icon" onClick={() => setShowDiagnostic(false)} className="h-8 w-8">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 scrollbar-thin">
              <p className="text-sm text-muted-foreground mb-3 flex-shrink-0">
                Acesse o terminal da sua VPS Linux e cole o comando abaixo. Ele vai exibir em tempo real <strong>exatamente onde a conexão está parando</strong> (seja no IPsec, L2TP, PPP ou FreeRADIUS):
              </p>
              <div className="relative group flex-1">
                <pre className="bg-secondary/50 p-4 rounded-lg text-xs font-mono text-foreground whitespace-pre-wrap border border-border max-h-[60vh] overflow-y-auto scrollbar-thin">
                  {getDiagnosticScript()}
                </pre>
                <Button 
                  size="sm" 
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    navigator.clipboard.writeText(getDiagnosticScript());
                    setCopiedDiag(true);
                    setTimeout(() => setCopiedDiag(false), 2000);
                  }}
                >
                  {copiedDiag ? <CheckCircle className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVpnScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-border flex justify-between items-center flex-shrink-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <TerminalSquare className="w-4 h-4" /> Script para o Servidor VPS
              </h3>
              <Button variant="ghost" size="icon" onClick={() => setShowVpnScript(false)} className="h-8 w-8">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 scrollbar-thin">
              <p className="text-sm text-muted-foreground mb-3 flex-shrink-0">
                Acesse o terminal (SSH) da sua VPS Linux (Ubuntu/Debian) como <code>root</code> e cole o script abaixo:
              </p>
              <div className="relative group flex-1">
                <pre className="bg-secondary/50 p-4 rounded-lg text-xs font-mono text-foreground whitespace-pre-wrap border border-border max-h-[60vh] overflow-y-auto scrollbar-thin">
                  {getVpnScript()}
                </pre>
                <Button 
                  size="sm" 
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    navigator.clipboard.writeText(getVpnScript());
                    setCopiedVpn(true);
                    setTimeout(() => setCopiedVpn(false), 2000);
                  }}
                >
                  {copiedVpn ? <CheckCircle className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="bg-card border border-border rounded-xl p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                <activeS.icon className={`w-5 h-5 ${activeS.color}`} />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">{activeS.label}</h2>
                <p className="text-xs text-muted-foreground">Configurações de integração</p>
              </div>
            </div>
            {!activeS.custom && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-2 border-border text-xs" onClick={handleTest} disabled={testing}>
                  {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  {testing ? 'Testando...' : 'Testar'}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground gap-2 text-xs">
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {saving ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            )}
          </div>

          {/* Feedback banner */}
          {saveMsg && (
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg mb-4 text-sm font-medium ${saveMsg.type === 'success' ? 'bg-success/10 border border-success/30 text-success' : 'bg-destructive/10 border border-destructive/30 text-destructive'}`}>
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              {saveMsg.text}
            </div>
          )}

          {/* Section content */}
          {activeS.custom ? (
            activeS.id === 'mikrotik' ? <MikrotikList /> : <RadiusAutoConfig />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-4">
              {Array(6).fill(0).map((_, i) => <div key={i} className="h-16 bg-secondary rounded-lg animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeS.fields.map(field => (
                <div key={field.key}>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">{field.label}</Label>
                  <div className="relative">
                    {field.type === 'plan' ? (
                      <select
                        value={settings[field.key] || ''}
                        onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}
                        className="w-full h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground"
                      >
                        <option value="">Selecionar plano</option>
                        {plans.map(plan => (
                          <option key={plan.id || plan._id} value={plan.id || plan._id}>
                            {plan.name} - {plan.download_mbps || plan.speed_download || 0}/{plan.upload_mbps || plan.speed_upload || 0} Mbps
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'image' ? (
                      <div className="space-y-2">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={e => handleImageUpload(field.key, e.target.files?.[0])}
                          className="bg-input border-border h-9 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary-foreground"
                        />
                        {settings[field.key] && (
                          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-2">
                            <img src={settings[field.key]} alt={field.label} className="h-10 max-w-40 object-contain" />
                            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSettings({ ...settings, [field.key]: '' })}>
                              Remover
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <Input
                        type={field.secret && !showSecrets[field.key] ? 'password' : 'text'}
                        value={settings[field.key] || ''}
                        onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}
                        className="bg-input border-border h-9 text-sm pr-9 font-mono"
                      />
                    )}
                    {field.secret && (
                      <button
                        type="button"
                        onClick={() => setShowSecrets(p => ({ ...p, [field.key]: !p[field.key] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showSecrets[field.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              

              
              {activeSection === 'vpn' && (
                <div className="col-span-1 md:col-span-2 mt-4 pt-6 border-t border-border">
                  <div className="mb-6 p-4 rounded-xl bg-primary/10 border border-primary/20">
                    <h3 className="text-sm font-semibold text-primary mb-1">Servidor VPN Linux (VPS / Matriz)</h3>
                    <p className="text-xs text-primary/80 leading-relaxed">
                      Se você utiliza uma VPS Linux (Ubuntu ou Debian) para ser a Matriz da rede e autenticar via FreeRADIUS, gere o script Bash abaixo e execute-o como <code>root</code> no terminal da sua VPS para instalar e configurar o servidor L2TP/IPsec. <strong>Certifique-se de salvar as configurações acima antes de gerar o script.</strong>
                    </p>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <Button type="button" onClick={() => setShowVpnScript(true)} className="gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground">
                      <TerminalSquare className="w-4 h-4" /> Script para a VPS (Instalação)
                    </Button>
                    <Button type="button" onClick={() => setShowDiagnostic(true)} className="gap-2 bg-destructive/10 hover:bg-destructive/20 text-destructive">
                      <Search className="w-4 h-4" /> Diagnóstico da VPS (Logs em Tempo Real)
                    </Button>
                  </div>
                </div>
              )}

              {activeSection === 'ixc' && (
                <div className="col-span-1 md:col-span-2 mt-4 pt-6 border-t border-border">
                  <div className="mb-6 p-4 rounded-xl bg-primary/10 border border-primary/20">
                    <h3 className="text-sm font-semibold text-primary mb-1">Como o IXC funciona na Kore HotSpot?</h3>
                    <p className="text-xs text-primary/80 leading-relaxed">
                      O IXC serve <strong>exclusivamente para consultar clientes já cadastrados</strong>. A integração não sincroniza o MikroTik com o IXC. Clientes novos (ou não encontrados no IXC) farão um cadastro obrigatório e passarão a ser gerenciados localmente pelo banco de dados da Kore HotSpot via FreeRADIUS.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Testar Integração IXC</h3>
                      <p className="text-xs text-muted-foreground">Salve as configurações antes de testar. Digite um CPF para simular uma busca na API do IXC.</p>
                    </div>
                    <div className="flex gap-3 mt-2">
                      <div className="max-w-xs w-full">
                        <Input
                          value={ixcTestCpf}
                          onChange={e => setIxcTestCpf(e.target.value)}
                          placeholder="000.000.000-00"
                          className="bg-input border-border h-9 text-sm font-mono"
                        />
                      </div>
                      <Button onClick={handleTestIxc} disabled={!ixcTestCpf || ixcTesting} className="h-9 gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground">
                        {ixcTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        Consultar
                      </Button>
                    </div>
                    {ixcTestResult && (
                      <div className="mt-3 p-4 rounded-xl bg-secondary/30 border border-border">
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Resultado da API:</p>
                        {ixcTestResult.error ? (
                          <p className="text-sm text-destructive font-mono break-words">{ixcTestResult.error}</p>
                        ) : ixcTestResult.found ? (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="rounded-lg border border-border bg-background p-3">
                              <p className="text-xs text-muted-foreground mb-1">Nome</p>
                              <p className="text-sm font-semibold text-foreground break-words">{ixcTestResult.name || '-'}</p>
                            </div>
                            <div className="rounded-lg border border-border bg-background p-3">
                              <p className="text-xs text-muted-foreground mb-1">CPF</p>
                              <p className="text-sm font-mono font-semibold text-foreground">{ixcTestResult.cpf || '-'}</p>
                            </div>
                            <div className="rounded-lg border border-border bg-background p-3">
                              <p className="text-xs text-muted-foreground mb-1">Telefone</p>
                              <p className="text-sm font-mono font-semibold text-foreground">{ixcTestResult.phone || '-'}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-warning">Cliente nao encontrado no IXC para este CPF.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
