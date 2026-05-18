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
      return Response.json({ error: 'Email and password required' }, { status: 400 });
    }

    // Create user directly as admin - bypasses email verification
    const newUser = await base44.asServiceRole.entities.User.create({
      email,
      role: role || 'user'
    });

    // Set password via auth system
    try {
      await base44.auth.register({ email, password });
    } catch (e) {
      // User might already exist, try to update
      const existingUsers = await base44.asServiceRole.entities.User.filter({ email });
      if (existingUsers && existingUsers.length > 0) {
        await base44.asServiceRole.entities.User.update(existingUsers[0].id, { role });
      }
    }

    return Response.json({ 
      message: 'User created successfully',
      email,
      role
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});