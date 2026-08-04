import { useEffect, useState } from 'react';
import { X, MapPin, Wifi, Save, Send, Loader2, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const BANDS = ['2.4GHz', '5GHz', 'Dual-Band'];
const CHANNELS_24 = [1, 6, 11];
const CHANNELS_5 = [36, 40, 44, 48, 149, 153, 157, 161];

const DEFAULT = {
  name: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  reference: '',
  ip: '',
  band: '2.4GHz',
  channel: 6,
  maxClients: 30,
  txPower: 20,
  ssid: 'KoreHotspot',
  notes: '',
};

function statusMessage(status) {
  if (status === 'adopted') return 'AP adotado e gerenciado pela controladora.';
  if (status === 'ready-to-adopt') return 'O AP enviou o Inform e esta pronto para confirmação na controladora.';
  if (status === 'no-inform') return 'Tempo limite encerrado: o AP não iniciou conexão com a controladora.';
  if (status === 'failed') return 'A preparação remota falhou em uma das verificações.';
  return 'Adoção remota ativa por DHCP e DNS. Aguardando o AP enviar o Inform.';
}

export default function APRegisterModal({ ap, onSave, onCheckAdoption, onClose }) {
  const [form, setForm] = useState(ap ? { ...DEFAULT, ...ap } : DEFAULT);
  const [errors, setErrors] = useState({});
  const [adoptionResult, setAdoptionResult] = useState(
    ap?.adoption_status && ap.adoption_status !== 'pending'
      ? { access_point: ap, adoption_status: ap.adoption_status, checks: ap.adoption_checks, controller_url: ap.controller_url, message: ap.adoption_error || statusMessage(ap.adoption_status) }
      : null
  );
  const [submitting, setSubmitting] = useState('');
  const [submitError, setSubmitError] = useState('');
  const managed = !!form.managed;
  const canAdopt = !!ap && ap.source === 'unifi-local' && !managed;

  useEffect(() => {
    if (!adoptionResult || !onCheckAdoption || ['adopted', 'no-inform', 'failed'].includes(adoptionResult.adoption_status)) return undefined;
    const check = async () => {
      try {
        const result = await onCheckAdoption(ap.id || ap._id);
        if (result) setAdoptionResult(current => ({ ...current, ...result, checks: result.checks || current?.checks, controller_url: result.controller_url || current?.controller_url }));
      } catch {
        // A preparacao ja foi concluida; uma falha temporaria de consulta nao a desfaz.
      }
    };
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [adoptionResult, onCheckAdoption, ap]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const adoptionStatus = adoptionResult?.adoption_status || adoptionResult?.access_point?.adoption_status || '';

  const channels = form.band === '5GHz' ? CHANNELS_5 : form.band === 'Dual-Band' ? [...CHANNELS_24, ...CHANNELS_5] : CHANNELS_24;

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Nome obrigatório';
    if (!form.street.trim()) e.street = 'Rua/Praça obrigatória';
    if (!form.ip.trim()) e.ip = 'IP obrigatório';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async (applyAdoption = false) => {
    if (!validate()) return;
    const address = `${form.street}${form.number ? ', ' + form.number : ''} — ${form.neighborhood}${form.city ? ', ' + form.city : ''}`;
    setSubmitting(applyAdoption ? 'adopt' : 'save');
    setSubmitError('');
    try {
      const result = await onSave(
        { ...form, address, channel: Number(form.channel), maxClients: Number(form.maxClients), txPower: Number(form.txPower) },
        applyAdoption ? { mode: 'vlan' } : null
      );
      if (applyAdoption && result) setAdoptionResult(result);
    } catch (error) {
      setSubmitError(error.message || 'Não foi possível concluir a operação.');
      if (applyAdoption && onCheckAdoption && ap) {
        const result = await onCheckAdoption(ap.id || ap._id).catch(() => null);
        if (result) setAdoptionResult(result);
      }
    } finally {
      setSubmitting('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">{ap ? 'Editar AP' : 'Cadastrar Access Point'}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto scrollbar-thin flex-1 px-5 py-4 space-y-5">
          {/* Identification */}
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">Identificação</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Nome do AP *</Label>
                <Input
                  placeholder="ex: AP-PraçaCentral-01"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  className={`h-8 text-xs ${errors.name ? 'border-destructive' : ''}`}
                />
                {errors.name && <p className="text-[10px] text-destructive mt-1">{errors.name}</p>}
              </div>
              <div>
                <Label className="text-xs mb-1 block">IP de Gerenciamento *</Label>
                <Input
                  placeholder="10.0.1.X"
                  value={form.ip}
                  onChange={e => set('ip', e.target.value)}
                  disabled={managed}
                  className={`h-8 text-xs font-mono ${errors.ip ? 'border-destructive' : ''}`}
                />
                {errors.ip && <p className="text-[10px] text-destructive mt-1">{errors.ip}</p>}
              </div>
              <div>
                <Label className="text-xs mb-1 block">SSID</Label>
                <Input
                  placeholder="KoreHotspot"
                  value={form.ssid}
                  onChange={e => set('ssid', e.target.value)}
                  disabled={managed}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> Endereço de Instalação
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Rua / Praça / Avenida *</Label>
                <Input
                  placeholder="ex: Rua das Flores, Praça da Paz"
                  value={form.street}
                  onChange={e => set('street', e.target.value)}
                  className={`h-8 text-xs ${errors.street ? 'border-destructive' : ''}`}
                />
                {errors.street && <p className="text-[10px] text-destructive mt-1">{errors.street}</p>}
              </div>
              <div>
                <Label className="text-xs mb-1 block">Número / KM</Label>
                <Input
                  placeholder="s/n"
                  value={form.number}
                  onChange={e => set('number', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Bairro</Label>
                <Input
                  placeholder="ex: Centro, Vila Nova"
                  value={form.neighborhood}
                  onChange={e => set('neighborhood', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Cidade</Label>
                <Input
                  placeholder="ex: Maringá"
                  value={form.city}
                  onChange={e => set('city', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs mb-1 block">Ponto de Referência</Label>
                <Input
                  placeholder="ex: Poste em frente ao Banco do Brasil, Quiosque central da praça"
                  value={form.reference}
                  onChange={e => set('reference', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* RF Config */}
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">Configuração de Rádio</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Banda</Label>
                <select
                  value={form.band}
                  onChange={e => { set('band', e.target.value); set('channel', e.target.value === '5GHz' ? 36 : 6); }}
                  disabled={managed}
                  className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {BANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Canal</Label>
                <select
                  value={form.channel}
                  onChange={e => set('channel', e.target.value)}
                  disabled={managed}
                  className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {channels.map(c => <option key={c} value={c}>CH {c}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">TX Power (dBm)</Label>
                <Input
                  type="number" min={10} max={30}
                  value={form.txPower}
                  onChange={e => set('txPower', e.target.value)}
                  disabled={managed}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Máx. Clientes</Label>
                <Input
                  type="number" min={5} max={200}
                  value={form.maxClients}
                  onChange={e => set('maxClients', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs mb-1 block">Observações</Label>
            <textarea
              rows={2}
              placeholder="Informações adicionais sobre a instalação..."
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {canAdopt && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                <Wifi className="w-3 h-3" /> Adoção UniFi pela VLAN {form.management_vlan_id || ''}
              </p>
              {!adoptionResult ? (
                <p className="text-[11px] text-muted-foreground">
                  O Kore executará a adoção remota sem reiniciar o equipamento: bypass do Hotspot, Option 43 forçada, DNS unifi exclusivo para o AP, renovação DHCP e monitoramento da porta Inform. Não é necessária senha SSH.
                </p>
              ) : (
                <div className="space-y-2 text-[11px]">
                  <div className="grid grid-cols-2 gap-1.5 text-muted-foreground">
                    {[
                      ['hotspot_bypass', 'Bypass do Hotspot'],
                      ['dhcp_option_43', 'Option 43 completa'],
                      ['dns_unifi', 'DNS unifi direcionado'],
                      ['controller', 'Controladora ativa'],
                      ['inform_reachable', 'Inform porta 8080'],
                      ['discovery_udp', 'Discovery UDP 10001']
                    ].map(([key, label]) => {
                      const done = adoptionResult.checks?.[key] || adoptionResult.access_point?.adoption_checks?.[key];
                      return <span key={key} className="flex items-center gap-1.5">{done ? <CheckCircle2 className="w-3 h-3 text-success" /> : <RefreshCw className="w-3 h-3 text-muted-foreground" />}{label}</span>;
                    })}
                  </div>
                  <p className="flex items-start gap-1.5 text-foreground">
                    {adoptionStatus === 'adopted'
                      ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-success" />
                      : ['no-inform', 'failed'].includes(adoptionStatus)
                        ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive" />
                        : <RefreshCw className="w-3.5 h-3.5 mt-0.5 text-primary animate-spin" />}
                    {adoptionResult.message}
                  </p>
                  {adoptionStatus === 'ready-to-adopt' && adoptionResult.controller_url && (
                    <a href={adoptionResult.controller_url} target="_blank" rel="noreferrer" className="inline-flex text-primary hover:underline">Abrir controladora UniFi para confirmar</a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {submitError && (
          <div className="mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {submitError}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={!!submitting}>Cancelar</Button>
          <Button variant={canAdopt ? 'outline' : 'default'} size="sm" onClick={() => handleSave(false)} disabled={!!submitting} className="gap-1.5">
            {submitting === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {ap ? 'Salvar Alterações' : 'Cadastrar AP'}
          </Button>
          {canAdopt && (
            <Button size="sm" onClick={() => handleSave(true)} disabled={!!submitting || ['adopted', 'ready-to-adopt'].includes(adoptionStatus)} className="gap-1.5">
              {submitting === 'adopt' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {['adopted', 'ready-to-adopt'].includes(adoptionStatus) ? 'Adoção em acompanhamento' : adoptionResult ? 'Reexecutar adoção remota' : 'Executar adoção remota'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
