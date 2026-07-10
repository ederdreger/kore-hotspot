import { useState, useEffect } from 'react';
import { Users, Plus, Trash2, RefreshCw, Shield, User, Mail, X, CheckCircle, Edit2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { spedynet } from '@/api/spedynetClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { APP_MODULES } from '@/lib/modulePermissions';

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', user: 'Usuario', inactive: 'Inativo' };
const ROLE_COLORS = {
  admin: 'bg-red-500/10 text-red-400 border border-red-500/20',
  manager: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  user: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  inactive: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
};

const defaultForm = { email: '', full_name: '', password: '', confirmPassword: '', role: 'user', permissions: ['dashboard'] };

export default function UsersPage() {
  const { getToken, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const callAdmin = async (payload) => {
    const res = await spedynet.functions.invoke('adminAuth', { ...payload, token: getToken() });
    return res.data;
  };

  const load = async () => {
    setLoading(true);
    const data = await callAdmin({ action: 'listUsers' }).catch((error) => {
      toast.error(error?.response?.data?.error || error.message || 'Erro ao carregar usuarios');
      return { users: [] };
    });
    setUsers(data.users || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => setForm(defaultForm);

  const permissionsForSubmit = () => (form.role === 'admin' ? ['*'] : (form.permissions || []));

  const handleCreate = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) return toast.error('As senhas nao coincidem');
    setSaving(true);
    try {
      await callAdmin({
        action: 'createUser',
        email: form.email,
        full_name: form.full_name,
        password: form.password,
        role: form.role,
        permissions: permissionsForSubmit()
      });
      toast.success('Usuario criado com sucesso');
      setShowCreate(false);
      resetForm();
      load();
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || 'Erro ao criar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      full_name: user.full_name || '',
      password: '',
      confirmPassword: '',
      role: user.role || 'user',
      permissions: Array.isArray(user.permissions) ? user.permissions : ['dashboard']
    });
    setShowEdit(true);
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!editingUser) return;
    if (form.password && form.password !== form.confirmPassword) return toast.error('As senhas nao coincidem');
    setSaving(true);
    try {
      await callAdmin({
        action: 'updateUser',
        userId: editingUser.id || editingUser._id,
        full_name: form.full_name,
        role: form.role,
        newPassword: form.password || undefined,
        permissions: permissionsForSubmit()
      });
      toast.success('Usuario atualizado com sucesso');
      setShowEdit(false);
      setEditingUser(null);
      resetForm();
      load();
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || 'Erro ao atualizar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Excluir o usuario ${user.email}?`)) return;
    try {
      await callAdmin({ action: 'deleteUser', userId: user.id || user._id });
      toast.success('Usuario excluido');
      load();
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || 'Erro ao excluir usuario');
    }
  };

  const handleToggleStatus = async (user) => {
    const role = user.role === 'inactive' ? 'user' : 'inactive';
    try {
      await callAdmin({
        action: 'updateUser',
        userId: user.id || user._id,
        full_name: user.full_name,
        role,
        permissions: user.permissions || ['dashboard']
      });
      toast.success(role === 'inactive' ? 'Usuario inativado' : 'Usuario reativado');
      load();
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || 'Erro ao alterar status');
    }
  };

  const handleResetDefault = async () => {
    const res = await spedynet.functions.invoke('adminAuth', { action: 'resetDefaults' });
    toast.success(`Logins padrao prontos. Senha: ${res.data.password}`);
    load();
  };

  const togglePermission = (moduleKey) => {
    setForm((current) => {
      const next = new Set(current.permissions || []);
      if (next.has(moduleKey)) next.delete(moduleKey);
      else next.add(moduleKey);
      return { ...current, permissions: [...next] };
    });
  };

  const moduleSummary = (user) => {
    if (user.role === 'admin' || user.permissions?.includes('*')) return 'Todos os modulos';
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    if (!permissions.length) return 'Sem modulos';
    return APP_MODULES.filter(module => permissions.includes(module.key)).map(module => module.label).join(', ');
  };

  const closeModal = () => {
    setShowCreate(false);
    setShowEdit(false);
    setEditingUser(null);
    resetForm();
  };

  const renderUserForm = (onSubmit, edit = false) => (
    <form onSubmit={onSubmit} className="p-6 space-y-4">
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">E-mail</Label>
        <Input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} disabled={edit} className="bg-input border-border h-9 text-sm" required />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">Nome</Label>
        <Input value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} className="bg-input border-border h-9 text-sm" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">{edit ? 'Nova senha (opcional)' : 'Senha'}</Label>
        <Input type="password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} className="bg-input border-border h-9 text-sm" required={!edit} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">Confirmar senha</Label>
        <Input type="password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} className="bg-input border-border h-9 text-sm" required={!edit || !!form.password} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[{ value: 'admin', label: 'Admin', icon: Shield }, { value: 'manager', label: 'Gerente', icon: Users }, { value: 'user', label: 'Usuario', icon: User }].map((option) => (
          <button key={option.value} type="button" onClick={() => setForm({ ...form, role: option.value })} className={`p-3 rounded-xl border text-xs flex flex-col items-center gap-1 ${form.role === option.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
            <option.icon className="w-4 h-4" /> {option.label}
          </button>
        ))}
      </div>

      {form.role !== 'admin' && (
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Modulos permitidos</Label>
          <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-secondary/20 p-3">
            {APP_MODULES.map((module) => (
              <label key={module.key} className="flex items-center gap-2 text-xs text-foreground rounded-lg px-2 py-1.5 hover:bg-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={(form.permissions || []).includes(module.key)}
                  onChange={() => togglePermission(module.key)}
                  className="accent-primary"
                />
                <module.icon className="w-3.5 h-3.5 text-primary" />
                <span>{module.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={closeModal} className="border-border">Cancelar</Button>
        <Button type="submit" size="sm" disabled={saving} className="gap-2">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
          Salvar
        </Button>
      </div>
    </form>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Usuarios do Sistema</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Controle de acesso por usuario e modulo do painel</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5 border-border"><RefreshCw className="w-3.5 h-3.5" /> Atualizar</Button>
          {currentUser?.role === 'admin' && <Button variant="outline" size="sm" onClick={handleResetDefault} className="gap-1.5 border-border"><RefreshCw className="w-3.5 h-3.5" /> Resetar Padrao</Button>}
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Criar Usuario</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3"><Shield className="w-5 h-5 text-red-400" /><div><p className="text-xs text-muted-foreground">Administradores</p><p className="text-xl font-bold">{users.filter(user => user.role === 'admin').length}</p></div></div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3"><User className="w-5 h-5 text-blue-400" /><div><p className="text-xs text-muted-foreground">Usuarios</p><p className="text-xl font-bold">{users.length}</p></div></div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/30"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usuarios cadastrados ({users.length})</p></div>
        {loading ? <div className="p-8 text-center text-muted-foreground">Carregando...</div> : users.length === 0 ? <div className="p-12 text-center text-muted-foreground">Nenhum usuario encontrado</div> : users.map((item, index) => (
          <div key={item.id || item._id} className={`flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 ${index % 2 ? 'bg-secondary/20' : ''}`}>
            <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"><span className="text-sm font-bold text-primary">{(item.full_name || item.email || '?')[0].toUpperCase()}</span></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{item.full_name || '-'}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><Mail className="w-3 h-3" /> {item.email}</p>
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{moduleSummary(item)}</p>
            </div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLORS[item.role] || ROLE_COLORS.user}`}>{ROLE_LABELS[item.role] || item.role}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => handleEdit(item)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary" title="Editar"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => handleToggleStatus(item)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-warning" title={item.role === 'inactive' ? 'Reativar' : 'Inativar'}>{item.role === 'inactive' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
              <button onClick={() => handleDelete(item)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-destructive" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {(showCreate || showEdit) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <h3 className="font-semibold text-sm">{showEdit ? 'Editar usuario' : 'Criar usuario'}</h3>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            {renderUserForm(showEdit ? handleUpdate : handleCreate, showEdit)}
          </div>
        </div>
      )}
    </div>
  );
}
