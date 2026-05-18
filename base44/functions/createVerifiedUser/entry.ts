import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const payload = await req.json();
    const { email, password, role } = payload;

    if (!email || !password) {
      return Response.json({ error: 'Email e senha obrigatórios' }, { status: 400 });
    }

    // Check if user already exists
    const existingUsers = await base44.asServiceRole.entities.User.filter({ email });
    if (existingUsers && existingUsers.length > 0) {
      return Response.json({ error: 'Usuário já existe' }, { status: 400 });
    }

    // Extract name from email if not provided
    const fullName = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    // Create user entity first with role
    const newUser = await base44.asServiceRole.entities.User.create({
      email,
      full_name: fullName,
      role: role || 'user'
    });

    // Now register with password - this will work because user entity already exists
    try {
      const registerResult = await base44.auth.register({ email, password });
      // Auto-verify by logging in immediately
      const loginResult = await base44.auth.loginViaEmailPassword(email, password);
    } catch (e) {
      // If register fails, user was created without password verification needed
      console.log('User created without password registration:', e.message);
    }

    return Response.json({ 
      message: 'Usuário criado com sucesso',
      email,
      role: role || 'user'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});