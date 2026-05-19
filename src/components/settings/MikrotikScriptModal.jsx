import { useMemo } from 'react';
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

    return `# Kore-HotSpot - Script de integração MikroTik
# Cole este script no Terminal do MikroTik
# Inclui configuração SNMP para coleta leve, evitando logs de SSH no MikroTik

:local radiusAddress "${radiusHost}"
:local radiusSecret "${radiusSecret}"
:local radiusName "${radiusName}"
:local physicalInterface "${physicalInterface}"
:local bridgeName "${bridgeName}"
:local vlanId "${vlanId}"
:local vlanInterface "${vlanInterface}"
:local hotspotNetwork "${network}"
:local snmpCommunity "${snmpCommunity}"
:local sshPort "${sshPort}"
:local profileName "${profileName}"
:local hotspotName "${hotspotName}"
:local hotspotInterface $physicalInterface

# Valida entradas e interface fisica
:local sshPortNum [:tonum $sshPort]
:local vlanIdNum 0
:if ([:len $vlanId] > 0) do={ :set vlanIdNum [:tonum $vlanId] }
:if ([:len [/interface find where name=$physicalInterface]] = 0) do={
  :error ("ERRO: interface fisica nao encontrada: " . $physicalInterface)
}
:if (([:len $vlanId] > 0) and (($vlanIdNum < 1) or ($vlanIdNum > 4094))) do={
  :error ("ERRO: VLAN ID invalida: " . $vlanId)
}

# Ativa SNMP v2c somente leitura para o Kore-HotSpot
/snmp set enabled=yes contact="Kore-HotSpot" location="Hotspot" trap-version=2
:if ([:len [/snmp community find where name=$snmpCommunity]] = 0) do={
  /snmp community add name=$snmpCommunity addresses=0.0.0.0/0 read-access=yes write-access=no disabled=no
} else={
  /snmp community set [find where name=$snmpCommunity] addresses=0.0.0.0/0 read-access=yes write-access=no disabled=no
}

# Libera gerenciamento no firewall INPUT antes de qualquer DROP/REJECT
/ip service set ssh disabled=no port=$sshPortNum
:foreach ruleComment in={"Kore-HotSpot allow established";"Kore-HotSpot allow SNMP UDP 161";"Kore-HotSpot allow SSH"} do={
  /ip firewall filter remove [find where comment=$ruleComment]
}
/ip firewall filter add chain=input connection-state=established,related action=accept comment="Kore-HotSpot allow established" disabled=no place-before=0
/ip firewall filter add chain=input protocol=udp dst-port=161 action=accept comment="Kore-HotSpot allow SNMP UDP 161" disabled=no place-before=0
/ip firewall filter add chain=input protocol=tcp dst-port=$sshPortNum action=accept comment="Kore-HotSpot allow SSH" disabled=no place-before=0

# Cria bridge, vincula ether e cria VLAN corretamente
:if ([:len $bridgeName] > 0) do={
  :if ([:len [/interface bridge find where name=$bridgeName]] = 0) do={
    /interface bridge add name=$bridgeName protocol-mode=rstp comment="Kore-HotSpot bridge"
  }

  # remove a ether de outra bridge antes de vincular na bridge correta
  /interface bridge port remove [find where interface=$physicalInterface]
  /interface bridge port add bridge=$bridgeName interface=$physicalInterface comment="Kore-HotSpot porta fisica"
  :set hotspotInterface $bridgeName
}

:if ([:len $vlanId] > 0) do={
  :local vlanBaseInterface $hotspotInterface
  :if ([:len [/interface vlan find where name=$vlanInterface]] = 0) do={
    /interface vlan add name=$vlanInterface interface=$vlanBaseInterface vlan-id=$vlanIdNum comment="Kore-HotSpot VLAN"
  } else={
    /interface vlan set [find where name=$vlanInterface] interface=$vlanBaseInterface vlan-id=$vlanIdNum disabled=no
  }
  :set hotspotInterface $vlanInterface
}

# Remove apenas RADIUS antigo do Kore-HotSpot e recria
/radius remove [find where comment=$radiusName]
/radius add service=hotspot address=$radiusAddress secret=$radiusSecret authentication-port=1812 accounting-port=1813 timeout=3s disabled=no comment=$radiusName

# Cria ou atualiza o perfil do Hotspot usando RADIUS
:if ([:len [/ip hotspot profile find where name=$profileName]] = 0) do={
  /ip hotspot profile add name=$profileName use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
} else={
  /ip hotspot profile set [find where name=$profileName] use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
}

# Cria ou atualiza o servidor Hotspot na interface final
:if ([:len [/ip hotspot find where name=$hotspotName]] = 0) do={
  /ip hotspot add name=$hotspotName interface=$hotspotInterface profile=$profileName disabled=no
} else={
  /ip hotspot set [find where name=$hotspotName] interface=$hotspotInterface profile=$profileName disabled=no
}

# Diagnostico final: confira se estes itens aparecem no terminal
:put "=== KORE-HOTSPOT OK ==="
:put ("Interface final do hotspot: " . $hotspotInterface)
/interface bridge print detail where comment~"Kore-HotSpot"
/interface bridge port print detail where comment~"Kore-HotSpot"
/interface vlan print detail where comment~"Kore-HotSpot"
/ip firewall filter print detail where comment~"Kore-HotSpot"
/snmp print
/snmp community print detail where name=$snmpCommunity
/radius print detail where comment=$radiusName
/ip hotspot print detail where name=$hotspotName`;
  }, [mikrotik, radius]);

  const copyScript = async () => {
    await navigator.clipboard.writeText(script);
    toast.success('Script copiado para a área de transferência');
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
Execute este script atualizado no Terminal do MikroTik: ele valida a ether, cria/vincula bridge, cria VLAN, libera SNMP/SSH no firewall e imprime o diagnóstico final no terminal.
          </div>

          <pre className="bg-background border border-border rounded-xl p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {script}
          </pre>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="border-border">Fechar</Button>
            <Button size="sm" onClick={copyScript} className="gap-2">
              <Copy className="w-3.5 h-3.5" /> Copiar Script
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}