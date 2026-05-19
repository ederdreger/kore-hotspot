import { createClientFromRequest } from 'npm:@base44/sdk@0.8.29';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Mercado Pago envia webhooks via POST
        if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
        
        const url = new URL(req.url);
        // Pega query params caso o MP mande id e topic pela URL
        const topic = url.searchParams.get('topic') || url.searchParams.get('type');
        let paymentId = url.searchParams.get('id') || url.searchParams.get('data.id');
        
        // Tenta ler do body
        const body = await req.json().catch(() => ({}));
        if (!paymentId && body.action === 'payment.created' && body.data && body.data.id) {
            paymentId = body.data.id;
        }

        if (topic !== 'payment' && body.action !== 'payment.created') {
            return new Response('Ignored', { status: 200 });
        }

        if (!paymentId) {
            return new Response('No payment ID', { status: 400 });
        }

        const settings = await base44.asServiceRole.entities.Setting.filter({ key: 'mp_access_token' });
        const token = settings.length > 0 ? settings[0].value : null;
        if (!token) {
            console.error('mp_access_token not set in settings');
            return new Response('Token not configured', { status: 500 });
        }

        // Busca os detalhes do pagamento na API do MP para evitar fraudes
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const paymentData = await mpResponse.json();
        
        if (!mpResponse.ok) {
            console.error('Failed to fetch payment details:', paymentData);
            return new Response('Payment not found', { status: 404 });
        }

        if (paymentData.status === 'approved') {
            const externalRef = paymentData.external_reference;
            if (externalRef) {
                try {
                    const { clientId, planId } = JSON.parse(externalRef);
                    
                    const client = await base44.asServiceRole.entities.Client.get(clientId);
                    const plan = await base44.asServiceRole.entities.Plan.get(planId);
                    
                    if (client && plan) {
                        // Atualiza cliente localmente
                        await base44.asServiceRole.entities.Client.update(clientId, {
                            status: 'active',
                            plan_id: plan.id,
                            plan_name: plan.name,
                            mikrotik_profile: plan.mikrotik_profile_name || 'default',
                            provisioned_at: new Date().toISOString()
                        });

                        await base44.asServiceRole.entities.AuditLog.create({
                            action: 'client_renewal_webhook',
                            entity_type: 'client',
                            entity_id: client.id,
                            entity_name: client.name,
                            status: 'success',
                            message: `Pagamento Mercado Pago ${paymentId} APROVADO. Plano: ${plan.name}`
                        });

                        // Provisiona no MikroTik
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
                            } catch (err) {
                                console.error('Erro MikroTik provision via webhook:', err);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Erro ao processar external_reference:', e);
                }
            }
        }

        // Webhooks do MP precisam de retorno HTTP 200 rápido
        return new Response('OK', { status: 200 });
    } catch (error) {
        console.error('Webhook Error:', error);
        return new Response('Error', { status: 500 });
    }
});