import { createClientFromRequest } from 'npm:@base44/sdk@0.8.29';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
        
        const body = await req.json();
        const { username, password } = body;
        
        if (!username || !password) {
            return Response.json({ error: 'Usuário e senha obrigatórios' }, { status: 400 });
        }

        // Tentar autenticar pelo radius_username
        let clients = await base44.asServiceRole.entities.Client.filter({
            radius_username: username,
            radius_password: password
        });
        
        // Fallback: tentar autenticar pelo CPF
        if (clients.length === 0) {
            clients = await base44.asServiceRole.entities.Client.filter({
                cpf: username,
                radius_password: password
            });
        }
        
        if (clients.length > 0) {
            return Response.json({ success: true, client: clients[0] });
        }
        
        return Response.json({ success: false, error: 'Credenciais inválidas' }, { status: 401 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});