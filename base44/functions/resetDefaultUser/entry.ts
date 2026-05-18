import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const defaultEmail = 'demo@spedynet.com.br';
    const defaultPassword = 'admin';

    // Delete existing default user if exists
    try {
      const existingUsers = await base44.asServiceRole.entities.User.filter({ email: defaultEmail });
      if (existingUsers && existingUsers.length > 0) {
        for (const u of existingUsers) {
          await base44.asServiceRole.entities.User.delete(u.id);
        }
      }
    } catch (e) {
      // User might not exist, continue
    }

    // Create fresh default user
    const newUser = await base44.asServiceRole.entities.User.create({
      email: defaultEmail,
      role: 'admin'
    });

    return Response.json({ 
      message: 'Default user reset successfully',
      email: defaultEmail,
      password: defaultPassword,
      role: 'admin'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});