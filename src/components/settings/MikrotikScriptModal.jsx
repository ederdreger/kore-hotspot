import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, FileCode2, X } from 'lucide-react';
import { toast } from 'sonner';

export default function MikrotikScriptModal({ mikrotik, radius, onClose }) {
  const script = useMemo(() => {
    const radiusHost = radius.radius_host || mikrotik.host || 'SEU_IP_RADIUS';
    const radiusSecret = radius.radius_secret || 'SUA_CHAVE_RADIUS';
    const interfaceName = mikrotik.hotspot_interface || 'bridge-hotspot';
    const network = mikrotik.hotspot_network || '192.168.50.0/24';
    const profileName = 'kore-hotspot-profile';
    const hotspotName = 'kore-hotspot';

    return `# Kore-HotSpot - Script de integração MikroTik
# Cole este script no Terminal do MikroTik

:local radiusAddress "${radiusHost}"
:local radiusSecret "${radiusSecret}"
:local hotspotInterface "${interfaceName}"
:local hotspotNetwork "${network}"
:local profileName "${profileName}"
:local hotspotName "${hotspotName}"

# Valida se a interface existe com nome exato
:if ([:len [/interface find where name=$hotspotInterface]] = 0) do={
  :error ("Interface nao encontrada: " . $hotspotInterface)
}

# Remove apenas RADIUS antigo criado para Hotspot
/radius remove [find where service~"hotspot"]

# Adiciona servidor RADIUS do Hotspot
/radius add service=hotspot address=$radiusAddress secret=$radiusSecret authentication-port=1812 accounting-port=1813 timeout=3s disabled=no

# Cria ou atualiza o perfil do Hotspot usando RADIUS
:if ([:len [/ip hotspot profile find where name=$profileName]] = 0) do={
  /ip hotspot profile add name=$profileName use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
} else={
  /ip hotspot profile set [find where name=$profileName] use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot
}

# Cria ou atualiza o servidor Hotspot na interface informada
:if ([:len [/ip hotspot find where name=$hotspotName]] = 0) do={
  /ip hotspot add name=$hotspotName interface=[/interface get [find where name=$hotspotInterface] name] profile=$profileName disabled=no
} else={
  /ip hotspot set [find where name=$hotspotName] interface=[/interface get [find where name=$hotspotInterface] name] profile=$profileName disabled=no
}

# Exibe resultado
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
Antes de copiar, confirme que o Host RADIUS e o Shared Secret estão preenchidos em Configurações &gt; FreeRADIUS. O botão Status usa SSH somente para leitura e valida se o equipamento responde.
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