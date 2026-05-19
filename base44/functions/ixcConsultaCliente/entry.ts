import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const body = await req.json().catch(() => ({}));
        const { cpf } = body;
        
        if (!cpf) {
            return Response.json({ error: 'CPF é obrigatório' }, { status: 400 });
        }
        
        const cleanCpf = cpf.replace(/[^\d]/g, '');

        const settings = await base44.asServiceRole.entities.Setting.filter({ category: 'ixc' });
        const ixcSettings = {};
        settings.forEach(s => { ixcSettings[s.key] = s.value; });
        
        if (!ixcSettings.ixc_base_url || !ixcSettings.ixc_token) {
             return Response.json({ found: false, error: 'IXC não configurado' });
        }
        
        const url = `${ixcSettings.ixc_base_url.replace(/\/$/, '')}/webservice/v1/cliente`;
        
        let authHeader = ixcSettings.ixc_token;
        if (!authHeader.startsWith('Basic ')) {
            if (authHeader.includes(':')) {
                authHeader = `Basic ${btoa(authHeader)}`;
            } else {
                authHeader = `Basic ${authHeader}`;
            }
        }
        
        // Em muitas versões do IXC o CPF fica formatado
        let formattedCpf = cleanCpf;
        if (cleanCpf.length === 11) {
            formattedCpf = cleanCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        } else if (cleanCpf.length === 14) {
            formattedCpf = cleanCpf.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        }

        const payload = {
            qtype: 'cliente.cnpj_cpf',
            query: formattedCpf,
            oper: 'L',
            page: '1',
            rp: '10',
            sortname: 'cliente.id',
            sortorder: 'desc'
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'ixcsoft': 'listar',
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            return Response.json({ found: false, error: `Erro IXC HTTP ${res.status}` });
        }
        
        const data = await res.json();
        
        if (data && data.registros && data.registros.length > 0) {
            // Encontra o registro que bate exatamente com o CPF limpo
            const client = data.registros.find(r => (r.cnpj_cpf || '').replace(/[^\d]/g, '') === cleanCpf) || data.registros[0];
            const isActive = client.ativo === 'S';
            
            return Response.json({
               found: true,
               client: {
                   id: client.id,
                   name: client.razao,
                   cpf: client.cnpj_cpf,
                   email: client.email,
                   phone: client.telefone_celular || client.telefone_residencial,
                   status: isActive ? 'active' : 'inactive'
               }
            });
        }
        
        return Response.json({ found: false, raw_ixc_response: data, cleanCpf });
    } catch (error) {
        return Response.json({ found: false, error: error.message }, { status: 500 });
    }
});