import { useEffect, useState } from 'react';
import { Cloud, ExternalLink, HardDrive, Loader2, Pencil, Plus, RefreshCw, ScanSearch, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY = { name: 'UniFi Site Manager', api_key: '', status: 'active' };

export default function UniFiIntegrationPanel({ onSynced }) {
  const [integrations, setIntegrations] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState({});
  const [controller, setController] = useState(null);

  const load = async () => {
    try {
      const [response, controllerResponse] = await Promise.all([
        spedynet.functions.invoke('unifiIntegrations', { action: 'list' }),
        spedynet.functions.invoke('unifiController', { action: 'status' }).catch(() => null)
      ]);
      setIntegrations(response.data?.integrations || []);
      if (controllerResponse) setController(controllerResponse.data || null);
    } catch (error) {
      toast.error(error.message || 'Erro ao carregar integracoes UniFi');
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!controller?.installing) return undefined;
    const timer = setInterval(async () => {
      const response = await spedynet.functions.invoke('unifiController', { action: 'status' }).catch(() => null);
      if (response) setController(response.data || null);
    }, 5000);
    return () => clearInterval(timer);
  }, [controller?.installing]);

  const installController = async () => {
    if (!window.confirm('Instalar a controladora UniFi Network na VPS? A instalacao adicionara MongoDB, UniFi e abrira as portas 8443, 18080, 3478/UDP e 10001/UDP.')) return;
    setBusy('install-controller');
    try {
      const response = await spedynet.functions.invoke('unifiController', { action: 'install' });
      setController(response.data || null);
      toast.success('Instalacao da controladora iniciada em segundo plano.');
    } catch (error) {
      toast.error(error.message || 'Erro ao instalar controladora UniFi');
    } finally {
      setBusy('');
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setShowForm(true);
  };

  const openEdit = (integration) => {
    setEditing(integration);
    setForm({ name: integration.name, api_key: '', status: integration.status || 'active' });
    setShowForm(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy('save');
    try {
      await spedynet.functions.invoke('unifiIntegrations', { action: 'save', id: editing?.id, ...form });
      toast.success('Integracao UniFi salva.');
      setShowForm(false);
      await load();
    } catch (error) {
      toast.error(error.message || 'Erro ao salvar integracao UniFi');
    } finally {
      setBusy('');
    }
  };

  const test = async (integration) => {
    setBusy(`test-${integration.id}`);
    try {
      const response = await spedynet.functions.invoke('unifiIntegrations', { action: 'test', id: integration.id });
      const data = response.data || {};
      setResults(current => ({ ...current, [integration.id]: data.message || 'Teste concluido.' }));
      if (data.devices_count) toast.success(`UniFi conectado: ${data.sites_count || 0} site(s), ${data.access_points_count || 0} AP(s).`);
      else toast.warning(data.message || 'API conectada, mas nenhum equipamento adotado foi encontrado.');
    } catch (error) {
      toast.error(error.message || 'Falha ao conectar ao UniFi');
    } finally {
      setBusy('');
    }
  };

  const sync = async (integration) => {
    setBusy(`sync-${integration.id}`);
    try {
      const response = await spedynet.functions.invoke('unifiIntegrations', { action: 'sync', id: integration.id });
      onSynced?.(response.data?.access_points || []);
      setResults(current => ({ ...current, [integration.id]: response.data?.integration?.access_points_count ? 'Equipamentos adotados sincronizados com sucesso.' : 'Sincronizacao concluida, mas o Site Manager ainda nao retornou equipamentos adotados.' }));
      if (response.data?.integration?.access_points_count) toast.success(`${response.data.integration.access_points_count} AP(s) UniFi sincronizado(s).`);
      else toast.warning('Sincronizacao concluida sem equipamentos adotados.');
      await load();
    } catch (error) {
      toast.error(error.message || 'Falha ao sincronizar UniFi');
    } finally {
      setBusy('');
    }
  };

  const discoverNetwork = async (integration) => {
    setBusy(`discover-${integration.id}`);
    try {
      const response = await spedynet.functions.invoke('accessPointDiscover', {});
      const count = response.data?.unifi_neighbors || 0;
      onSynced?.(response.data?.access_points || []);
      setResults(current => ({ ...current, [integration.id]: count ? `${count} equipamento(s) UniFi encontrado(s) na rede local aguardando adocao.` : 'Nenhum equipamento UniFi foi localizado na tabela de vizinhos do MikroTik.' }));
      toast.success(`${count} UniFi localizado(s) na rede.`);
    } catch (error) {
      toast.error(error.message || 'Falha ao buscar UniFi na rede');
    } finally {
      setBusy('');
    }
  };

  const remove = async (integration) => {
    if (!window.confirm(`Excluir a integracao ${integration.name} e seus APs sincronizados?`)) return;
    setBusy(`delete-${integration.id}`);
    try {
      await spedynet.functions.invoke('unifiIntegrations', { action: 'delete', id: integration.id });
      toast.success('Integracao UniFi excluida.');
      await load();
      onSynced?.(null);
    } catch (error) {
      toast.error(error.message || 'Erro ao excluir integracao UniFi');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="border border-border bg-card rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-info" />
          <h2 className="text-sm font-semibold text-foreground">Ubiquiti UniFi</h2>
          <a href="https://unifi.ui.com/settings/api-keys" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-info" title="Abrir chaves da API UniFi"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
        <div className="flex items-center gap-2">
          {controller?.active && controller?.ui_ready ? (
            <a href={controller.ui_url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Controladora</Button></a>
          ) : (
            <Button size="sm" variant="outline" onClick={installController} disabled={controller?.installing || busy === 'install-controller'} className="gap-1.5">{controller?.installing || busy === 'install-controller' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5" />}{controller?.installing ? 'Instalando' : 'Instalar controladora'}</Button>
          )}
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5"><Plus className="w-3.5 h-3.5" />Integrar</Button>
        </div>
      </div>

      {controller && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-secondary/20 px-5 py-2.5 text-xs">
          <span className={controller.active ? 'text-success' : controller.installing ? 'text-warning' : 'text-muted-foreground'}>{controller.active ? `Controladora ativa ${controller.version || ''}` : controller.installing ? 'Instalacao em andamento' : 'Controladora nao instalada'}</span>
          {controller.active && <span className="font-mono text-muted-foreground">Inform: {controller.inform_url}</span>}
        </div>
      )}

      {integrations.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">Nenhuma conta UniFi integrada.</div>
      ) : (
        <div className="divide-y divide-border">
          {integrations.map(integration => (
            <div key={integration.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{integration.name}</p>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${integration.status === 'active' ? 'border-success/30 bg-success/10 text-success' : 'border-border text-muted-foreground'}`}>{integration.status === 'active' ? 'Ativa' : 'Inativa'}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{integration.sites_count || 0} site(s) | {integration.devices_count || 0} equipamento(s) | {integration.access_points_count || 0} AP(s)</p>
                {integration.last_sync_at && <p className="mt-1 text-[10px] text-muted-foreground">Sincronizado em {new Date(integration.last_sync_at).toLocaleString('pt-BR')}</p>}
                {results[integration.id] && <p className="mt-2 text-xs text-info">{results[integration.id]}</p>}
              </div>
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="outline" onClick={() => test(integration)} disabled={!!busy}>{busy === `test-${integration.id}` ? <Loader2 className="mr-1.5 w-3.5 h-3.5 animate-spin" /> : <Cloud className="mr-1.5 w-3.5 h-3.5" />}Testar</Button>
                <Button size="sm" variant="outline" onClick={() => discoverNetwork(integration)} disabled={!!busy}>{busy === `discover-${integration.id}` ? <Loader2 className="mr-1.5 w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="mr-1.5 w-3.5 h-3.5" />}Buscar rede</Button>
                <Button size="sm" onClick={() => sync(integration)} disabled={!!busy}>{busy === `sync-${integration.id}` ? <Loader2 className="mr-1.5 w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 w-3.5 h-3.5" />}Sincronizar</Button>
                <button onClick={() => openEdit(integration)} disabled={!!busy} className="p-2 text-muted-foreground hover:text-primary disabled:opacity-50" title="Editar"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(integration)} disabled={!!busy} className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50" title="Excluir"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={save} onClick={event => event.stopPropagation()} className="w-full max-w-md rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-sm font-semibold">{editing ? 'Editar integracao UniFi' : 'Integrar UniFi'}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <div><Label className="text-xs">Nome</Label><Input className="mt-1" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></div>
              <div><Label className="text-xs">Chave da API</Label><Input type="password" className="mt-1 font-mono" value={form.api_key} onChange={event => setForm({ ...form, api_key: event.target.value })} placeholder={editing?.api_key_configured ? 'Manter chave atual' : 'X-API-Key'} required={!editing?.api_key_configured} /></div>
              <div><Label className="text-xs">Status</Label><select className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm" value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="active">Ativa</option><option value="inactive">Inativa</option></select></div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button><Button type="submit" disabled={busy === 'save'}>{busy === 'save' && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Salvar</Button></div>
          </form>
        </div>
      )}
    </section>
  );
}
