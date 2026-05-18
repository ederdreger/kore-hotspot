import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Plus, Trash2, RefreshCw, Shield, User, Mail, X, CheckCircle, Edit2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', user: 'Usuário', inactive: 'Inativo' };
const ROLE_COLORS = {
  admin: 'bg-red-500/10 text-red-400 border border-red-500/20',
  manager: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  user: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  inactive: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
};

export default function UsersPage() {
  const { getToken } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ email: '', full_name: '', password: '', confirmPassword: '', role: 'user' });
  const [saving, setSaving] = useState(false);

  const callAdmin = async (payload) => {
    const res = await base44.functions.invoke('adminAuth', { ...payload, token: getToken() });
    return res.data;
  };

  const load = async () => {
    setLoading(true);
    const data = await callAdmin({ action: 'listUsers' }).catch(() => ({ users: [] }));
    setUsers(data.users || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => setForm({ email: '', full_name: '', password: '', confirmPassword: '', role: 'user' });

  const handleCreate = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) return toast.error('As senhas não coincidem');
    setSaving(true);
    try {
      await callAdmin({ action: 'createUser', email: form.email, full_name: form.full_name, password: form.password, role: form.role });
      toast.success('Usuário criado com sucesso');
      setShowCreate(false);
      resetForm();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Erro ao criar usuário');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setForm({ email: user.email, full_name: user.full_name || '', password: '', confirmPassword: '', role: user.role || 'user' });
    setShowEdit(true);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    if (form.password && form.password !== form.confirmPassword) return toast.error('As senhas não coincidem');
    setSaving(true);
    try {
      await callAdmin({ action: 'updateUser', userId: editingUser.id, full_name: form.full_name, role: form.role, newPassword: form.password || undefined });
      toast.success('Usuário atualizado com sucesso');
      setShowEdit(false);
      setEditingUser(null);
      resetForm();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Erro ao atualizar usuário');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Excluir o usuário ${user.email}?`)) return;
    try {
      await callAdmin({ action: 'deleteUser', userId: user.id });
      toast.success('Usuário excluído');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Erro ao excluir');
    }
  };

  const handleToggleStatus = async (user) => {
    const role = user.role === 'inactive' ? 'user' : 'inactive';
    await callAdmin({ action: 'updateUser', userId: user.id, full_name: user.full_name, role });
    toast.success(role === 'inactive' ? 'Usuário inativado' : 'Usuário reativado');
    load();
  };

  const handleResetDefault = async () => {
    const res = await base44.functions.invoke('adminAuth', { action: 'resetDefaults' });
    toast.success(`Logins padrão prontos. Senha: ${res.data.password}`);
    load();
  };

  const UserForm = ({ onSubmit, edit = false }) => (
    <form onSubmit={onSubmit} className="p-6 space-y-4">
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">E-mail</Label>
        <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled={edit} className="bg-input border-border h-9 text-sm" required />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">Nome</Label>
        <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className="bg-input border-border h-9 text-sm" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">{edit ? 'Nova Senha (opcional)' : 'Senha'}</Label>
        <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="bg-input border-border h-9 text-sm" required={!edit} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">Confirmar Senha</Label>
        <Input type="password" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} className="bg-input border-border h-9 text-sm" required={!edit} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[{ value: 'admin', label: 'Admin', icon: Shield }, { value: 'manager', label: 'Gerente', icon: Users }, { value: 'user', label: 'Usuário', icon: User }].map(opt => (
          <button key={opt.value} type="button" onClick={() => setForm({ ...form, role: opt.value })} className={`p-3 rounded-xl border text-xs flex flex-col items-center gap-1 ${form.role === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
            <opt.icon className="w-4 h-4" /> {opt.label}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={() => { setShowCreate(false); setShowEdit(false); setEditingUser(null); resetForm(); }} className="border-border">Cancelar</Button>
        <Button type="submit" size="sm" disabled={saving} className="gap-2">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
          Salvar
        </Button>
      </div>
    </form>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Usuários do Sistema</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Módulo próprio de usuários do painel, sem verificação de e-mail</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5 border-border"><RefreshCw className="w-3.5 h-3.5" /> Atualizar</Button>
          <Button variant="outline" size="sm" onClick={handleResetDefault} className="gap-1.5 border-border"><RefreshCw className="w-3.5 h-3.5" /> Resetar Padrão</Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Criar Usuário</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3"><Shield className="w-5 h-5 text-red-400" /><div><p className="text-xs text-muted-foreground">Administradores</p><p className="text-xl font-bold">{users.filter(u => u.role === 'admin').length}</p></div></div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3"><User className="w-5 h-5 text-blue-400" /><div><p className="text-xs text-muted-foreground">Usuários</p><p className="text-xl font-bold">{users.length}</p></div></div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/30"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usuários Cadastrados ({users.length})</p></div>
        {loading ? <div className="p-8 text-center text-muted-foreground">Carregando...</div> : users.length === 0 ? <div className="p-12 text-center text-muted-foreground">Nenhum usuário encontrado</div> : users.map((u, i) => (
          <div key={u.id} className={`flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 ${i % 2 ? 'bg-secondary/20' : ''}`}>
            <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"><span className="text-sm font-bold text-primary">{(u.full_name || u.email || '?')[0].toUpperCase()}</span></div>
            <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{u.full_name || '—'}</p><p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><Mail className="w-3 h-3" /> {u.email}</p></div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLORS[u.role] || ROLE_COLORS.user}`}>{ROLE_LABELS[u.role] || u.role}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => handleEdit(u)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => handleToggleStatus(u)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-warning">{u.role === 'inactive' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
              <button onClick={() => handleDelete(u)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {(showCreate || showEdit) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <h3 className="font-semibold text-sm">{showEdit ? 'Editar Usuário' : 'Criar Usuário'}</h3>
              <button onClick={() => { setShowCreate(false); setShowEdit(false); setEditingUser(null); resetForm(); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <UserForm onSubmit={showEdit ? handleUpdate : handleCreate} edit={showEdit} />
          </div>
        </div>
      )}
    </div>
  );
}