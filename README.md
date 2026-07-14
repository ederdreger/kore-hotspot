# Kore-HotSpot

Sistema de gerenciamento de hotspot, VPN L2TP/IPsec, MikroTik, clientes, prospectos, vouchers, planos, captive portal e integrações para provedores.

Criador e mantenedor: **Spedynet Telecom**.

## Recursos principais

- Painel administrativo web em português.
- Captive portal responsivo para celular, tablet e computador.
- Cadastro de clientes, prospectos, vouchers e planos, com acesso por voucher no captive portal.
- Integração com MikroTik via SSH Key.
- Criação de usuários hotspot diretamente no MikroTik.
- Monitoramento de sessões hotspot/RADIUS.
- VPN L2TP/IPsec para filiais sem IP público.
- Integração IXC para consulta de clientes existentes.
- Integração PIX/Mercado Pago preparada para liberação automática.
- Instalador inteligente para Ubuntu Server 20.04 ou superior.
- Atualização automática preparada para GitHub Releases.
- Base multi-provedor com isolamento de dados por tenant/domínio.

## Requisitos

- Ubuntu Server 20.04, 22.04, 24.04 ou superior.
- Acesso root ou sudo.
- IP público na VPS.
- Portas recomendadas liberadas no firewall:
  - `80/tcp` emissão e renovação do certificado grátis
  - `443/tcp` painel web com HTTPS
  - `8080/tcp` painel web
  - `8081/tcp` API local
  - `500/udp`, `4500/udp`, `1701/udp` VPN L2TP/IPsec
  - `22/tcp` SSH

## Instalação rápida

Na VPS limpa, execute:

```bash
sudo apt-get update
sudo apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/ederdreger/kore-hotspot/main/scripts/install.sh | sudo bash
```

O instalador detecta o IP público automaticamente, instala os pacotes necessários, compila o painel, configura Nginx, cria o serviço da API e prepara o atualizador.

## Instalação com parâmetros

```bash
curl -fsSL https://raw.githubusercontent.com/ederdreger/kore-hotspot/main/scripts/install.sh | sudo env PUBLIC_HOST=SEU_IP_PUBLICO API_TOKEN="troque-este-token" bash
```

Variáveis úteis:

- `PUBLIC_HOST`: IP ou domínio público da VPS.
- `DOMAIN`: domínio apontado para a VPS, usado para HTTPS grátis.
- `CERTBOT_EMAIL`: e-mail usado no Let's Encrypt.
- `ENABLE_SSL`: `auto`, `true` ou `false`. Em `auto`, tenta emitir certificado quando `DOMAIN` estiver definido.
- `API_TOKEN`: token legado para integrações de serviço; não substitui a sessão administrativa.
- `ADMIN_PASSWORD`: senha inicial dos administradores. Quando omitida, o instalador gera uma senha forte e a exibe no resumo.
- `TENANT_ID`: identificador interno do provedor, exemplo `provedor-a`.
- `MULTI_TENANT`: `true` ou `false`. Em `true`, os dados ficam isolados por tenant/domínio.
- `KORE_SAAS_MP_ACCESS_TOKEN`: Access Token do Mercado Pago usado para cobrar mensalidade dos provedores via Pix.
- `REPO_URL`: repositório Git usado pelo instalador.
- `REPO_SLUG`: identificador GitHub, exemplo `ederdreger/kore-hotspot`.
- `BRANCH`: branch para instalação quando não houver release.
- `AUTO_UPDATE`: `true` ou `false` para habilitar o timer diário.

## Instalação com certificado grátis

Antes de instalar, aponte um registro DNS `A` para o IP público da VPS.

Exemplo:

```bash
hotspot.seudominio.com.br -> SEU_IP_PUBLICO
```

Depois execute:

```bash
curl -fsSL https://raw.githubusercontent.com/ederdreger/kore-hotspot/main/scripts/install.sh | sudo env DOMAIN=hotspot.seudominio.com.br CERTBOT_EMAIL=admin@seudominio.com.br bash
```

O instalador usa Let's Encrypt via Certbot, configura HTTPS no Nginx e ativa renovação automática pelo `certbot.timer`.

Para testar a renovação:

```bash
sudo certbot renew --dry-run
sudo systemctl status certbot.timer
```

## Modo multi-provedor

O Kore-HotSpot pode operar com vários provedores na mesma base de aplicação. Cada provedor fica isolado por tenant/domínio, com arquivos próprios de clientes, planos, usuários, integrações, vouchers e configurações.

Exemplo de instalação para um provedor:

```bash
curl -fsSL https://raw.githubusercontent.com/ederdreger/kore-hotspot/main/scripts/install.sh | sudo env \
  DOMAIN=wifi.provedor-a.com.br \
  CERTBOT_EMAIL=admin@provedor-a.com.br \
  TENANT_ID=provedor-a \
  ADMIN_PASSWORD="senha-inicial-forte" \
  bash
```

Estrutura de dados por tenant:

```bash
/opt/kore-hotspot-vpn-api/data/tenants/default
/opt/kore-hotspot-vpn-api/data/tenants/provedor-a
/opt/kore-hotspot-vpn-api/data/tenants/provedor-b
```

Em operação com múltiplos domínios apontando para a mesma VPS, o backend também identifica o tenant pelo `Host` da requisição. Para API central, pode ser usado o cabeçalho `X-Kore-Tenant`.

## Cobrança SaaS dos provedores

No menu **Provedores**, cada provedor pode ter mensalidade, vencimento, tolerância e bloqueio por inadimplência. O botão **Gerar Pix** cria uma cobrança Mercado Pago para a mensalidade do provedor.

O plano comercial **Free** tem mensalidade zero e não aplica vencimento, tolerância ou bloqueio financeiro. Os demais planos continuam seguindo o ciclo normal de cobrança.

Quando o pagamento é aprovado pelo webhook ou pela consulta manual no painel, o sistema registra o pagamento, renova o vencimento por mais um mês e reativa o provedor caso ele estivesse suspenso.

Configure o token da conta central de cobrança:

```bash
sudo systemctl edit kore-vpn-api
```

Adicione:

```ini
[Service]
Environment=KORE_SAAS_MP_ACCESS_TOKEN=APP_USR_SEU_TOKEN_MERCADO_PAGO
```

Depois aplique:

```bash
sudo systemctl daemon-reload
sudo systemctl restart kore-vpn-api
```

## Acesso inicial

Após instalar:

- Painel: `http://IP_DA_VPS:8080`
- API: `http://IP_DA_VPS:8081`

Se instalado com `DOMAIN`, use:

- Painel: `https://SEU_DOMINIO`
- API via proxy: `https://SEU_DOMINIO/api`

Usuário inicial:

- E-mail: `spedynet@spedynet.com.br`
- Senha: valor informado em `ADMIN_PASSWORD` ou senha gerada no final da instalação.

Altere a senha após o primeiro acesso.

## Serviços criados

- `kore-vpn-api.service`: API local, automação MikroTik, VPN e integrações.
- `nginx.service`: painel web na porta `8080`.
- `certbot.timer`: renovação automática do certificado Let's Encrypt.
- `kore-hotspot-update.timer`: verificação diária de atualização.
- `kore-hotspot-update.service`: execução de atualização.

Comandos úteis:

```bash
sudo systemctl status kore-vpn-api
sudo journalctl -u kore-vpn-api -f
sudo systemctl status kore-hotspot-update.timer
```

## Atualização manual

```bash
sudo kore-hotspot-update
```

O atualizador:

- faz backup de `data` e `keys`;
- baixa a release mais recente do GitHub quando disponível;
- usa a branch configurada como fallback;
- recompila o painel;
- atualiza backend e frontend;
- reinicia os serviços;
- executa health check e diagnóstico;
- restaura automaticamente a versão anterior se a nova API não iniciar.

## Diagnóstico da instalação

Após instalar ou atualizar, execute:

```bash
sudo kore-hotspot-doctor
```

O diagnóstico valida API, Nginx, sintaxe do backend, frontend, banco JSON e serviços VPN. A instalação somente informa sucesso quando as verificações críticas passam.

## Fonte de verdade dos dados

- Cadastros, planos, configurações, vouchers e pagamentos são persistidos na VPS.
- O navegador não recria registros locais quando a API falha.
- Clientes online são confirmados por `/ip hotspot active` no MikroTik.
- O `radacct` do FreeRADIUS enriquece as sessões confirmadas, mas não determina sozinho quem está online.
- Falhas de coleta são exibidas no painel e não são convertidas em métricas simuladas.

## Atualização automática por releases

Para publicar uma nova versão:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Crie uma release no GitHub usando essa tag. As instalações com `AUTO_UPDATE=true` consultam diariamente a release mais recente e aplicam a atualização.

Configuração do atualizador:

```bash
sudo nano /etc/kore-hotspot/update.env
```

## Estrutura instalada

- Código fonte: `/opt/kore-hotspot-src`
- Painel compilado: `/opt/kore-hotspot`
- API e dados: `/opt/kore-hotspot-vpn-api`
- Backups: `/opt/kore-hotspot-backups`
- Configuração de atualização: `/etc/kore-hotspot/update.env`

## Desenvolvimento local

```bash
npm install
npm run dev
```

Build de produção:

```bash
npm run build
```

Variáveis de build:

```bash
VITE_KORE_API_TOKEN=seu-token
```

Por padrão o painel chama a API pelo mesmo domínio em `/api`, usando o proxy do Nginx. Use `VITE_KORE_FORCE_API_URL=true` apenas em cenários especiais de desenvolvimento quando realmente precisar apontar para uma API externa.

## Observações de segurança

- Use SSH Key para comunicação com MikroTik sempre que possível.
- Troque o token da API em produção.
- Restrinja portas no firewall conforme o cenário.
- Mantenha backups antes de atualizar.
- Não exponha credenciais em prints, issues ou commits.

## Licença

Projeto privado/comercial da Spedynet Telecom. O uso, redistribuição e publicação devem seguir a autorização do mantenedor.
