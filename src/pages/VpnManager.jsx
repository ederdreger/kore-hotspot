import { useState, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Network, Plus, Trash2, Shield, Copy, Check, TerminalSquare, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import VpnRealtimeMonitor from '@/components/dashboard/VpnRealtimeMonitor';

export default function VpnManager() {
  const { getToken } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [mikrotiks, setMikrotiks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showScript, setShowScript] = useState(null); // account id
  const [copied, setCopied] = useState(false);
  const [ipsecSecret, setIpsecSecret] = useState('');
  const [activeVpnIps, setActiveVpnIps] = useState([]);

  const [formData, setFormData] = useState({
    name: '',
    mikrotik_server_id: 'global_vps',
    username: '',
    password: '',
    remote_ip: '10.255.255.2'
  });

  const nextVpnIp = (extraAccounts = accounts, extraMikrotiks = mikrotiks, extraActiveIps = activeVpnIps) => {
    const used = new Set([
      '10.255.255.1',
      ...extraAccounts.map((account) => account.remote_ip),
      ...extraMikrotiks.map((mt) => mt.vpn_remote_ip || mt.remote_ip || mt.host),
      ...extraActiveIps
    ].filter((ip) => /^10\.255\.255\.\d+$/.test(String(ip || ''))));

    for (let last = 2; last <= 254; last += 1) {
      const ip = `10.255.255.${last}`;
      if (!used.has(ip)) return ip;
    }
    return '';
  };

  const openNewConnection = () => {
    const ip = nextVpnIp();
    setFormData((current) => ({
      ...current,
      name: '',
      username: '',
      password: '',
      remote_ip: ip || current.remote_ip
    }));
    setShowModal(true);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const accs = await spedynet.entities.VpnAccount.list('-created_date', 100);
      setAccounts(accs);
      const vpnStatus = await spedynet.functions.invoke('vpnStatus').catch(() => null);
      setActiveVpnIps((vpnStatus?.data?.vpn_connections || []).map((conn) => conn.address));
      
      const mtiksRaw = await spedynet.entities.Setting.filter({ category: 'mikrotik_device' });
      const mtiks = mtiksRaw.map(s => {
        try { return { id: s.id, ...JSON.parse(s.value) }; } catch { return null; }
      }).filter(Boolean);
      setMikrotiks(mtiks);

      const secretRaw = await spedynet.entities.Setting.filter({ key: 'vpn_ipsec_secret' });
      if (secretRaw.length > 0) setIpsecSecret(secretRaw[0].value);
      else setIpsecSecret('korevpn123'); // Default

      setFormData(f => ({ ...f, mikrotik_server_id: 'global_vps' }));
    } catch (e) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSecret = async () => {
    try {
      const existing = await spedynet.entities.Setting.filter({ key: 'vpn_ipsec_secret' });
      if (existing.length > 0) {
        await spedynet.entities.Setting.update(existing[0].id, { value: ipsecSecret });
      } else {
        await spedynet.entities.Setting.create({
          key: 'vpn_ipsec_secret',
          value: ipsecSecret,
          category: 'system',
          label: 'VPN IPsec Secret'
        });
      }
      toast.success('Segredo IPsec salvo');
    } catch (e) {
      toast.error('Erro ao salvar segredo');
    }
  };

  const handleProvisionServer = async (serverMtik) => {
    toast.loading('Configurando Servidor L2TP...');
    try {
      const res = await spedynet.functions.invoke('mikrotikVpnManager', {
        action: 'enable_server',
        server_host: serverMtik.host,
        server_port: serverMtik.port,
        server_user: serverMtik.user || 'admin',
        server_password: serverMtik.password || '',
        ipsec_secret: ipsecSecret,
        token: getToken()
      });

      if (res.data.success) {
        toast.dismiss();
        toast.success('Servidor L2TP configurado com sucesso!');
      } else {
        throw new Error(res.data.error);
      }
    } catch (e) {
      toast.dismiss();
      toast.error(e.message || 'Erro ao configurar servidor');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    
    // Removido disparo pro MikroTik Matriz, pois agora o servidor é a própria VPS via RADIUS

    try {
      await spedynet.entities.VpnAccount.create(formData);
      await spedynet.functions.invoke('vpnCreateUser', {
        username: formData.username,
        password: formData.password,
        remote_ip: formData.remote_ip
      });

      toast.success('Conta VPN criada e cadastrada automaticamente na VPS');
      setShowModal(false);
      setFormData({
        ...formData,
        name: '',
        username: '',
        password: '',
        remote_ip: nextVpnIp([...accounts, formData])
      });
      loadData();
    } catch (e) {
      toast.error(e.message || 'Erro ao criar conta VPN');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (account) => {
    if (!confirm('Deseja realmente excluir esta conta VPN?')) return;
    
    try {
      await spedynet.entities.VpnAccount.delete(account.id);
      toast.success('Conta excluída do sistema');
      loadData();
    } catch (e) {
      toast.error('Erro ao excluir conta');
    }
  };

  const [globalVpnIp, setGlobalVpnIp] = useState('');

  useEffect(() => {
    spedynet.entities.Setting.filter({ key: 'vpn_server_host' }).then(res => {
      if (res.length > 0) setGlobalVpnIp(res[0].value);
    });
  }, []);

  const getClientScript = (account) => {
    const serverIp = globalVpnIp || window.location.hostname;
    return `# Limpeza de configs antigas
:do { /interface l2tp-client remove [find name="l2tp-matriz"] } on-error={}
:do { /ppp profile remove [find name="kore-vpn-profile"] } on-error={}
:do { /ip route remove [find comment="Rota para a Matriz"] } on-error={}

# Perfil forçando MSCHAPv2
/ppp profile add name="kore-vpn-profile" use-encryption=yes use-mpls=default only-one=default

# Tunel cliente com protocolos estritos
/interface l2tp-client add connect-to="${serverIp}" name="l2tp-matriz" user="${account.username}" password="${account.password}" profile="kore-vpn-profile" use-ipsec=yes ipsec-secret="${ipsecSecret}" allow=mschap2 disabled=no

:delay 3s
:if ([:len [/interface l2tp-client find name="l2tp-matriz"]] > 0) do={
  /ip route add dst-address=10.255.255.1/32 gateway="l2tp-matriz" comment="Rota para a Matriz"
} else={
  :error "Interface l2tp-matriz nao foi criada. Verifique IP da VPS, usuario, senha e IPsec Secret."
}
# Tunnel criado! Use o IP ${account.remote_ip} no sistema para gerenciar.`;
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Script copiado!');
  };

  if (loading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VPN L2TP/IPsec</h1>
          <p className="text-muted-foreground mt-1">Integre filiais sem IP público através de tuneis seguros.</p>
        </div>
        <Button onClick={openNewConnection} className="gap-2">
          <Plus className="w-4 h-4" /> Nova Conexão
        </Button>
      </div>

      {mikrotiks.length > 0 && (
        <VpnRealtimeMonitor mikrotik={mikrotiks[0]} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Col - Global Settings */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> Configuração Global
            </h3>
            
            <div className="space-y-4">
              <div>
                <Label>IPsec Pre-Shared Key (Secret)</Label>
                <div className="flex gap-2 mt-1">
                  <Input 
                    type="text" 
                    value={ipsecSecret}
                    onChange={(e) => setIpsecSecret(e.target.value)}
                    placeholder="korevpn123"
                  />
                  <Button variant="secondary" onClick={handleSaveSecret}>Salvar</Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Esta senha será usada para criptografar todos os túneis.
                </p>
              </div>

              <div className="pt-4 border-t border-border mt-4">
                <p className="text-xs text-muted-foreground mb-3">
                  Para gerar o script Bash de instalação do seu Servidor VPN L2TP (Linux Ubuntu/Debian na VPS), vá em <strong>Configurações &gt; VPN L2TP Matriz</strong>.
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-info/10 border border-info/20 rounded-xl p-4 flex gap-3 text-info">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold mb-1">Como funciona?</p>
              <p className="opacity-90">1. Vá em <strong>Configurações</strong> e instale o Servidor VPN L2TP/IPsec na sua VPS Linux (Matriz).</p>
              <p className="opacity-90 mt-1">2. As contas VPN autenticarão automaticamente no banco FreeRADIUS.</p>
              <p className="opacity-90 mt-1">3. Crie os clientes aqui, gere o script e cole no MikroTik do cliente (que está via NAT).</p>
              <p className="opacity-90 mt-1">4. No sistema, cadastre o equipamento do cliente usando o IP remoto VPN (ex: 10.255.255.2).</p>
            </div>
          </div>
        </div>

        {/* Right Col - Accounts List */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between bg-secondary/30">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" /> Conexões VPN (Clientes)
              </h3>
            </div>
            
            {accounts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Network className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>Nenhuma conta VPN cadastrada.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {accounts.map(acc => {
                  const server = mikrotiks.find(m => m.id === acc.mikrotik_server_id);
                  return (
                    <div key={acc.id} className="p-4 flex flex-col sm:flex-row gap-4 justify-between sm:items-center hover:bg-secondary/20 transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-foreground">{acc.name}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${activeVpnIps.includes(acc.remote_ip) ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
                            {activeVpnIps.includes(acc.remote_ip) ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                          <span>User: <strong className="text-foreground">{acc.username}</strong></span>
                          <span>IP VPN: <strong className="text-primary">{acc.remote_ip}</strong></span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Matriz: Servidor VPS Linux
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowScript(acc.id)} className="h-8 text-xs gap-1">
                          <TerminalSquare className="w-3.5 h-3.5" /> Script
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(acc)} className="h-8 text-xs text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                      {showScript === acc.id && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
                            <div className="p-4 border-b border-border flex justify-between items-center shrink-0">
                              <h3 className="font-semibold text-sm flex items-center gap-2">
                                <TerminalSquare className="w-4 h-4" /> Scripts de Configuração
                              </h3>
                              <Button variant="ghost" size="icon" onClick={() => setShowScript(null)} className="h-8 w-8">
                                X
                              </Button>
                            </div>
                            <div className="p-4 overflow-y-auto space-y-6">
                              
                              {/* Provisionamento VPS (Servidor) */}
                              <div>
                                <h4 className="font-semibold text-sm text-primary mb-2">1. Servidor VPS (Linux)</h4>
                                <p className="text-xs text-muted-foreground mb-3">
                                  O usuário L2TP é cadastrado automaticamente na VPS quando a conexão é criada. Use este comando somente para conferência manual:
                                </p>
                                <div className="relative group">
                                  <pre className="bg-secondary/50 p-4 rounded-lg text-xs font-mono text-foreground whitespace-pre-wrap border border-border">
                                    {`grep '^${acc.username} ' /etc/ppp/chap-secrets
systemctl status xl2tpd --no-pager`}
                                  </pre>
                                  <Button 
                                    size="sm" 
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => copyToClipboard(`grep '^${acc.username} ' /etc/ppp/chap-secrets\nsystemctl status xl2tpd --no-pager`)}
                                  >
                                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                  </Button>
                                </div>
                              </div>

                              {/* Comando MikroTik (Cliente) */}
                              <div className="pt-4 border-t border-border">
                                <h4 className="font-semibold text-sm text-info mb-2">2. Script para a Filial (MikroTik Cliente)</h4>
                                <p className="text-xs text-muted-foreground mb-3">
                                  Após criar o usuário na VPS, cole este script no <strong>New Terminal</strong> do MikroTik da filial:
                                </p>
                                <div className="relative group">
                                  <pre className="bg-secondary/50 p-4 rounded-lg text-xs font-mono text-foreground whitespace-pre-wrap border border-border">
                                    {getClientScript(acc)}
                                  </pre>
                                  <Button 
                                    size="sm" 
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => copyToClipboard(getClientScript(acc))}
                                  >
                                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                  </Button>
                                </div>
                              </div>

                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold">Nova Conta VPN L2TP</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowModal(false)} className="h-8 w-8">X</Button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <Label>Nome do Cliente / Filial</Label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ex: Filial Centro" className="mt-1" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Usuário PPP</Label>
                  <Input required value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="mt-1" />
                </div>
                <div>
                  <Label>Senha PPP</Label>
                  <Input required type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="mt-1" />
                </div>
              </div>

              <div>
                <Label>IP Privado (Remoto)</Label>
                <Input required value={formData.remote_ip} onChange={e => setFormData({...formData, remote_ip: e.target.value})} placeholder="Ex: 10.255.255.2" className="mt-1" />
                <p className="text-[10px] text-muted-foreground mt-1">Este IP será usado para acessar o MikroTik do cliente pelo sistema.</p>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Salvando...' : 'Criar Conta VPN'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
