import { useState, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Shield, FileCode2, CheckCircle, RefreshCw, Server } from 'lucide-react';
import { toast } from 'sonner';

export default function RadiusAutoConfig() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [config, setConfig] = useState(null);
  const [mikrotiks, setMikrotiks] = useState([]);
  const [selectedMikrotikId, setSelectedMikrotikId] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    const settings = await spedynet.entities.Setting.filter({ category: 'radius' }).catch(() => []);
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    
    if (Object.keys(map).length > 0 && map.radius_secret) {
      setConfig(map);
    } else {
      setConfig(null);
    }

    // Load MikroTiks
    const mtiks = await spedynet.entities.Setting.filter({ category: 'mikrotik_device' }).catch(() => []);
    const parsedMtiks = mtiks.map(s => {
      try { return { id: s.id, ...JSON.parse(s.value) }; } catch { return null; }
    }).filter(Boolean);
    setMikrotiks(parsedMtiks);
    if (parsedMtiks.length > 0) setSelectedMikrotikId(parsedMtiks[0].id);

    setLoading(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    
    // Auto generate everything
    const host = window.location.hostname === 'localhost' ? '192.168.1.100' : window.location.hostname;
    const secret = `Kore-${Math.random().toString(36).substr(2, 10).toUpperCase()}`;
    const dbPass = Math.random().toString(36).substr(2, 16);
    
    const newConfig = {
      radius_host: host,
      radius_port: '1812',
      radius_secret: secret,
      radius_db_host: '127.0.0.1',
      radius_db_name: 'radius',
      radius_db_user: 'radius',
      radius_db_password: dbPass
    };

    // Apaga configurações antigas de radius primeiro
    const oldSettings = await spedynet.entities.Setting.filter({ category: 'radius' }).catch(() => []);
    for (const s of oldSettings) {
      await spedynet.entities.Setting.delete(s.id).catch(() => {});
    }

    const promises = Object.entries(newConfig).map(([key, value]) => {
      return spedynet.entities.Setting.create({
        key, 
        value, 
        category: 'radius', 
        label: key, 
        is_secret: key.includes('secret') || key.includes('password') 
      });
    });

    await Promise.all(promises);
    toast.success('Servidor FreeRADIUS configurado e credenciais geradas!');
    setConfig(newConfig);
    setGenerating(false);
  };

  const copyScript = async () => {
    const selectedMt = mikrotiks.find(m => m.id === selectedMikrotikId);
    if (mikrotiks.length > 0 && !selectedMt) {
      toast.error('Selecione um MikroTik primeiro.');
      return;
    }

    const secretToUse = selectedMt ? (selectedMt.radius_secret || config.radius_secret) : config.radius_secret;

    const script = `# Kore-HotSpot - Integração Simples MikroTik${selectedMt ? ` (${selectedMt.name})` : ''}
# Basta colar no New Terminal.

/radius add service=hotspot address=${config.radius_host} secret="${secretToUse}" authentication-port=${config.radius_port} accounting-port=1813 timeout=3s comment="Kore-HotSpot"

/ip hotspot profile set [find default=yes] use-radius=yes radius-accounting=yes login-by=http-chap,http-pap,cookie html-directory=hotspot

:put "=== INTEGRACAO KORE-HOTSPOT CONCLUIDA ==="
`;
    await navigator.clipboard.writeText(script);
    toast.success('Script copiado para a área de transferência');
  };

  if (loading) {
    return <div className="h-48 bg-secondary rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl bg-info/10 border border-info/20">
        <h3 className="text-sm font-semibold text-info mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4" /> Automação do FreeRADIUS
        </h3>
        <p className="text-xs text-info/90 leading-relaxed mb-4">
          Esqueça as configurações manuais complexas de banco de dados. O sistema gerencia o FreeRADIUS automaticamente, gerando senhas seguras exclusivas e fornecendo um script de integração super simples para seus clientes leigos aplicarem no MikroTik.
        </p>
        
        {!config ? (
          <Button onClick={handleGenerate} disabled={generating} className="bg-info hover:bg-info/90 text-white gap-2">
            {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
            Gerar Servidor e Credenciais Automáticas
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-success text-xs font-medium bg-success/10 px-3 py-2 rounded-lg inline-flex border border-success/20">
            <CheckCircle className="w-4 h-4" /> Servidor RADIUS automático ativo
          </div>
        )}
      </div>

      {config && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border p-4 rounded-xl">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Credenciais de Integração</h4>
            <div className="space-y-3">
              <div>
                <span className="text-[10px] text-muted-foreground block mb-1">Host (IP Público do RADIUS)</span>
                <code className="text-sm text-foreground bg-secondary px-2 py-1 rounded block">{config.radius_host}</code>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground block mb-1">Secret (Senha de Integração Segura)</span>
                <code className="text-sm text-primary bg-secondary px-2 py-1 rounded block font-bold">{config.radius_secret}</code>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-4 rounded-xl flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Script Rápido para Leigos</h4>
              <p className="text-xs text-muted-foreground mb-4">
                Entregue este script ao cliente. Basta ele colar no <strong>New Terminal</strong> do MikroTik e a integração estará pronta.
              </p>

              {mikrotiks.length > 0 ? (
                <div className="mb-4">
                  <label className="text-[10px] text-muted-foreground block mb-1">Selecione o Equipamento</label>
                  <select 
                    value={selectedMikrotikId} 
                    onChange={e => setSelectedMikrotikId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {mikrotiks.map(mt => (
                      <option key={mt.id} value={mt.id} className="bg-background">{mt.name} ({mt.host})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="mb-4 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning">
                  Nenhum MikroTik cadastrado. Vá na aba "MikroTik" para adicionar equipamentos.
                </div>
              )}
            </div>

            <Button onClick={copyScript} variant="outline" disabled={mikrotiks.length > 0 && !selectedMikrotikId} className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/10">
              <FileCode2 className="w-4 h-4" /> Copiar Script
            </Button>
            
            <p className="text-[10px] text-muted-foreground mt-3 text-center">
              Cada equipamento possui sua própria senha de segurança (Secret) gerada automaticamente.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
