import { useState } from 'react';
import { X, MapPin, Wifi, Save } from 'lucide-react';
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

export default function APRegisterModal({ ap, onSave, onClose }) {
  const [form, setForm] = useState(ap ? { ...DEFAULT, ...ap } : DEFAULT);
  const [errors, setErrors] = useState({});
  const managed = !!form.managed;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const channels = form.band === '5GHz' ? CHANNELS_5 : form.band === 'Dual-Band' ? [...CHANNELS_24, ...CHANNELS_5] : CHANNELS_24;

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Nome obrigatório';
    if (!form.street.trim()) e.street = 'Rua/Praça obrigatória';
    if (!form.ip.trim()) e.ip = 'IP obrigatório';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const address = `${form.street}${form.number ? ', ' + form.number : ''} — ${form.neighborhood}${form.city ? ', ' + form.city : ''}`;
    onSave({ ...form, address, channel: Number(form.channel), maxClients: Number(form.maxClients), txPower: Number(form.txPower) });
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {ap ? 'Salvar Alterações' : 'Cadastrar AP'}
          </Button>
        </div>
      </div>
    </div>
  );
}
