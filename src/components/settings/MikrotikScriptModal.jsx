import { useEffect, useMemo, useState } from 'react';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Copy, FileCode2, X, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

function generateRadiusSecret(mikrotik) {
  const source = `${mikrotik?.name || 'kore'}-${mikrotik?.host || 'hotspot'}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  return `Kore-${Math.abs(hash).toString(36).toUpperCase()}-HotSpot`;
}

function getHotspotNetworkConfig(network = '192.168.1.0/24') {
  const fallback = {
    network: '192.168.1.0/24',
    address: '192.168.1.1/24',
    gateway: '192.168.1.1',
    poolRange: '192.168.1.10-192.168.1.254'
  };
  const match = String(network || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/(24)$/);
  if (!match) return fallback;

  const [, a, b, c, prefix] = match;
  return {
    network: `${a}.${b}.${c}.0/${prefix}`,
    address: `${a}.${b}.${c}.1/${prefix}`,
    gateway: `${a}.${b}.${c}.1`,
    poolRange: `${a}.${b}.${c}.10-${a}.${b}.${c}.254`
  };
}

function getRemoteVpnIp(mikrotik) {
  const remoteIp = mikrotik?.vpn_remote_ip || mikrotik?.remote_ip || mikrotik?.host;
  return /^10\.255\.255\.\d+$/.test(String(remoteIp || '')) ? remoteIp : '';
}

export default function MikrotikScriptModal({ mikrotik, radius, onClose }) {
  const [vpnSyncStatus, setVpnSyncStatus] = useState('idle');
  const [vpnSyncMessage, setVpnSyncMessage] = useState('');
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    spedynet.entities.Plan.filter({ status: 'active' }).then(setPlans).catch(() => setPlans([]));
  }, []);

  const script = useMemo(() => {
    // Sanitiza URLs do sandbox para evitar que caiam no script
    let cleanRadiusHost = radius?.radius_host || '';
    if (cleanRadiusHost.includes('.spedynet.app')) cleanRadiusHost = '';
    
    let cleanVpnServer = radius?.vpn_server_host || mikrotik?.vpn_server || '';
    if (cleanVpnServer.includes('.spedynet.app')) cleanVpnServer = '';

    // IMPORTANTE: radius é um flat map { key: value } vindo do banco (Settings).
    // NÃO usar mikrotik.host como fallback para radiusHost — ele é o IP local do próprio roteador!
    
    // Se a VPN for usada, a autenticação RADIUS passa por dentro do túnel no IP local da Matriz (10.255.255.1)
    // Isso evita o erro fatal de "Routing Loop", onde o túnel tenta enviar o tráfego por fora e a internet trava.
    const radiusHost = mikrotik.vpn_enabled ? '10.255.255.1' : (cleanRadiusHost || cleanVpnServer || 'COLOQUE_IP_DA_VPS_OU_RADIUS_AQUI');
    const radiusSecret = radius.radius_secret || mikrotik.radius_secret || generateRadiusSecret(mikrotik);
    const physicalInterface = mikrotik.physical_interface || 'ether1';
    const bridgeName = mikrotik.bridge_name || '';
    const vlanId = mikrotik.vlan_id || '';
    const vlanInterface = mikrotik.vlan_interface || 'vlan-hotspot';
    const snmpCommunity = mikrotik.snmp_community || 'public';
    const sshPort = mikrotik.port || '22';
    const sshUser = mikrotik.user || 'kore-api';
    const sshFallbackPassword = mikrotik.password || 'KoreKeyFallback@123';
    const publicServerHost = cleanVpnServer || window.location.hostname;
    const sshPublicKeyUrl = `http://${publicServerHost}:8081/public/kore-api.pub`;
    const hotspotLoginUrl = `http://${publicServerHost}:8081/public/hotspot-login.html`;
    const captivePortalHost = publicServerHost;
    const captivePortalUrl = `${window.location.origin}/captive-portal`;
    const managementSource = mikrotik.vpn_enabled ? '10.255.255.1' : publicServerHost;
    const radiusName = 'Kore-HotSpot';
    const profileName = 'kore-hotspot-profile';
    const hotspotName = 'kore-hotspot';
    const poolName = 'kore-hotspot-pool';
    const dhcpName = 'kore-hotspot-dhcp';
    const hotspotNet = getHotspotNetworkConfig(mikrotik.hotspot_network);
    const profileScript = plans.map((plan) => {
      const name = plan.mikrotik_profile_name || `kore-${String(plan.name || 'plano').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const download = Number(plan.download_mbps || plan.speed_download || 0);
      const upload = Number(plan.upload_mbps || plan.speed_upload || 0);
      const rate = download || upload ? `${Math.max(upload, 1)}M/${Math.max(download, 1)}M` : '';
      if (!rate) return '';
      return `:do { /ip hotspot user profile remove [find where name="${name}"] } on-error={}\n/ip hotspot user profile add name="${name}" rate-limit="${rate}" shared-users=1 comment="Kore-HotSpot plano ${plan.name}"`;
    }).filter(Boolean).join('\n');

    const finalHotspotInterface = vlanId ? vlanInterface : (bridgeName || physicalInterface);
    const directInterfaceSection = !vlanId && !bridgeName ? `
# Garante que ${physicalInterface} esteja livre para entregar DHCP diretamente
:do { /interface bridge port remove [find where interface="${physicalInterface}"] } on-error={}
:do { /interface enable [find where name="${physicalInterface}"] } on-error={}` : '';
    const vlanSection = vlanId ? `
# Cria/atualiza VLAN ${vlanId} sobre ${bridgeName || physicalInterface}
:do { /interface vlan remove [find where name="${vlanInterface}"] } on-error={}
/interface vlan add name="${vlanInterface}" interface="${bridgeName || physicalInterface}" vlan-id=${vlanId} comment="Kore-HotSpot VLAN" disabled=no` : '';
    const bridgeSection = bridgeName ? `
# Cria/atualiza bridge e vincula a porta fisica ${physicalInterface}
:if ([:len [/interface bridge find where name="${bridgeName}"]] = 0) do={
  /interface bridge add name="${bridgeName}" protocol-mode=rstp comment="Kore-HotSpot bridge" disabled=no
}
:if ([:len [/interface bridge port find where interface="${physicalInterface}" and bridge="${bridgeName}"]] = 0) do={
  /interface bridge port remove [find where interface="${physicalInterface}"]
  /interface bridge port add bridge="${bridgeName}" interface="${physicalInterface}" comment="Kore-HotSpot porta fisica" disabled=no
}` : '';

    // IP do servidor VPN (VPS/Matriz) — NUNCA deve ser o IP local do MikroTik
    const vpnServerIp = cleanVpnServer || 'COLOQUE_IP_PUBLICO_DA_VPS_AQUI';
    const ipsecSec = radius?.vpn_ipsec_secret || mikrotik?.vpn_secret || 'SUA_SENHA_IPSEC';
    const vpnUser = mikrotik?.vpn_user || 'COLOQUE_USUARIO_VPN_AQUI';
    const vpnPass = mikrotik?.vpn_password || 'COLOQUE_SENHA_VPN_AQUI';

    // A rota deve apontar para o IP do RADIUS (na VPS), não para uma URL
    // Garante que o dst-address seja sempre um IP válido
    const vpnSection = mikrotik.vpn_enabled ? `
# --- VPN L2TP/IPsec CLIENT ---
# Remove configuracoes antigas do tunel e rotas manuais
:do { /interface l2tp-client remove [find name="l2tp-vpn"] } on-error={}
:do { /ppp profile remove [find name="kore-vpn-profile"] } on-error={}
:do { /ip route remove [find comment="Rota Radius via VPN"] } on-error={}

# Cria perfil PPP especifico forçando MSCHAPv2 que é o padrão do Linux (xl2tpd)
/ppp profile add name="kore-vpn-profile" use-encryption=yes use-mpls=default only-one=default

# Cria interface de tunel VPN apontando para a VPS (Matriz) com os protocolos corretos
/interface l2tp-client add connect-to="${vpnServerIp}" name="l2tp-vpn" user="${vpnUser}" password="${vpnPass}" profile="kore-vpn-profile" use-ipsec=yes ipsec-secret="${ipsecSec}" allow=mschap2 disabled=no

# Permite que o MikroTik alcance o RADIUS na VPN
/ip route add dst-address=10.255.255.1/32 gateway="l2tp-vpn" comment="Rota Radius via VPN"
# -----------------------------
` : '';

    return `# Kore-HotSpot - Script corrigido de integração MikroTik
# Cole TODO o script no Terminal do MikroTik. Não cole linha por linha.

# Limpeza de itens quebrados criados por scripts anteriores
:do { /interface vlan remove [find where comment="Kore-HotSpot VLAN"] } on-error={}
:do { /ip firewall filter remove [find where comment~"Kore-HotSpot allow"] } on-error={}
:do { /radius remove [find where comment="${radiusName}"] } on-error={}
:do { /ip hotspot remove [find where name="${hotspotName}"] } on-error={}
:do { /ip hotspot profile remove [find where name="${profileName}"] } on-error={}
:do { /ip hotspot walled-garden remove [find where comment~"Kore-HotSpot"] } on-error={}
:do { /ip hotspot walled-garden ip remove [find where comment~"Kore-HotSpot"] } on-error={}
:do { /ip dhcp-server remove [find where name="${dhcpName}"] } on-error={}
:do { /ip dhcp-server network remove [find where comment="Kore-HotSpot DHCP network"] } on-error={}
:do { /ip pool remove [find where name="${poolName}"] } on-error={}
:do { /ip address remove [find where comment="Kore-HotSpot gateway"] } on-error={}
:do { /interface l2tp-client remove [find where name="l2tp-vpn"] } on-error={}
:do { /ppp profile remove [find where name="kore-vpn-profile"] } on-error={}

# Valida porta fisica
:if ([:len [/interface find where name="${physicalInterface}"]] = 0) do={ :error "ERRO: interface fisica ${physicalInterface} nao encontrada" }

# SSH e SNMP para coleta de Performance (Dashboard)
# Habilita SNMP para monitoramento em tempo real (CPU, Memoria e Uso de Interface)
/ip service set ssh disabled=no port=${sshPort} address=${managementSource}/32
:if ([:len [/user find where name="${sshUser}"]] = 0) do={
  /user add name="${sshUser}" group=full password="${sshFallbackPassword}"
} else={
  /user set [find where name="${sshUser}"] group=full password="${sshFallbackPassword}" disabled=no
}
:do { /file remove [find where name="kore-api.pub"] } on-error={}
/tool fetch url="${sshPublicKeyUrl}" mode=http dst-path="kore-api.pub" keep-result=yes
:delay 2s
:if ([:len [/file find where name="kore-api.pub"]] = 0) do={ :error "ERRO: chave publica kore-api.pub nao foi baixada da VPS" }
:do { /user ssh-keys remove [find where user="${sshUser}"] } on-error={}
:do { /user ssh-keys import public-key-file="kore-api.pub" user="${sshUser}" } on-error={ :error "ERRO: falha ao importar chave publica SSH. Verifique RouterOS 6 RSA e URL da VPS." }
:if ([:len [/user ssh-keys find where user="${sshUser}"]] = 0) do={ :error "ERRO: chave SSH nao ficou vinculada ao usuario ${sshUser}" }
/snmp set enabled=yes contact="Kore-HotSpot" location="Hotspot" trap-version=2
/snmp community remove [find where name="${snmpCommunity}"]
/snmp community add name="${snmpCommunity}" addresses=${managementSource}/32 read-access=yes write-access=no disabled=no
/ip dns set allow-remote-requests=yes

# Firewall INPUT para SSH/SNMP
/ip firewall filter add chain=input connection-state=established,related action=accept comment="Kore-HotSpot allow established" disabled=no
/ip firewall filter add chain=input protocol=udp dst-port=161 action=accept comment="Kore-HotSpot allow SNMP UDP 161" disabled=no
/ip firewall filter add chain=input src-address=${managementSource} protocol=tcp dst-port=${sshPort} action=accept comment="Kore-HotSpot allow SSH" disabled=no
/ip firewall filter add chain=input in-interface="${finalHotspotInterface}" protocol=udp dst-port=67,68 action=accept comment="Kore-HotSpot allow DHCP" disabled=no
/ip firewall filter add chain=input in-interface="${finalHotspotInterface}" protocol=udp dst-port=53 action=accept comment="Kore-HotSpot allow DNS UDP" disabled=no
/ip firewall filter add chain=input in-interface="${finalHotspotInterface}" protocol=tcp dst-port=53 action=accept comment="Kore-HotSpot allow DNS TCP" disabled=no
/ip firewall filter move [find where comment="Kore-HotSpot allow SSH"] destination=0
/ip firewall filter move [find where comment="Kore-HotSpot allow SNMP UDP 161"] destination=0
/ip firewall filter move [find where comment="Kore-HotSpot allow DHCP"] destination=0
/ip firewall filter move [find where comment="Kore-HotSpot allow DNS UDP"] destination=0
/ip firewall filter move [find where comment="Kore-HotSpot allow DNS TCP"] destination=0
/ip firewall filter move [find where comment="Kore-HotSpot allow established"] destination=0
${directInterfaceSection}${bridgeSection}${vlanSection}
${vpnSection}
# RADIUS Hotspot
/radius add service=hotspot address=${radiusHost} secret="${radiusSecret}" authentication-port=1812 accounting-port=1813 timeout=3s disabled=no comment="${radiusName}"

# Pool, gateway e DHCP do Hotspot
/ip pool add name="${poolName}" ranges=${hotspotNet.poolRange} comment="Kore-HotSpot address pool"
/ip address add address=${hotspotNet.address} interface="${finalHotspotInterface}" comment="Kore-HotSpot gateway" disabled=no
/ip dhcp-server network add address=${hotspotNet.network} gateway=${hotspotNet.gateway} dns-server=${hotspotNet.gateway} comment="Kore-HotSpot DHCP network"
/ip dhcp-server add name="${dhcpName}" interface="${finalHotspotInterface}" address-pool="${poolName}" lease-time=1h authoritative=yes disabled=no

# Perfil e servidor Hotspot na interface final ${finalHotspotInterface}
/ip hotspot profile add name="${profileName}" hotspot-address=${hotspotNet.gateway} use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
/ip hotspot add name="${hotspotName}" interface="${finalHotspotInterface}" address-pool="${poolName}" profile="${profileName}" disabled=no

# Perfis de velocidade gerados a partir dos planos cadastrados no sistema
${profileScript || ':put "Nenhum perfil de velocidade cadastrado no sistema"'}

# Captive Portal Kore-HotSpot
# Libera o painel/portal antes da autenticacao e substitui a tela padrao do MikroTik
/ip hotspot walled-garden ip add dst-address=${captivePortalHost} protocol=tcp dst-port=80 action=accept comment="Kore-HotSpot captive portal HTTP"
/ip hotspot walled-garden ip add dst-address=${captivePortalHost} protocol=tcp dst-port=443 action=accept comment="Kore-HotSpot captive portal HTTPS"
/ip hotspot walled-garden ip add dst-address=${captivePortalHost} protocol=tcp dst-port=8080 action=accept comment="Kore-HotSpot captive portal 8080"
/ip hotspot walled-garden ip add dst-address=${captivePortalHost} protocol=tcp dst-port=8081 action=accept comment="Kore-HotSpot captive portal API"
:if ([:len [/file find where name="flash/hotspot"]] > 0) do={
  :foreach f in={"login.html";"rlogin.html";"redirect.html";"alogin.html"} do={
    :do { /file remove [find where name=("flash/hotspot/" . $f)] } on-error={}
    /tool fetch url="${hotspotLoginUrl}" mode=http dst-path=("flash/hotspot/" . $f) keep-result=yes
    :delay 1s
  }
  :if ([:len [/file find where name="flash/hotspot/login.html"]] = 0) do={ :error "ERRO: flash/hotspot/login.html nao foi baixado da VPS" }
  /ip hotspot profile set [find where name="${profileName}"] html-directory=flash/hotspot
  :put "Diretorio Hotspot: flash/hotspot"
} else={
  :foreach f in={"login.html";"rlogin.html";"redirect.html";"alogin.html"} do={
    :do { /file remove [find where name=("hotspot/" . $f)] } on-error={}
    /tool fetch url="${hotspotLoginUrl}" mode=http dst-path=("hotspot/" . $f) keep-result=yes
    :delay 1s
  }
  :if ([:len [/file find where name="hotspot/login.html"]] = 0) do={ :error "ERRO: hotspot/login.html nao foi baixado da VPS" }
  /ip hotspot profile set [find where name="${profileName}"] html-directory=hotspot
  :put "Diretorio Hotspot: hotspot"
}
:put "Portal externo: ${captivePortalUrl}"
:do { /ip hotspot host remove [find where server="${hotspotName}"] } on-error={}
:do { /ip hotspot active remove [find where server="${hotspotName}"] } on-error={}

# Diagnostico final
:put "=== KORE-HOTSPOT FINALIZADO ==="
:put "Interface final do hotspot: ${finalHotspotInterface}"
:put "Rede Hotspot: ${hotspotNet.network}"
:put "Gateway Hotspot: ${hotspotNet.gateway}"
:put "Pool Hotspot: ${hotspotNet.poolRange}"
/interface bridge print detail where name="${bridgeName}"
/interface bridge port print detail where interface="${physicalInterface}"
/interface vlan print detail where name="${vlanInterface}"
/ip pool print detail where name="${poolName}"
/ip address print detail where comment="Kore-HotSpot gateway"
/ip dhcp-server print detail where name="${dhcpName}"
/ip dhcp-server network print detail where comment="Kore-HotSpot DHCP network"
/ip firewall filter print detail where comment~"Kore-HotSpot allow"
/snmp print
/snmp community print detail where name="${snmpCommunity}"
/radius print detail where comment="${radiusName}"
/ip hotspot print detail where name="${hotspotName}"
/ip hotspot user profile print detail where comment~"Kore-HotSpot plano"`;
  }, [mikrotik, radius, plans]);

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!mikrotik?.vpn_enabled) return;
    if (!mikrotik?.vpn_user || !mikrotik?.vpn_password) {
      setVpnSyncStatus('error');
      setVpnSyncMessage('Usuário ou senha VPN não preenchidos no cadastro do equipamento.');
      return;
    }

    const remoteIp = getRemoteVpnIp(mikrotik);
    if (!/^10\.255\.255\.\d+$/.test(String(remoteIp || ''))) {
      setVpnSyncStatus('error');
      setVpnSyncMessage('IP VPN remoto inválido. Use o IP 10.255.255.x no campo host do equipamento.');
      return;
    }

    let active = true;
    setVpnSyncStatus('loading');
    setVpnSyncMessage('Cadastrando usuário VPN na VPS...');

    spedynet.functions.invoke('vpnCreateUser', {
      username: mikrotik.vpn_user,
      password: mikrotik.vpn_password,
      remote_ip: remoteIp
    }).then(() => {
      if (!active) return;
      setVpnSyncStatus('success');
      setVpnSyncMessage(`Conta ${mikrotik.vpn_user} autorizada automaticamente na VPS para o IP ${remoteIp}.`);
    }).catch((error) => {
      if (!active) return;
      setVpnSyncStatus('error');
      setVpnSyncMessage(error.message || 'Não foi possível cadastrar a conta VPN na VPS automaticamente.');
    });

    return () => { active = false; };
  }, [mikrotik?.vpn_enabled, mikrotik?.vpn_user, mikrotik?.vpn_password, mikrotik?.vpn_remote_ip, mikrotik?.remote_ip, mikrotik?.host]);

  const copyScript = async () => {
    await navigator.clipboard.writeText(script);
    toast.success('Script copiado para a área de transferência');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const autoProvision = async () => {
    const promise = spedynet.functions.invoke('mikrotikSyncPlans', {
      host: mikrotik.host,
      port: mikrotik.port,
      user: mikrotik.user,
      password: mikrotik.password, // from local state if available, or saved
      auth_method: mikrotik.ssh_auth_method || 'key',
      physical_interface: mikrotik.physical_interface,
      bridge_name: mikrotik.bridge_name,
      vlan_id: mikrotik.vlan_id,
      vlan_interface: mikrotik.vlan_interface,
      hotspot_network: mikrotik.hotspot_network,
      snmp_community: mikrotik.snmp_community,
      wan_interface: mikrotik.wan_interface,
      vpn_enabled: mikrotik.vpn_enabled,
      vpn_server: mikrotik.vpn_server,
      vpn_secret: mikrotik.vpn_secret,
      vpn_user: mikrotik.vpn_user,
      vpn_password: mikrotik.vpn_password,
      radius_host: radius.radius_host || mikrotik.host,
      radius_secret: radius.radius_secret || mikrotik.radius_secret || generateRadiusSecret(mikrotik),
    });

    toast.promise(promise, {
      loading: 'Enviando configuração para o MikroTik via SSH...',
      success: (res) => {
        if (res.data?.success) return res.data.message || 'Configurado com sucesso!';
        throw new Error(res.data?.error || 'Erro desconhecido');
      },
      error: (err) => err.message || 'Falha ao provisionar',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileCode2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Script MikroTik</h3>
              <p className="text-xs text-muted-foreground">Copie e cole no Terminal do MikroTik {mikrotik.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-88px)]">
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
Você pode aplicar toda a configuração automaticamente (o sistema gerou as senhas de integração do RADIUS) clicando em "Aplicar Automático" ou copiar e colar no Terminal do MikroTik.
          </div>

          {mikrotik.vpn_enabled && (
            <div className={`rounded-xl border px-4 py-3 text-xs ${
              vpnSyncStatus === 'success'
                ? 'border-success/30 bg-success/10 text-success'
                : vpnSyncStatus === 'error'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-info/30 bg-info/10 text-info'
            }`}>
              <div className="flex items-center gap-2 font-semibold mb-1">
                {vpnSyncStatus === 'success' && <CheckCircle className="w-4 h-4" />}
                <span>Conta VPN na VPS</span>
              </div>
              <p>{vpnSyncMessage || 'A conta VPN será criada automaticamente na VPS ao abrir este script.'}</p>
            </div>
          )}

          <div className={mikrotik.vpn_enabled ? "pt-4 border-t border-border" : ""}>
            {mikrotik.vpn_enabled && <h4 className="font-semibold text-sm text-info mb-2">Script para a Filial (MikroTik Cliente)</h4>}
            <pre className="bg-background border border-border rounded-xl p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {script}
            </pre>
          </div>

          <div className="flex justify-between items-center mt-4">
            <Button size="sm" onClick={autoProvision} className="gap-2 bg-info hover:bg-info/90 text-white">
              Aplicar Automático (SSH)
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose} className="border-border">Fechar</Button>
              <Button size="sm" onClick={copyScript} className="gap-2">
                {copied ? <CheckCircle className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />} 
                {copied ? 'Copiado!' : 'Copiar Script'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
