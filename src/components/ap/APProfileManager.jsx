import { useEffect, useState } from 'react';
import { Eye, Loader2, Pencil, Play, Plus, RotateCcw, Settings2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY = {
  name: '',
  ssid: '',
  security_mode: 'open',
  passphrase: '',
  country: 'Brazil',
  bridge: '',
  vlan_id: '',
  controller_id: '',
  reprovision_now: false,
  status: 'active'
};

function readController(setting) {
  try {
    const data = JSON.parse(setting.value || '{}');
    return { id: setting.id || setting._id, name: data.name || data.host, host: data.host };
  } catch {
    return null;
  }
}

export default function APProfileManager() {
  const [profiles, setProfiles] = useState([]);
  const [controllers, setControllers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const [profileResponse, settings] = await Promise.all([
        spedynet.functions.invoke('accessPointProfiles', { action: 'list' }),
        spedynet.entities.Setting.list()
      ]);
      setProfiles(profileResponse.data?.profiles || []);
      setControllers(settings.filter(item => item.category === 'mikrotik_device').map(readController).filter(Boolean));
    } catch (error) {
      toast.error(error.message || 'Erro ao carregar perfis de Wi-Fi');
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, controller_id: controllers[0]?.id || '' });
    setShowForm(true);
  };

  const openEdit = (profile) => {
    setEditing(profile);
    setForm({ ...EMPTY, ...profile, passphrase: '', vlan_id: profile.vlan_id || '' });
    setShowForm(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy('save');
    try {
      await spedynet.functions.invoke('accessPointProfiles', { action: 'save', id: editing?.id, ...form, vlan_id: Number(form.vlan_id || 0) });
      toast.success('Perfil Wi-Fi salvo.');
      setShowForm(false);
      await load();
    } catch (error) {
      toast.error(error.message || 'Erro ao salvar perfil');
    } finally {
      setBusy('');
    }
  };

  const showPreview = async (profile) => {
    setBusy(`preview-${profile.id}`);
    try {
      const response = await spedynet.functions.invoke('accessPointProfiles', { action: 'preview', id: profile.id });
      setPreview(response.data);
    } catch (error) {
      toast.error(error.message || 'Erro ao gerar prévia');
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    if (!preview?.profile?.id || !window.confirm(`Aplicar o perfil ${preview.profile.name} na controladora CAPsMAN?`)) return;
    setBusy('apply');
    try {
      const response = await spedynet.functions.invoke('accessPointProfiles', { action: 'apply', id: preview.profile.id });
      toast.success(`Perfil aplicado. Backup: ${response.data?.backup}`);
      setPreview(null);
      await load();
    } catch (error) {
      toast.error(error.message || 'Erro ao aplicar perfil');
    } finally {
      setBusy('');
    }
  };

  const rollback = async (profile) => {
    if (!window.confirm(`Remover o perfil ${profile.name} do CAPsMAN?`)) return;
    setBusy(`rollback-${profile.id}`);
    try {
      await spedynet.functions.invoke('accessPointProfiles', { action: 'rollback', id: profile.id });
      toast.success('Objetos do perfil removidos do CAPsMAN.');
      await load();
    } catch (error) {
      toast.error(error.message || 'Erro ao remover configuração');
    } finally {
      setBusy('');
    }
  };

  const remove = async (profile) => {
    if (!window.confirm(`Excluir o perfil ${profile.name} do sistema?`)) return;
    setBusy(`delete-${profile.id}`);
    try {
      await spedynet.functions.invoke('accessPointProfiles', { action: 'delete', id: profile.id });
      toast.success('Perfil excluído.');
      await load();
    } catch (error) {
      toast.error(error.message || 'Erro ao excluir perfil');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="border border-border bg-card rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Perfis de provisionamento</h2>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5"><Plus className="w-3.5 h-3.5" />Novo perfil</Button>
      </div>

      {profiles.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">Nenhum perfil Wi-Fi cadastrado.</div>
      ) : (
        <div className="divide-y divide-border">
          {profiles.map(profile => (
            <div key={profile.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 px-5 py-4 items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground truncate">{profile.name}</p>
                  <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{profile.security_mode === 'open' ? 'Aberto' : 'WPA2'}</span>
                </div>
                <p className="text-xs text-muted-foreground font-mono truncate">SSID {profile.ssid} · VLAN {profile.vlan_id || 'sem tag'} · {profile.bridge || 'sem bridge'}</p>
                {profile.last_applied_at && <p className="mt-1 text-[10px] text-success">Aplicado em {new Date(profile.last_applied_at).toLocaleString('pt-BR')} · {profile.last_applied_type}</p>}
              </div>
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => showPreview(profile)} disabled={!!busy} className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-info disabled:opacity-50" title="Visualizar e aplicar">{busy === `preview-${profile.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}</button>
                <button onClick={() => openEdit(profile)} disabled={!!busy} className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-primary disabled:opacity-50" title="Editar"><Pencil className="w-4 h-4" /></button>
                {profile.last_applied_at && <button onClick={() => rollback(profile)} disabled={!!busy} className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-warning disabled:opacity-50" title="Remover do CAPsMAN">{busy === `rollback-${profile.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}</button>}
                <button onClick={() => remove(profile)} disabled={!!busy} className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-destructive disabled:opacity-50" title="Excluir"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={save} onClick={event => event.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-sm font-semibold">{editing ? 'Editar perfil Wi-Fi' : 'Novo perfil Wi-Fi'}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
              <div><Label className="text-xs">Nome</Label><Input className="mt-1" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></div>
              <div><Label className="text-xs">SSID</Label><Input className="mt-1" value={form.ssid} onChange={event => setForm({ ...form, ssid: event.target.value })} maxLength={32} required /></div>
              <div><Label className="text-xs">Segurança</Label><select className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm" value={form.security_mode} onChange={event => setForm({ ...form, security_mode: event.target.value, passphrase: '' })}><option value="open">Rede aberta</option><option value="wpa2-psk">WPA2-PSK</option></select></div>
              {form.security_mode === 'wpa2-psk' && <div><Label className="text-xs">Senha Wi-Fi</Label><Input type="password" className="mt-1" value={form.passphrase} onChange={event => setForm({ ...form, passphrase: event.target.value })} placeholder={editing?.passphrase_configured ? 'Manter senha atual' : 'Mínimo 8 caracteres'} /></div>}
              <div><Label className="text-xs">Controladora</Label><select className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm" value={form.controller_id} onChange={event => setForm({ ...form, controller_id: event.target.value })}><option value="">Automática</option>{controllers.map(controller => <option key={controller.id} value={controller.id}>{controller.name} ({controller.host})</option>)}</select></div>
              <div><Label className="text-xs">País</Label><Input className="mt-1" value={form.country} onChange={event => setForm({ ...form, country: event.target.value })} /></div>
              <div><Label className="text-xs">Bridge</Label><Input className="mt-1 font-mono" value={form.bridge} onChange={event => setForm({ ...form, bridge: event.target.value })} placeholder="bridge-hotspot" /></div>
              <div><Label className="text-xs">VLAN ID</Label><Input type="number" min="1" max="4094" className="mt-1" value={form.vlan_id} onChange={event => setForm({ ...form, vlan_id: event.target.value })} placeholder="Sem tag" /></div>
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={form.reprovision_now} onChange={event => setForm({ ...form, reprovision_now: event.target.checked })} className="accent-primary" />Reprovisionar rádios conectados imediatamente</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button><Button type="submit" disabled={busy === 'save'}>{busy === 'save' && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Salvar</Button></div>
          </form>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div onClick={event => event.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="text-sm font-semibold">{preview.profile.name}</h3><p className="text-xs text-muted-foreground">{preview.capsman_type === 'wifi' ? 'WiFi CAPsMAN' : 'CAPsMAN legado'}</p></div><button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button></div>
            <div className="space-y-4 p-5">
              {preview.warnings?.map(warning => <div key={warning} className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{warning}</div>)}
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-4 text-xs text-muted-foreground">{preview.script}</pre>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="outline" onClick={() => setPreview(null)}>Fechar</Button><Button onClick={apply} disabled={busy === 'apply'} className="gap-2">{busy === 'apply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}Aplicar no CAPsMAN</Button></div>
          </div>
        </div>
      )}
    </section>
  );
}
