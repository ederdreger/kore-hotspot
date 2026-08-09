export const wikiSections = [
  {
    id: 'visao-geral',
    title: 'Visão geral',
    description: 'Entenda a arquitetura e a ordem recomendada de implantação.',
    articles: [
      {
        title: 'Como o Kore-HotSpot funciona',
        body: 'O Kore-HotSpot centraliza provedores, MikroTiks, captive portal, RADIUS, vouchers, clientes, prospectos e Access Points. Cada provedor opera em um tenant isolado, identificado pelo domínio usado para acessar o painel e o portal.',
        bullets: [
          'Painel central: administra provedores, licenças e tenants.',
          'Painel do tenant: administra apenas os dados do provedor correspondente.',
          'MikroTik: entrega DHCP, DNS, Hotspot e encaminha a autenticação ao RADIUS.',
          'Captive portal: recebe o tenant assinado e oferece cadastro, cliente IXC ou voucher.',
          'UniFi: pode ser instalado na VPS e gerenciado pelo Monitor de APs.'
        ]
      },
      {
        title: 'Ordem segura de implantação',
        steps: [
          'Prepare a VPS, os registros DNS e as portas de rede.',
          'Execute o instalador inteligente e confirme o diagnóstico final.',
          'Entre no painel central e confira o tenant inicial.',
          'Cadastre o MikroTik dentro do tenant correto.',
          'Gere e execute o script do MikroTik.',
          'Use o reparo do captive e faça um teste com um cliente novo.',
          'Configure a controladora UniFi e adote os APs.',
          'Crie planos e valide cliente, prospecto e voucher.'
        ]
      }
    ]
  },
  {
    id: 'pre-requisitos',
    title: 'Pré-requisitos da VPS',
    description: 'Checklist obrigatório antes de iniciar uma instalação limpa.',
    articles: [
      {
        title: 'Servidor recomendado',
        bullets: [
          'Ubuntu Server 22.04 LTS de 64 bits.',
          'Acesso root ou sudo, IPv4 público fixo e horário sincronizado.',
          'Mínimo de 1 GB de RAM e 5 GB livres; com UniFi, mínimo de 2 GB de RAM e 10 GB livres.',
          'Um domínio exclusivo para o painel central e outro para cada tenant.',
          'Registros DNS tipo A apontando diretamente para o IPv4 da VPS.'
        ]
      },
      {
        title: 'Portas necessárias',
        table: {
          headers: ['Porta', 'Protocolo', 'Uso'],
          rows: [
            ['80 / 443', 'TCP', 'Painel, API, captive e certificados'],
            ['8081', 'TCP', 'Download do captive pelo MikroTik'],
            ['500 / 4500 / 1701', 'UDP', 'VPN L2TP/IPsec'],
            ['ESP', 'IP 50', 'Tráfego IPsec'],
            ['8080', 'TCP', 'Inform UniFi'],
            ['8443', 'TCP', 'Painel da controladora UniFi'],
            ['SSH da VPS', 'TCP', 'Administração e suporte']
          ]
        },
        note: 'Não exponha a API interna 8082. Ela deve permanecer acessível somente em 127.0.0.1.'
      },
      {
        title: 'DNS antes da instalação',
        code: 'painel.exemplo.com.br  A  203.0.113.10\nwifi.exemplo.com.br    A  203.0.113.10',
        body: 'Aguarde a propagação e confirme que todos os domínios resolvem para o IPv4 público da VPS. O instalador interrompe a execução se encontrar divergência.'
      }
    ]
  },
  {
    id: 'instalacao',
    title: 'Instalação inteligente',
    description: 'Instale todos os componentes e crie o primeiro tenant.',
    articles: [
      {
        title: 'Executar o assistente',
        body: 'Baixe o assistente oficial para um arquivo local, confira-o se desejar e execute como root.',
        code: 'curl -fsSL https://raw.githubusercontent.com/ederdreger/kore-hotspot/main/scripts/install-wizard.sh -o /root/install-kore-hotspot.sh\nchmod 700 /root/install-kore-hotspot.sh\nsudo /root/install-kore-hotspot.sh',
        steps: [
          'Informe o IPv4 público detectado pelo assistente.',
          'Informe domínio, nome, e-mail e senha do administrador central.',
          'Crie o primeiro tenant com domínio e credenciais diferentes do painel central.',
          'Escolha se a controladora UniFi será instalada.',
          'Ative atualizações automáticas e o arquivo temporário de credenciais.',
          'Revise o resumo e confirme a instalação.'
        ]
      },
      {
        title: 'O que é instalado',
        bullets: [
          'Node.js LTS, Nginx, Certbot, FreeRADIUS, StrongSwan, xl2tpd e ferramentas de diagnóstico.',
          'Frontend em /opt/kore-hotspot e API em /opt/kore-hotspot-vpn-api.',
          'Dados isolados por tenant, com permissões restritas ao root.',
          'Atualizador verificado por checksum e timer diário opcional.',
          'Certificados Let’s Encrypt e renovação automática.',
          'Controladora UniFi opcional no Ubuntu 22.04.'
        ]
      },
      {
        title: 'Validação final',
        code: 'kore-hotspot-doctor\nsystemctl status kore-vpn-api nginx freeradius --no-pager',
        body: 'A instalação só é concluída após validar serviços, API, Nginx, arquivos, VPN e logins iniciais. O resultado esperado é 0 falhas e 0 avisos.'
      }
    ]
  },
  {
    id: 'primeiro-acesso',
    title: 'Primeiro acesso e tenants',
    description: 'Separe corretamente o administrador central de cada provedor.',
    articles: [
      {
        title: 'Administrador central',
        steps: [
          'Abra o domínio administrativo informado no instalador.',
          'Entre com o e-mail e a senha inicial.',
          'Troque a senha e remova o arquivo de credenciais em /root após guardá-las em local seguro.',
          'Abra Provedores para revisar domínio, plano, limites e situação do tenant.'
        ]
      },
      {
        title: 'Acesso do tenant',
        body: 'O administrador do tenant deve sempre entrar pelo domínio do próprio provedor. O mesmo e-mail em outro domínio pertence a outro contexto e não deve acessar os dados da empresa.',
        code: 'Painel central: https://painel.exemplo.com.br\nTenant Voxion: https://wifi.exemplo.com.br',
        note: 'Ao redefinir o acesso do provedor, copie a nova senha exibida. Uma nova redefinição invalida imediatamente a senha anterior.'
      },
      {
        title: 'Criar outro provedor',
        steps: [
          'Crie previamente o registro DNS A do novo domínio.',
          'No painel central, abra Provedores e informe nome, tenant ID, domínio e contato.',
          'Defina plano comercial, limites e bloqueio por inadimplência.',
          'Salve as credenciais iniciais exibidas.',
          'Emita o certificado SSL e teste o login no domínio do tenant.'
        ]
      }
    ]
  },
  {
    id: 'mikrotik',
    title: 'MikroTik e VLAN',
    description: 'Cadastre o roteador e prepare Hotspot, DHCP, DNS, VPN e captive.',
    articles: [
      {
        title: 'Cadastrar o equipamento',
        steps: [
          'Entre no painel do tenant correto e abra Equipamentos.',
          'Informe nome, host ou IP, porta SSH e usuário de integração.',
          'Selecione a interface física. Se houver VLAN, informe o ID e o nome da interface VLAN.',
          'Defina a rede Hotspot usando gateway/prefixo, por exemplo 192.168.50.1/24.',
          'Salve e copie o script gerado pelo sistema.',
          'Execute o script no terminal do RouterOS com um usuário de privilégio full.'
        ]
      },
      {
        title: 'Exemplo com VLAN',
        code: '/interface vlan add name=HOTSPOT vlan-id=3900 interface=HotSpot\n/ip address add address=192.168.1.1/24 interface=HOTSPOT',
        body: 'A VLAN não é fixa. Use o ID, interface física e rede definidos para cada local. A ONU e os switches no caminho precisam transportar a mesma tag até o MikroTik e os APs.'
      },
      {
        title: 'Ativar o captive personalizado',
        steps: [
          'Depois de executar o script, abra o equipamento no painel.',
          'Execute Reparar captive portal.',
          'O sistema instalará as páginas em flash/kore-hotspot quando existir armazenamento persistente.',
          'Confirme que a API retorna perfil, diretório, login.html, DNS e URL do portal.',
          'Desconecte o cliente, conecte novamente e abra http://neverssl.com.'
        ],
        note: 'O resultado correto é o domínio do tenant. Se aparecer a página padrão do MikroTik, execute o diagnóstico do captive antes de alterar regras manualmente.'
      }
    ]
  },
  {
    id: 'unifi',
    title: 'UniFi e adoção de APs',
    description: 'Detecte, prepare, adote e remova equipamentos Ubiquiti.',
    articles: [
      {
        title: 'Preparar a controladora',
        steps: [
          'Abra Monitor de APs e confirme que a controladora está ativa.',
          'Cadastre a integração usando a chave de API UniFi com permissão para o site.',
          'Confira Inform em http://IP_DA_VPS:8080/inform e painel em https://IP_DA_VPS:8443.',
          'Associe a integração ao MikroTik e à VLAN de gerenciamento daquele local.'
        ]
      },
      {
        title: 'Adoção remota',
        steps: [
          'Restaure o AP para o padrão de fábrica quando ele pertencer a outra controladora.',
          'Conecte-o à VLAN e confirme lease DHCP com class-id ubnt.',
          'No sistema, detecte o AP e preencha identificação e endereço.',
          'Clique em Salvar e iniciar adoção.',
          'Aguarde o equipamento aparecer na controladora e conclua a adoção.',
          'Revise SSID, canal, banda, potência e limite de clientes.'
        ]
      },
      {
        title: 'Excluir e adotar novamente',
        body: 'Use a exclusão completa do Monitor de APs. Ela remove o registro local, cache, regras específicas e vínculo com a controladora. Depois restaure o equipamento e repita a descoberta.'
      }
    ]
  },
  {
    id: 'acesso',
    title: 'Planos, clientes e acesso',
    description: 'Configure as modalidades oferecidas no captive portal.',
    articles: [
      {
        title: 'Planos',
        steps: [
          'Cadastre nome, download, upload, duração e limites.',
          'Sincronize os perfis com o MikroTik.',
          'Defina o plano gratuito de prospecto e o plano VIP nas Configurações.',
          'Faça um teste real e confira o perfil aplicado no RADIUS Monitor.'
        ]
      },
      {
        title: 'Clientes IXC',
        body: 'Configure URL e token da API IXC em Configurações. No captive, o cliente informa os dados solicitados; após validação, recebe o plano associado e aparece no monitor com origem IXC.'
      },
      {
        title: 'Prospectos',
        body: 'O cadastro gratuito vale pelo período configurado. Ao consumir o acesso disponível, o mesmo prospecto só poderá utilizar uma nova franquia na próxima virada do dia, comprar um voucher ou tornar-se cliente IXC.'
      },
      {
        title: 'Vouchers',
        steps: [
          'Crie o plano e gere os códigos desejados.',
          'Entregue um código ainda disponível ao visitante.',
          'Durante o uso, acompanhe os estados disponível, conectando, online, desconectado e encerrado.',
          'O tempo começa após a autorização efetiva do MikroTik, não durante uma tentativa que falhou.',
          'Use paginação e filtros para localizar lotes e códigos.'
        ]
      }
    ]
  },
  {
    id: 'radius',
    title: 'RADIUS e monitoramento',
    description: 'Acompanhe autenticação, sessões, consumo e perfil aplicado.',
    articles: [
      {
        title: 'Leitura do monitor',
        bullets: [
          'Origem: voucher, prospecto, cliente local ou IXC.',
          'Plano: perfil registrado no sistema e sincronizado no MikroTik.',
          'Sessão: início, duração, endereço IP, MAC e NAS.',
          'Tráfego: upload, download e limites da autorização.'
        ]
      },
      {
        title: 'Quando a sessão cai antes do prazo',
        steps: [
          'Confira o tempo restante no voucher ou plano.',
          'Verifique idle-timeout, keepalive-timeout e Session-Timeout.',
          'Confirme comunicação do MikroTik com o FreeRADIUS pela VPN ou IP autorizado.',
          'Compare os horários da VPS e do MikroTik.',
          'Consulte Logs e RADIUS Monitor antes de recriar o usuário.'
        ]
      }
    ]
  },
  {
    id: 'operacao',
    title: 'Operação e manutenção',
    description: 'Atualize, diagnostique, faça backup e recupere com segurança.',
    articles: [
      {
        title: 'Atualizar o sistema',
        code: 'kore-hotspot-update && kore-hotspot-doctor',
        body: 'O atualizador baixa apenas releases com checksum válido, preserva os bancos dos tenants, cria backup e executa diagnóstico. A versão exibida na barra lateral acompanha o pacote instalado.'
      },
      {
        title: 'Comandos de diagnóstico',
        code: 'kore-hotspot-doctor\nkore-vpn-diagnose\nsystemctl status kore-vpn-api nginx freeradius --no-pager\njournalctl -u kore-vpn-api -n 200 --no-pager',
        note: 'Não publique tokens, senhas, chaves privadas, chap-secrets ou arquivos runtime.env em chamados ou capturas de tela.'
      },
      {
        title: 'Backup',
        bullets: [
          'Dados principais: /opt/kore-hotspot-vpn-api/data.',
          'Configuração: /etc/kore-hotspot.',
          'Certificados: /etc/letsencrypt.',
          'VPN: /etc/ipsec.conf, /etc/ipsec.secrets, /etc/xl2tpd e /etc/ppp.',
          'Teste regularmente a restauração em uma VPS isolada.'
        ]
      }
    ]
  },
  {
    id: 'solucao-problemas',
    title: 'Solução de problemas',
    description: 'Diagnóstico orientado pelos sintomas mais comuns.',
    articles: [
      {
        title: 'Página padrão do MikroTik',
        bullets: [
          'Confirme que o perfil ativo usa flash/kore-hotspot.',
          'Confirme flash/kore-hotspot/login.html.',
          'Execute Reparar captive portal pelo sistema.',
          'Remova a sessão do cliente e abra uma página HTTP sem HTTPS forçado.'
        ]
      },
      {
        title: 'DNS_PROBE ou sem redirecionamento',
        bullets: [
          'O DHCP deve entregar o gateway do Hotspot como DNS.',
          'O MikroTik deve aceitar DNS TCP e UDP 53 na interface Hotspot.',
          'allow-remote-requests precisa estar ativo.',
          'O domínio do tenant deve existir no DNS estático e resolver para a VPS.'
        ]
      },
      {
        title: 'Login administrativo inválido',
        bullets: [
          'Confirme o domínio correto: central e tenant não compartilham contexto.',
          'Use a última senha gerada; cada redefinição invalida a anterior.',
          'Verifique se o tenant e o usuário estão ativos.',
          'Confirme que o Nginx encaminha /api para 127.0.0.1:8082.'
        ]
      },
      {
        title: 'UniFi detectado, mas não adota',
        bullets: [
          'Confirme que o AP está realmente ativo no lease DHCP atual.',
          'Teste acesso do AP à porta 8080 da VPS.',
          'Confira Option 43, DNS unifi e anúncio UDP 10001.',
          'Elimine IPv6 incorreto e vínculo com controladora anterior.',
          'Se o AP aparece para adoção manual, valide chave de API e site da integração.'
        ]
      }
    ]
  }
];

export function searchableWikiText(section) {
  return JSON.stringify(section).toLocaleLowerCase('pt-BR');
}
