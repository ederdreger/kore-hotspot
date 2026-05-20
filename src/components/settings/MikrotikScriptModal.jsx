import { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
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

export default function MikrotikScriptModal({ mikrotik, radius, onClose }) {
  const script = useMemo(() => {
    // IMPORTANTE: radius é um flat map { key: value } vindo do banco (Settings).
    // NÃO usar mikrotik.host como fallback para radiusHost — ele é o IP local do próprio roteador!
    const radiusHost = radius?.radius_host || radius?.vpn_server_host || 'COLOQUE_IP_DA_VPS_OU_RADIUS_AQUI';
    const radiusSecret = radius.radius_secret || mikrotik.radius_secret || generateRadiusSecret(mikrotik);
    const physicalInterface = mikrotik.physical_interface || 'ether1';
    const bridgeName = mikrotik.bridge_name || '';
    const vlanId = mikrotik.vlan_id || '';
    const vlanInterface = mikrotik.vlan_interface || 'vlan-hotspot';
    const snmpCommunity = mikrotik.snmp_community || 'public';
    const sshPort = mikrotik.port || '22';
    const radiusName = 'Kore-HotSpot';
    const profileName = 'kore-hotspot-profile';
    const hotspotName = 'kore-hotspot';

    const finalHotspotInterface = vlanId ? vlanInterface : (bridgeName || physicalInterface);
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
    const vpnServerIp = radius?.vpn_server_host || mikrotik?.vpn_server || 'COLOQUE_IP_PUBLICO_DA_VPS_AQUI';
    const ipsecSec = radius?.vpn_ipsec_secret || mikrotik?.vpn_secret || 'SUA_SENHA_IPSEC';
    const vpnUser = mikrotik?.vpn_user || 'COLOQUE_USUARIO_VPN_AQUI';
    const vpnPass = mikrotik?.vpn_password || 'COLOQUE_SENHA_VPN_AQUI';

    // A rota deve apontar para o IP do RADIUS (na VPS), não para uma URL
    // Garante que o dst-address seja sempre um IP válido
    const radiusIpForRoute = (() => {
      const candidate = radius?.radius_host || radius?.vpn_server_host || '';
      // Valida se parece com um IP (não URL/hostname)
      return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidate) ? candidate : 'COLOQUE_IP_DO_RADIUS_AQUI';
    })();

    const vpnSection = mikrotik.vpn_enabled ? `
# --- VPN L2TP/IPsec CLIENT ---
# Cria interface de tunel VPN apontando para a VPS (Matriz)
:do { /interface l2tp-client remove [find name="l2tp-vpn"] } on-error={}
:do { /ip route remove [find comment="Rota Radius via VPN"] } on-error={}

/interface l2tp-client add connect-to="${vpnServerIp}" name="l2tp-vpn" user="${vpnUser}" password="${vpnPass}" profile="default" use-ipsec=yes ipsec-secret="${ipsecSec}" disabled=no
/ip route add dst-address=${radiusIpForRoute}/32 gateway="l2tp-vpn" comment="Rota Radius via VPN"
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
:do { /interface l2tp-client remove [find where name="l2tp-vpn"] } on-error={}
:do { /ppp profile remove [find where name="kore-vpn-profile"] } on-error={}

# Valida porta fisica
:if ([:len [/interface find where name="${physicalInterface}"]] = 0) do={ :error "ERRO: interface fisica ${physicalInterface} nao encontrada" }

# SSH e SNMP para coleta de Performance (Dashboard)
# Habilita SNMP para monitoramento em tempo real (CPU, Memoria e Uso de Interface)
/ip service set ssh disabled=no port=${sshPort}
/snmp set enabled=yes contact="Kore-HotSpot" location="Hotspot" trap-version=2
/snmp community remove [find where name="${snmpCommunity}"]
/snmp community add name="${snmpCommunity}" addresses=0.0.0.0/0 read-access=yes write-access=no disabled=no

# Firewall INPUT para SSH/SNMP
/ip firewall filter add chain=input connection-state=established,related action=accept comment="Kore-HotSpot allow established" disabled=no
/ip firewall filter add chain=input protocol=udp dst-port=161 action=accept comment="Kore-HotSpot allow SNMP UDP 161" disabled=no
/ip firewall filter add chain=input protocol=tcp dst-port=${sshPort} action=accept comment="Kore-HotSpot allow SSH" disabled=no
/ip firewall filter move [find where comment="Kore-HotSpot allow SSH"] destination=0
/ip firewall filter move [find where comment="Kore-HotSpot allow SNMP UDP 161"] destination=0
/ip firewall filter move [find where comment="Kore-HotSpot allow established"] destination=0
${bridgeSection}${vlanSection}
${vpnSection}
# RADIUS Hotspot
/radius add service=hotspot address=${radiusHost} secret="${radiusSecret}" authentication-port=1812 accounting-port=1813 timeout=3s disabled=no comment="${radiusName}"

# Perfil e servidor Hotspot na interface final ${finalHotspotInterface}
/ip hotspot profile add name="${profileName}" use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
/ip hotspot add name="${hotspotName}" interface="${finalHotspotInterface}" profile="${profileName}" disabled=no

# Diagnostico final
:put "=== KORE-HOTSPOT FINALIZADO ==="
:put "Interface final do hotspot: ${finalHotspotInterface}"
/interface bridge print detail where name="${bridgeName}"
/interface bridge port print detail where interface="${physicalInterface}"
/interface vlan print detail where name="${vlanInterface}"
/ip firewall filter print detail where comment~"Kore-HotSpot allow"
/snmp print
/snmp community print detail where name="${snmpCommunity}"
/radius print detail where comment="${radiusName}"
/ip hotspot print detail where name="${hotspotName}"`;
  }, [mikrotik, radius]);

  const [copied, setCopied] = useState(false);
  const copyScript = async () => {
    await navigator.clipboard.writeText(script);
    toast.success('Script copiado para a área de transferência');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const autoProvision = async () => {
    const promise = base44.functions.invoke('mikrotikProvision', {
      host: mikrotik.host,
      port: mikrotik.port,
      user: mikrotik.user,
      password: mikrotik.password, // from local state if available, or saved
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

        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-88px)]">
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
Você pode aplicar toda a configuração automaticamente (o sistema gerou as senhas de integração do RADIUS) clicando em "Aplicar Automático" ou copiar e colar no Terminal do MikroTik.
          </div>

          <pre className="bg-background border border-border rounded-xl p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {script}
          </pre>

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