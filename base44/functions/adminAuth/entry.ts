import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_PASSWORD = 'Admin12345';
const DEFAULT_USERS = [
  { email: 'demo@spedynet.com.br', full_name: 'Administrador Demo', role: 'admin' },
  { email: 'spedynet@spedynet.com.br', full_name: 'Administrador Spedynet', role: 'admin' }
];

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, email) {
  return sha256(`${email.toLowerCase()}:${password}:kore-hotspot-admin`);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name || user.email,
    role: user.role || 'user',
    status: user.status || (user.role === 'inactive' ? 'inactive' : 'active'),
    created_date: user.created_date,
    last_login: user.last_login
  };
}

async function ensureDefaults(base44) {
  const created = [];
  for (const admin of DEFAULT_USERS) {
    const existing = await base44.asServiceRole.entities.AdminUser.filter({ email: admin.email });
    const password_hash = await hashPassword(DEFAULT_PASSWORD, admin.email);
    if (existing?.length) {
      await base44.asServiceRole.entities.AdminUser.update(existing[0].id, {
        full_name: admin.full_name,
        role: 'admin',
        status: 'active',
        password_hash
      });
    } else {
      await base44.asServiceRole.entities.AdminUser.create({ ...admin, status: 'active', password_hash });
      created.push(admin.email);
    }
  }
  return created;
}

async function requireAdmin(base44, token) {
  if (!token) throw new Error('Sessão inválida');
  const sessions = await base44.asServiceRole.entities.AdminSession.filter({ token });
  const session = sessions?.[0];
  if (!session || new Date(session.expires_at) < new Date()) throw new Error('Sessão expirada');
  const users = await base44.asServiceRole.entities.AdminUser.filter({ email: session.email });
  const user = users?.[0];
  if (!user || user.status === 'inactive' || user.role === 'inactive') throw new Error('Usuário inativo');
  return sanitizeUser(user);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const { action, email, password, token, userId, role, full_name, newPassword } = payload;

    if (action === 'resetDefaults') {
      await ensureDefaults(base44);
      return Response.json({ success: true, email: DEFAULT_USERS.map((u) => u.email).join(' / '), password: DEFAULT_PASSWORD });
    }

    if (action === 'login') {
      await ensureDefaults(base44);
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const users = await base44.asServiceRole.entities.AdminUser.filter({ email: normalizedEmail });
      const admin = users?.[0];
      if (!admin || admin.status === 'inactive' || admin.role === 'inactive') {
        return Response.json({ error: 'E-mail ou senha inválidos' }, { status: 401 });
      }
      const password_hash = await hashPassword(password || '', normalizedEmail);
      if (password_hash !== admin.password_hash) {
        return Response.json({ error: 'E-mail ou senha inválidos' }, { status: 401 });
      }
      const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
      const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
      await base44.asServiceRole.entities.AdminSession.create({
        token: sessionToken,
        admin_user_id: admin.id,
        email: admin.email,
        role: admin.role,
        expires_at: expires
      });
      await base44.asServiceRole.entities.AdminUser.update(admin.id, { last_login: new Date().toISOString() });
      return Response.json({ token: sessionToken, user: sanitizeUser(admin) });
    }

    if (action === 'validate') {
      const user = await requireAdmin(base44, token);
      return Response.json({ user });
    }

    if (action === 'logout') {
      const sessions = await base44.asServiceRole.entities.AdminSession.filter({ token });
      for (const session of sessions || []) await base44.asServiceRole.entities.AdminSession.delete(session.id);
      return Response.json({ success: true });
    }

    const currentUser = await requireAdmin(base44, token);

    if (action === 'listUsers') {
      const users = await base44.asServiceRole.entities.AdminUser.list('-created_date', 200);
      return Response.json({ users: users.map(sanitizeUser) });
    }

    if (action === 'createUser') {
      if (currentUser.role !== 'admin') return Response.json({ error: 'Acesso negado' }, { status: 403 });
      if (!email || !password) return Response.json({ error: 'E-mail e senha são obrigatórios' }, { status: 400 });
      if (String(password).length < 8) return Response.json({ error: 'A senha deve ter no mínimo 8 caracteres' }, { status: 400 });
      const normalizedEmail = String(email).trim().toLowerCase();
      const existing = await base44.asServiceRole.entities.AdminUser.filter({ email: normalizedEmail });
      if (existing?.length) return Response.json({ error: 'Usuário já existe' }, { status: 400 });
      const password_hash = await hashPassword(password, normalizedEmail);
      const created = await base44.asServiceRole.entities.AdminUser.create({
        email: normalizedEmail,
        full_name: full_name || normalizedEmail.split('@')[0],
        role: role || 'user',
        status: role === 'inactive' ? 'inactive' : 'active',
        password_hash
      });
      return Response.json({ user: sanitizeUser(created) });
    }

    if (action === 'updateUser') {
      if (currentUser.role !== 'admin') return Response.json({ error: 'Acesso negado' }, { status: 403 });
      const updateData = { role: role || 'user', status: role === 'inactive' ? 'inactive' : 'active' };
      if (full_name) updateData.full_name = full_name;
      if (newPassword) {
        if (String(newPassword).length < 8) return Response.json({ error: 'A senha deve ter no mínimo 8 caracteres' }, { status: 400 });
        const targetUsers = await base44.asServiceRole.entities.AdminUser.filter({ id: userId });
        const target = targetUsers?.[0];
        updateData.password_hash = await hashPassword(newPassword, target.email);
      }
      await base44.asServiceRole.entities.AdminUser.update(userId, updateData);
      return Response.json({ success: true });
    }

    if (action === 'deleteUser') {
      if (currentUser.role !== 'admin') return Response.json({ error: 'Acesso negado' }, { status: 403 });
      await base44.asServiceRole.entities.AdminUser.delete(userId);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});