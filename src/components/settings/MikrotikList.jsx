import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Pencil, Trash2, Server, Eye, EyeOff, CheckCircle, RefreshCw, X, Terminal, Activity } from 'lucide-react';
import { toast } from 'sonner';
import MikrotikScriptModal from './MikrotikScriptModal';
import MikrotikStatusModal from './MikrotikStatusModal';
import MikrotikRealtimeDashboard from './MikrotikRealtimeDashboard';

const EMPTY = {
  name: '',
  host: '',
  port: '22',
  user: 'admin',
  password: '',
  snmp_community: 'public',
  snmp_port: '161',
  physical_interface: 'ether1',
  bridge_name: 'bridge-hotspot',
  vlan_id: '',
  vlan_interface: 'vlan-hotspot',
  hotspot_network: '192.168.1.0/24',
};

export default function MikrotikList() {
  const { getToken } = useAuth();
  const [mikrotiks, setMikrotiks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // null = new
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [scriptMt, setScriptMt] = useState(null);
  const [statusMt, setStatusMt] = useState(null);
  const [radiusSettings, setRadiusSettings] = useState({});

  const load = async () => {
    setLoading(true);
    // Each mikrotik is stored as a group of Settings with category="mikrotik" and key prefix "mt_{id}_field"
    // Simpler approach: store each router as a single Setting JSON blob with category="mikrotik_device"
    const all = await base44.entities.Setting.filter({ category: 'mikrotik_device' }).catch(() => []);
    const parsed = all.map(s => {
      try { return { _id: s.id, ...JSON.parse(s.value) }; } catch { return null; }
    }).filter(Boolean);
    setMikrotiks(parsed);
    const radius = await base44.entities.Setting.filter({ category: 'radius' }).catch(() => []);
    const radiusMap = {};
    radius.forEach(s => { radiusMap[s.key] = s.value; });
    setRadiusSettings(radiusMap);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setShowPass(false);
    setShowForm(true);
  };

  const openEdit = (mt) => {
    setEditing(mt);
    setForm({
      name: mt.name || '',
      host: mt.host || '',
      port: mt.port || '22',
      user: mt.user || 'admin',
      password: mt.password || '',
      snmp_community: mt.snmp_community || 'public',
      snmp_port: mt.snmp_port || '161',
      physical_interface: mt.physical_interface || mt.hotspot_interface || 'ether1',
      bridge_name: mt.bridge_name || 'bridge-hotspot',
      vlan_id: mt.vlan_id || '',
      vlan_interface: mt.vlan_interface || 'vlan-hotspot',
      hotspot_network: mt.hotspot_network || '192.168.1.0/24',
    });
    setShowPass(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.host || !form.snmp_community) {
      toast.error('Nome, IP e comunidade SNMP são obrigatórios');
      return;
    }

    setSaving(true);
    const deviceData = { ...form, hotspot_interface: form.bridge_name };
    const blob = JSON.stringify(deviceData);
    let savedDevice;

    if (editing) {
      await base44.entities.Setting.update(editing._id, { key: `mikrotik_device_${editing._id}`, value: blob, category: 'mikrotik_device', label: form.name });
      savedDevice = { ...editing, ...deviceData };
    } else {
      const created = await base44.entities.Setting.create({ key: `mikrotik_device_${Date.now()}`, value: blob, category: 'mikrotik_device', label: form.name });
      savedDevice = { _id: created.id, ...deviceData };
    }

    toast.success(editing ? 'MikroTik atualizado!' : 'MikroTik cadastrado!');
    setSaving(false);
    setShowForm(false);
    setScriptMt(savedDevice);
    load();
  };

  const handleDelete = async (mt) => {
    await base44.entities.Setting.delete(mt._id);
    toast.info(`${mt.name} removido`);
    load();
  };

  const fields = [
    { key: 'name', label: 'Nome / Identificação', placeholder: 'Ex: Praça Central AP01' },
    { key: 'host', label: 'IP do MikroTik', placeholder: '192.168.88.1' },
    { key: 'port', label: 'Porta de acesso', placeholder: '22' },
    { key: 'user', label: 'Usuário SSH', placeholder: 'admin' },
    { key: 'snmp_community', label: 'Comunidade SNMP', placeholder: 'public' },
    { key: 'snmp_port', label: 'Porta SNMP', placeholder: '161' },
    { key: 'physical_interface', label: 'Interface física (ether)', placeholder: 'ether1' },
    { key: 'bridge_name', label: 'Bridge Hotspot', placeholder: 'bridge-hotspot' },
    { key: 'vlan_id', label: 'VLAN ID (opcional)', placeholder: '100' },
    { key: 'vlan_interface', label: 'Nome da VLAN', placeholder: 'vlan-hotspot' },
    { key: 'hotspot_network', label: 'Rede Hotspot', placeholder: '192.168.1.0/24' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">Cadastre SNMP, bridge, ether e VLAN para coletar métricas sem gerar logs SSH no MikroTik</p>
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Cadastrar MikroTik
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-14 bg-secondary rounded-lg animate-pulse" />)}
        </div>
      ) : mikrotiks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-xl text-muted-foreground gap-3">
          <Server className="w-10 h-10 opacity-20" />
          <p className="text-sm">Nenhum MikroTik cadastrado</p>
          <Button size="sm" variant="outline" onClick={openNew} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />Cadastrar primeiro
          </Button>
        </div>
      ) : (
        <>
          <MikrotikRealtimeDashboard devices={mikrotiks} token={getToken()} />
          <div className="rounded-xl border border-border overflow-hidden">
          {mikrotiks.map((mt, i) => (
            <div
              key={mt._id}
              className={`flex items-center gap-4 px-4 py-3 ${i % 2 === 0 ? 'bg-card' : 'bg-secondary/40'} border-b border-border last:border-0`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${mt.host ? 'bg-primary/10' : 'bg-muted'}`}>
                <Server className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{mt.name}</p>
                <p className="text-xs font-mono text-muted-foreground">{mt.host}:{mt.port} · {mt.user} · {mt.bridge_name || mt.hotspot_interface} · {mt.vlan_id ? `VLAN ${mt.vlan_id}` : (mt.physical_interface || 'ether')}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setStatusMt(mt)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-success/10 hover:bg-success/20 text-success transition-colors text-xs font-medium"
                  title="Verificar status via SNMP"
                >
                  <Activity className="w-3.5 h-3.5" />
                  Status
                </button>
                <button
                  onClick={() => setScriptMt(mt)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors text-xs font-medium"
                  title="Gerar script para Terminal"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Script
                </button>
                <button onClick={() => openEdit(mt)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Editar">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(mt)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Remover">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {/* Status and Script Modals */}
      {statusMt && <MikrotikStatusModal mikrotik={statusMt} token={getToken()} onClose={() => setStatusMt(null)} />}
      {scriptMt && <MikrotikScriptModal mikrotik={scriptMt} radius={radiusSettings} onClose={() => setScriptMt(null)} />}

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-foreground text-sm">{editing ? 'Editar MikroTik' : 'Cadastrar MikroTik e gerar script'}</h3>
              </div>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {fields.map(f => (
                <div key={f.key} className={['name', 'hotspot_network'].includes(f.key) ? 'col-span-2' : ''}>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">{f.label}</Label>
                  <Input
                    value={form[f.key]}
                    onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="bg-input border-border h-9 text-sm font-mono"
                  />
                </div>
              ))}
              {/* Password */}
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Senha SSH (opcional, não usada na coleta SNMP)</Label>
                <div className="relative">
                  <Input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="bg-input border-border h-9 text-sm font-mono pr-9"
                  />
                  <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)} className="border-border">Cancelar</Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground gap-2">
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                {editing ? 'Atualizar e gerar script' : 'Cadastrar e gerar script' }
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}