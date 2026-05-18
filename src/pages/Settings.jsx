import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Settings as SettingsIcon, Server, Shield, Database, Globe, Clock, Save, RefreshCw, Eye, EyeOff, CheckCircle, Wifi } from 'lucide-react';
import { toast } from 'sonner';

const defaultSettings = {
  // MikroTik
  mikrotik_host: '192.168.88.1',
  mikrotik_port: '8728',
  mikrotik_user: 'admin',
  mikrotik_password: '',
  mikrotik_hotspot_interface: 'ether1',
  mikrotik_hotspot_network: '192.168.1.0/24',
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
};

const sections = [
  {
    id: 'mikrotik', label: 'MikroTik', icon: Server, color: 'text-primary',
    fields: [
      { key: 'mikrotik_host', label: 'Host / IP' },
      { key: 'mikrotik_port', label: 'Porta API' },
      { key: 'mikrotik_user', label: 'Usuário' },
      { key: 'mikrotik_password', label: 'Senha', secret: true },
      { key: 'mikrotik_hotspot_interface', label: 'Interface Hotspot' },
      { key: 'mikrotik_hotspot_network', label: 'Rede Hotspot' },
    ]
  },
  {
    id: 'radius', label: 'FreeRADIUS', icon: Shield, color: 'text-info',
    fields: [
      { key: 'radius_host', label: 'Host RADIUS' },
      { key: 'radius_port', label: 'Porta' },
      { key: 'radius_secret', label: 'Shared Secret', secret: true },
      { key: 'radius_db_host', label: 'DB Host' },
      { key: 'radius_db_name', label: 'DB Nome' },
      { key: 'radius_db_user', label: 'DB Usuário' },
      { key: 'radius_db_password', label: 'DB Senha', secret: true },
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
  const [showSecrets, setShowSecrets] = useState({});
  const [activeSection, setActiveSection] = useState('mikrotik');

  useEffect(() => {
    base44.entities.Setting.list().then(saved => {
      const map = {};
      saved.forEach(s => { map[s.key] = s.value; });
      setSettings(prev => ({ ...prev, ...map }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const existing = await base44.entities.Setting.list();
    const existingMap = {};
    existing.forEach(s => { existingMap[s.key] = s.id; });

    const section = sections.find(s => s.id === activeSection);
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
    toast.success(`Configurações de ${section.label} salvas!`);
    setSaving(false);
  };

  const handleTest = async (section) => {
    await base44.entities.AuditLog.create({ action: `test_${section}`, entity_type: section, entity_name: 'test', status: 'info', message: `Teste de conexão ${section.toUpperCase()} iniciado` });
    toast.info(`Teste de conexão ${section.toUpperCase()} iniciado...`);
    setTimeout(() => toast.success(`Conexão ${section.toUpperCase()} simulada com sucesso!`), 1500);
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

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg bg-secondary flex items-center justify-center`}>
                <activeS.icon className={`w-5 h-5 ${activeS.color}`} />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">{activeS.label}</h2>
                <p className="text-xs text-muted-foreground">Configurações de integração</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2 border-border text-xs" onClick={() => handleTest(activeSection)}>
                <CheckCircle className="w-3.5 h-3.5" />Testar
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground gap-2 text-xs">
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </Button>
            </div>
          </div>

          {loading ? (
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}