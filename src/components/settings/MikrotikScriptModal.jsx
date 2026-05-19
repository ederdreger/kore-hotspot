import { useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Copy, FileCode2, X } from 'lucide-react';
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
    const radiusHost = radius.radius_host || mikrotik.host || 'SEU_IP_RADIUS';
    const radiusSecret = radius.radius_secret || mikrotik.radius_secret || generateRadiusSecret(mikrotik);
    const physicalInterface = mikrotik.physical_interface || 'ether1';
    const bridgeName = mikrotik.bridge_name || '';
    const vlanId = mikrotik.vlan_id || '';
    const vlanInterface = mikrotik.vlan_interface || 'vlan-hotspot';
    const network = mikrotik.hotspot_network || '192.168.50.0/24';
    const snmpCommunity = mikrotik.snmp_community || 'public';
    const sshPort = mikrotik.port || '22';
    const radiusName = 'Kore-HotSpot';
    const profileName = 'kore-hotspot-profile';
    const hotspotName = 'kore-hotspot';

    const finalHotspotInterface = vlanId ? vlanInterface : (bridgeName || physicalInterface);
    const vlanSection = vlanId ? `
# Cria/atualiza VLAN ${vlanId} sobre ${bridgeName || physicalInterface}
/interface vlan remove [find where name="${vlanInterface}"]
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

    return `# Kore-HotSpot - Script corrigido de integração MikroTik
# Cole TODO o script no Terminal do MikroTik. Não cole linha por linha.

# Limpeza de itens quebrados criados por scripts anteriores
/interface vlan remove [find where comment="Kore-HotSpot VLAN"]
/ip firewall filter remove [find where comment~"Kore-HotSpot allow"]
/radius remove [find where comment="${radiusName}"]
/ip hotspot remove [find where name="${hotspotName}"]
/ip hotspot profile remove [find where name="${profileName}"]

# Valida porta fisica
:if ([:len [/interface find where name="${physicalInterface}"]] = 0) do={ :error "ERRO: interface fisica ${physicalInterface} nao encontrada" }

# SSH e SNMP para coleta
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

  const copyScript = async () => {
    await navigator.clipboard.writeText(script);
    toast.success('Script copiado para a área de transferência');
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
                <Copy className="w-3.5 h-3.5" /> Copiar Script
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}