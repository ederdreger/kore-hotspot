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

        const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN');
        if (!token) {
            return Response.json({ error: 'Access Token do Mercado Pago não configurado.' }, { status: 500 });
        }

        const origin = req.headers.get("origin") || "https://sua-url.com"; // Em produção seria a URL real do app

        // Criando a preferência de checkout no Mercado Pago
        const preference = {
            items: [
                {
                    title: `Plano de Internet - ${plan.name}`,
                    description: `Assinatura de acesso à internet por ${plan.validity_days || 30} dias`,
                    quantity: 1,
                    currency_id: 'BRL',
                    unit_price: Number(plan.price) || 0
                }
            ],
            payer: {
                name: client.name,
                email: client.email
            },
            back_urls: {
                success: `${origin}/portal?payment=success`,
                failure: `${origin}/portal?payment=failure`,
                pending: `${origin}/portal?payment=pending`
            },
            auto_return: 'approved',
            external_reference: JSON.stringify({ clientId, planId }),
        };

        const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(preference)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Mercado Pago Error:', data);
            return Response.json({ error: 'Erro ao gerar pagamento no Mercado Pago' }, { status: 500 });
        }

        return Response.json({ success: true, url: data.init_point });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});