import { createClientFromRequest } from 'npm:@base44/sdk@0.8.29';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
        
        const { clientId, planId } = await req.json();
        
        if (!clientId || !planId) {
            return Response.json({ error: 'Parâmetros inválidos' }, { status: 400 });
        }

        const client = await base44.asServiceRole.entities.Client.get(clientId);
        const plan = await base44.asServiceRole.entities.Plan.get(planId);
        
        if (!client || !plan) {
            return Response.json({ error: 'Cliente ou plano não encontrado' }, { status: 404 });
        }

        // Atualiza o cliente no banco de dados
        await base44.asServiceRole.entities.Client.update(clientId, {
            status: 'active',
            plan_id: plan.id,
            plan_name: plan.name,
            mikrotik_profile: plan.mikrotik_profile_name || 'default',
            provisioned_at: new Date().toISOString()
        });

        // Cria log de auditoria
        await base44.asServiceRole.entities.AuditLog.create({
            action: 'client_renewal',
            entity_type: 'client',
            entity_id: client.id,
            entity_name: client.name,
            status: 'success',
            message: `Renovação/Upgrade para o plano ${plan.name} via Portal do Cliente (Simulação de Pagamento)`
        });

        // Tenta provisionar no MikroTik (pega o primeiro equipamento cadastrado para simplificar a simulação)
        const mikrotiksRaw = await base44.asServiceRole.entities.Setting.filter({ category: 'mikrotik_device' });
        if (mikrotiksRaw.length > 0) {
            try {
                const mtik = JSON.parse(mikrotiksRaw[0].value);
                await base44.asServiceRole.functions.invoke('mikrotikAddUser', {
                    host: mtik.host,
                    port: mtik.port,
                    user: mtik.user,
                    password: mtik.password,
                    username: client.radius_username,
                    userPassword: client.radius_password || client.cpf,
                    profile: plan.mikrotik_profile_name || 'default',
                    server: 'all'
                });
            } catch (e) {
                console.error('Erro ao provisionar no MikroTik:', e);
                // Continua mesmo com erro no Mikrotik
            }
        }

        return Response.json({ success: true, message: 'Plano renovado e acesso liberado com sucesso!' });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});