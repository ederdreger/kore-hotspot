import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Plus, Trash2, RefreshCw, Shield, User, Mail, X, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', user: 'Usuário' };
const ROLE_COLORS = {
  admin: 'bg-red-500/10 text-red-400 border border-red-500/20',
  manager: 'bg-orange-500/10 text-orange-400 border border-orange-5000-500/20',
  user: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', role: 'user' });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await base44.entities.User.list().catch(() => []);
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) return;
    if (form.password !== form.confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }
    setCreating(true);
    try {
      await base44.auth.register({ email: form.email, password: form.password });
      const newUser = await base44.entities.User.filter({ email: form.email });
      if (newUser && newUser.length > 0) {
        await base44.entities.User.update(newUser[0].id, { role: form.role });
      }
      toast.success(`Usuário ${form.email} criado com permissão ${form.role === 'admin' ? 'de Administrador' : form.role === 'manager' ? 'de Gerente' : 'de Usuário'}`);
      setShowCreate(false);
      setForm({ email: '', password: '', confirmPassword: '', role: 'user' });
      load();
    } catch (err) {
      toast.error(`Erro ao criar: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Usuários do Sistema
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gerencie os administradores e usuários com acesso ao painel</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5 border-border">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Criar Usuário
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Shield className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Administradores</p>
            <p className="text-xl font-bold text-foreground">{users.filter(u => u.role === 'admin').length}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <User className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Usuários</p>
            <p className="text-xl font-bold text-foreground">{users.filter(u => u.role !== 'admin').length}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/30">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usuários Cadastrados ({users.length})</p>
        </div>
        {loading ? (
          <div className="space-y-px">
            {[1,2,3].map(i => <div key={i} className="h-14 bg-secondary/20 animate-pulse m-2 rounded-lg" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <Users className="w-10 h-10 opacity-20" />
            <p className="text-sm">Nenhum usuário encontrado</p>
          </div>
        ) : (
          <div>
            {users.map((u, i) => (
              <div key={u.id} className={`flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-secondary/20'}`}>
                <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-primary">{(u.full_name || u.email || '?')[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{u.full_name || '—'}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3 flex-shrink-0" /> {u.email}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLORS[u.role] || ROLE_COLORS.user}`}>
                  {ROLE_LABELS[u.role] || u.role}
                </span>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  {u.created_date ? new Date(u.created_date).toLocaleDateString('pt-BR') : '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create User Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-foreground text-sm">Criar Usuário</h3>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">E-mail</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="admin@exemplo.com"
                  className="bg-input border-border h-9 text-sm"
                  required
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Senha</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  className="bg-input border-border h-9 text-sm"
                  required
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Confirmar Senha</Label>
                <Input
                  type="password"
                  value={form.confirmPassword}
                  onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                  placeholder="••••••••"
                  className="bg-input border-border h-9 text-sm"
                  required
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Nível de Permissão</Label>
                <div className="space-y-2">
                  {[
                    { value: 'admin', label: 'Administrador', desc: 'Acesso total ao sistema', icon: Shield, color: 'text-red-400' },
                    { value: 'manager', label: 'Gerente', desc: 'Gerencia clientes e planos', icon: Users, color: 'text-orange-400' },
                    { value: 'user', label: 'Usuário', desc: 'Acesso básico de visualização', icon: User, color: 'text-blue-400' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, role: opt.value })}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-sm transition-all ${
                        form.role === opt.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <opt.icon className={`w-4 h-4 ${form.role === opt.value ? 'text-primary' : opt.color}`} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-medium">{opt.label}</p>
                        <p className="text-xs opacity-70">{opt.desc}</p>
                      </div>
                      {form.role === opt.value && <CheckCircle className="w-4 h-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)} className="border-border">Cancelar</Button>
                <Button type="submit" size="sm" disabled={creating} className="gap-2">
                  {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Criar Usuário
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}