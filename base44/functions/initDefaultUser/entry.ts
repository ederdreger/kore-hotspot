import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Check if default user already exists
    const existingUsers = await base44.asServiceRole.entities.User.list();
    if (existingUsers && existingUsers.length > 0) {
      return Response.json({ message: 'Default user already exists', users_count: existingUsers.length });
    }

    // Create default user
    const defaultEmail = 'demo@spedynet.com.br';
    const defaultPassword = 'admin';

    await base44.auth.register({ email: defaultEmail, password: defaultPassword });

    // Fetch the created user and set as admin
    const newUsers = await base44.asServiceRole.entities.User.filter({ email: defaultEmail });
    if (newUsers && newUsers.length > 0) {
      await base44.asServiceRole.entities.User.update(newUsers[0].id, { role: 'admin' });
    }

    return Response.json({ 
      message: 'Default user created successfully',
      email: defaultEmail,
      role: 'admin'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});