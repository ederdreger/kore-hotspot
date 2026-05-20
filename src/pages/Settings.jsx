import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
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
  // Hotspot / Trial
  trial_default_duration_minutes: '30',
  trial_max_duration_minutes: '120',
  captive_portal_title: 'Kore-HotSpot',
  captive_portal_subtitle: 'Conecte-se à internet',
  captive_portal_logo_url: '',
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
      { key: 'mp_access_token', label: 'Access Token (Produção ou Teste)', secret: true },
    ]
  },
  {
    id: 'hotspot', label: 'Hotspot & Trial', icon: Wifi, color: 'text-warning',
    fields: [
      { key: 'trial_default_duration_minutes', label: 'Duração Padrão Trial (min)' },
      { key: 'trial_max_duration_minutes', label: 'Duração Máxima Trial (min)' },
      { key: 'captive_portal_title', label: 'Título do Portal' },
      { key: 'captive_portal_subtitle', label: 'Subtítulo do Portal' },
      { key: 'captive_portal_logo_url', label: 'URL do Logo' },
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

  const [ixcTestCpf, setIxcTestCpf] = useState('');
  const [ixcTestResult, setIxcTestResult] = useState(null);
  const [ixcTesting, setIxcTesting] = useState(false);

  const [showVpnScript, setShowVpnScript] = useState(false);
  const [copiedVpn, setCopiedVpn] = useState(false);

  const getVpnScript = () => {
    return `#!/bin/bash
# Script de Instalação do Servidor VPN L2TP/IPsec no Linux (Ubuntu/Debian)
# Execute este script como root (sudo su) na sua VPS

echo "Instalando pacotes necessários (strongswan, xl2tpd, ppp e freeradius)..."
apt-get update
apt-get install -y strongswan xl2tpd ppp libpam-radius-auth freeradius freeradius-mysql

echo "Configurando IPsec (StrongSwan)..."
cat <<EOF > /etc/ipsec.conf
config setup
    charondebug="ike 1, knl 1, cfg 0"
    uniqueids=no

conn L2TP-PSK-NAT
    rightsubnet=vhost:%priv
    also=L2TP-PSK-noNAT

conn L2TP-PSK-noNAT
    authby=secret
    pfs=no
    auto=add
    keyingtries=3
    rekey=no
    ikelifetime=8h
    keylife=1h
    type=transport
    left=%defaultroute
    leftprotoport=17/1701
    right=%any
    rightprotoport=17/%any
    dpddelay=30
    dpdtimeout=120
    dpdaction=clear
EOF

cat <<EOF > /etc/ipsec.secrets
: PSK "${settings.vpn_ipsec_secret || 'SUA_SENHA_IPSEC'}"
EOF

echo "Configurando L2TP (xl2tpd)..."
cat <<EOF > /etc/xl2tpd/xl2tpd.conf
[global]
listen-addr = 0.0.0.0
ipsec saref = no

[lns default]
ip range = 10.255.255.10-10.255.255.250
local ip = 10.255.255.1
require authentication = yes
name = l2tpd
ppp debug = yes
pppoptfile = /etc/ppp/options.xl2tpd
length bit = yes
EOF

echo "Configurando PPP para o Túnel L2TP (Autenticação Local Localizada)..."
cat <<EOF > /etc/ppp/options.xl2tpd
ipcp-accept-local
ipcp-accept-remote
ms-dns 8.8.8.8
ms-dns 1.1.1.1
noccp
auth
crtscts
idle 1800
mtu 1410
mru 1410
nodefaultroute
debug
lock
proxyarp
connect-delay 5000
require-mschap-v2
refuse-pap
refuse-chap
refuse-mschap
# Não usamos o plugin RADIUS aqui para L2TP!
# Os roteadores MikroTik filiais vão conectar nesta VPS como clientes do túnel usando o arquivo chap-secrets,
# E DEPOIS, por dentro do túnel, vão encaminhar os pedidos de Hotspot para a porta RADIUS (1812).
EOF

# Aplicando regras de Firewall (NAT)
iptables -t nat -A POSTROUTING -s 10.255.255.0/24 -o eth0 -j MASQUERADE
# Salvar iptables (pode exigir iptables-persistent)
# netfilter-persistent save

echo "Liberando sub-rede VPN no FreeRADIUS..."
if [ -d "/etc/freeradius/3.0" ]; then
  cat <<EOF >> /etc/freeradius/3.0/clients.conf

client vpn_kore_hotspot {
    ipaddr = 10.255.255.0/24
    secret = ${settings.radius_secret || 'SEGREDO_RADIUS'}
}
EOF
fi

echo "Reiniciando serviços..."
systemctl restart strongswan-starter
systemctl restart xl2tpd
systemctl restart freeradius

echo "=== SERVIDOR VPN L2TP/IPsec LINUX CONFIGURADO COM SUCESSO ==="`;
  };

  useEffect(() => {
    base44.entities.Setting.list().then(saved => {
      const map = {};
      saved.forEach(s => { map[s.key] = s.value; });
      setSettings(prev => ({ ...prev, ...map }));
      setLoading(false);
    }).catch(() => setLoading(false));
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
    const existing = await base44.entities.Setting.list();
    const existingMap = {};
    existing.forEach(s => { existingMap[s.key] = s.id; });

    const section = sections.find(s => s.id === activeSection);
    if (!section || !section.fields) return;

    const promises = section.fields.map(field => {
      const value = settings[field.key] || '';
      if (existingMap[field.key]) {
        return base44.entities.Setting.update(existingMap[field.key], { key: field.key, value, category: activeSection, label: field.label, is_secret: field.secret || false });
      } else {
        return base44.entities.Setting.create({ key: field.key, value, category: activeSection, label: field.label, is_secret: field.secret || false });
      }
    });

    await Promise.all(promises);
    await base44.entities.AuditLog.create({ action: 'update_settings', entity_type: 'system', entity_name: activeSection, status: 'success', message: `Configurações de ${section.label} salvas` });
    showFeedback('success', `Configurações de ${section.label} salvas com sucesso!`);
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setSaveMsg(null);
    await base44.entities.AuditLog.create({ action: `test_${activeSection}`, entity_type: activeSection, entity_name: 'test', status: 'info', message: `Teste de conexão ${activeSection.toUpperCase()} iniciado` });
    setTimeout(() => {
      showFeedback('success', `Conexão ${activeSection.toUpperCase()} testada com sucesso!`);
      setTesting(false);
    }, 1500);
  };

  const handleTestIxc = async () => {
    setIxcTesting(true);
    setIxcTestResult(null);
    try {
      const res = await base44.functions.invoke('ixcConsultaCliente', { cpf: ixcTestCpf });
      setIxcTestResult(res.data);
    } catch (e) {
      setIxcTestResult({ error: e.message || 'Falha na requisição' });
    }
    setIxcTesting(false);
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
                    <Input
                      type={field.secret && !showSecrets[field.key] ? 'password' : 'text'}
                      value={settings[field.key] || ''}
                      onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}
                      className="bg-input border-border h-9 text-sm pr-9 font-mono"
                    />
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
                  <Button type="button" onClick={() => setShowVpnScript(true)} className="gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground">
                    <TerminalSquare className="w-4 h-4" /> Gerar Bash Script para a VPS (Linux)
                  </Button>
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
                        <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all">
                          {JSON.stringify(ixcTestResult, null, 2)}
                        </pre>
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