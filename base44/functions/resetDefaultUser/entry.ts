import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function can be called without auth for initial setup
    const defaultEmail = 'demo@spedynet.com.br';
    const defaultPassword = 'Admin12345';

    // Check if default user already exists
    const existingUsers = await base44.asServiceRole.entities.User.filter({ email: defaultEmail });
    if (existingUsers && existingUsers.length > 0) {
      // Update password if needed
      try {
        await base44.auth.loginViaEmailPassword(defaultEmail, defaultPassword);
        return Response.json({ 
          message: 'Usuário padrão já existe e está ativo',
          email: defaultEmail,
          role: 'admin'
        });
      } catch (e) {
        // User exists but password might be wrong - delete and recreate
        await base44.asServiceRole.entities.User.delete(existingUsers[0].id);
      }
    }

    // Create default user entity first
    const newUser = await base44.asServiceRole.entities.User.create({
      email: defaultEmail,
      full_name: 'Administrador',
      role: 'admin'
    });

    // Register with password
    try {
      await base44.auth.register({ email: defaultEmail, password: defaultPassword });
    } catch (e) {
      console.log('Registration note:', e.message);
    }

    return Response.json({ 
      message: 'Usuário padrão criado com sucesso',
      email: defaultEmail,
      password: defaultPassword,
      role: 'admin'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});