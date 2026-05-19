import { createClientFromRequest } from 'npm:@base44/sdk@0.8.29';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
        
        const { clientId } = await req.json();
        if (!clientId) return Response.json({ error: 'Missing client id' }, { status: 400 });
        
        const client = await base44.asServiceRole.entities.Client.get(clientId);
        const plans = await base44.asServiceRole.entities.Plan.filter({ status: 'active' });
        
        return Response.json({ success: true, client, plans });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});