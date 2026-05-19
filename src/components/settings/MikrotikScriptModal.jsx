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

# Ativa SNMP v2c somente leitura para o Kore-HotSpot
/snmp set enabled=yes contact="Kore-HotSpot" location="Hotspot"
:if ([:len [/snmp community find where name=$snmpCommunity]] = 0) do={
  /snmp community add name=$snmpCommunity read-access=yes write-access=no disabled=no
} else={
  /snmp community set [find where name=$snmpCommunity] read-access=yes write-access=no disabled=no
}

# Libera acesso de gerenciamento necessário para o Kore-HotSpot
# IMPORTANTE: coloque estas regras antes de regras DROP/REJECT da chain=input
/ip service set ssh disabled=no port=$sshPort

:if ([:len [/ip firewall filter find where comment="Kore-HotSpot allow established"]] = 0) do={
  /ip firewall filter add chain=input connection-state=established,related action=accept comment="Kore-HotSpot allow established" disabled=no
} else={
  /ip firewall filter set [find where comment="Kore-HotSpot allow established"] chain=input connection-state=established,related action=accept disabled=no
}

:if ([:len [/ip firewall filter find where comment="Kore-HotSpot allow SNMP UDP 161"]] = 0) do={
  /ip firewall filter add chain=input protocol=udp dst-port=161 action=accept comment="Kore-HotSpot allow SNMP UDP 161" disabled=no
} else={
  /ip firewall filter set [find where comment="Kore-HotSpot allow SNMP UDP 161"] chain=input protocol=udp dst-port=161 action=accept disabled=no
}

:if ([:len [/ip firewall filter find where comment="Kore-HotSpot allow SSH"]] = 0) do={
  /ip firewall filter add chain=input protocol=tcp dst-port=$sshPort action=accept comment="Kore-HotSpot allow SSH" disabled=no
} else={
  /ip firewall filter set [find where comment="Kore-HotSpot allow SSH"] chain=input protocol=tcp dst-port=$sshPort action=accept disabled=no
}

:local firstDrop [/ip firewall filter find where chain=input action=drop]
:if ([:len $firstDrop] > 0) do={
  /ip firewall filter move [find where comment="Kore-HotSpot allow established"] destination=[:pick $firstDrop 0]
  /ip firewall filter move [find where comment="Kore-HotSpot allow SNMP UDP 161"] destination=[:pick $firstDrop 0]
  /ip firewall filter move [find where comment="Kore-HotSpot allow SSH"] destination=[:pick $firstDrop 0]
}

# Valida interface fisica
:if ([:len [/interface find where name=$physicalInterface]] = 0) do={
  :error ("Interface fisica nao encontrada: " . $physicalInterface)
}

# Regra MikroTik: se bridge foi informada, cria a bridge e vincula a ether nela
:if ([:len $bridgeName] > 0) do={
  :if ([:len [/interface bridge find where name=$bridgeName]] = 0) do={
    /interface bridge add name=$bridgeName comment="Kore-HotSpot bridge"
  }

  :if ([:len [/interface bridge port find where bridge=$bridgeName interface=$physicalInterface]] = 0) do={
    /interface bridge port add bridge=$bridgeName interface=$physicalInterface comment="Kore-HotSpot uplink"
  }

  :set hotspotInterface $bridgeName
}

# Regra MikroTik: se somente VLAN e ether foram informadas, cria VLAN direto na ether, sem bridge
# Se bridge tambem foi informada, cria VLAN sobre a bridge
:if ([:len $vlanId] > 0) do={
  :local vlanBaseInterface $hotspotInterface
  :if ([:len [/interface vlan find where name=$vlanInterface]] = 0) do={
    /interface vlan add name=$vlanInterface interface=$vlanBaseInterface vlan-id=$vlanId comment="Kore-HotSpot VLAN"
  } else={
    /interface vlan set [find where name=$vlanInterface] interface=$vlanBaseInterface vlan-id=$vlanId
  }
  :set hotspotInterface $vlanInterface
}

# Remove apenas RADIUS antigo do Kore-HotSpot
/radius remove [find where comment=$radiusName]

# Adiciona servidor RADIUS do Hotspot com chave gerada automaticamente
/radius add service=hotspot address=$radiusAddress secret=$radiusSecret authentication-port=1812 accounting-port=1813 timeout=3s disabled=no comment=$radiusName

# Cria ou atualiza o perfil do Hotspot usando RADIUS
:if ([:len [/ip hotspot profile find where name=$profileName]] = 0) do={
  /ip hotspot profile add name=$profileName use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
} else={
  /ip hotspot profile set [find where name=$profileName] use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
}

# Cria ou atualiza o servidor Hotspot na bridge ou VLAN final
:if ([:len [/ip hotspot find where name=$hotspotName]] = 0) do={
  /ip hotspot add name=$hotspotName interface=[/interface get [find where name=$hotspotInterface] name] profile=$profileName disabled=no
} else={
  /ip hotspot set [find where name=$hotspotName] interface=[/interface get [find where name=$hotspotInterface] name] profile=$profileName disabled=no
}

# Exibe resultado
/interface bridge print
/interface bridge port print
/interface vlan print
/snmp print
/snmp community print
/radius print
/ip hotspot print
/ip hotspot profile print`;
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
O script agora libera automaticamente UDP 161 para SNMP e a porta SSH informada no firewall do MikroTik, posicionando as regras antes do primeiro DROP da chain input.
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