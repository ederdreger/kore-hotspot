# Kore-HotSpot

Sistema de gerenciamento de hotspot, VPN L2TP/IPsec, MikroTik, clientes, prospectos, vouchers, planos, captive portal e integrações para provedores.

Criador e mantenedor: **Spedynet Telecom**.

## Recursos principais

- Painel administrativo web em português.
- Captive portal responsivo para celular, tablet e computador.
- Cadastro de clientes, prospectos, vouchers e planos.
- Integração com MikroTik via SSH Key.
- Criação de usuários hotspot diretamente no MikroTik.
- Monitoramento de sessões hotspot/RADIUS.
- VPN L2TP/IPsec para filiais sem IP público.
- Integração IXC para consulta de clientes existentes.
- Integração PIX/Mercado Pago preparada para liberação automática.
- Instalador inteligente para Ubuntu Server 20.04 ou superior.
- Atualização automática preparada para GitHub Releases.

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
curl -fsSL https://raw.githubusercontent.com/ederdreger/kore-hotspot/main/scripts/install.sh | sudo env PUBLIC_HOST=190.8.174.155 API_TOKEN="troque-este-token" bash
```

Variáveis úteis:

- `PUBLIC_HOST`: IP ou domínio público da VPS.
- `DOMAIN`: domínio apontado para a VPS, usado para HTTPS grátis.
- `CERTBOT_EMAIL`: e-mail usado no Let's Encrypt.
- `ENABLE_SSL`: `auto`, `true` ou `false`. Em `auto`, tenta emitir certificado quando `DOMAIN` estiver definido.
- `API_TOKEN`: token usado pelo painel para falar com a API.
- `REPO_URL`: repositório Git usado pelo instalador.
- `REPO_SLUG`: identificador GitHub, exemplo `ederdreger/kore-hotspot`.
- `BRANCH`: branch para instalação quando não houver release.
- `AUTO_UPDATE`: `true` ou `false` para habilitar o timer diário.

## Instalação com certificado grátis

Antes de instalar, aponte um registro DNS `A` para o IP público da VPS.

Exemplo:

```bash
hotspot.seudominio.com.br -> 190.8.174.155
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

## Acesso inicial

Após instalar:

- Painel: `http://IP_DA_VPS:8080`
- API: `http://IP_DA_VPS:8081`

Se instalado com `DOMAIN`, use:

- Painel: `https://SEU_DOMINIO`
- API via proxy: `https://SEU_DOMINIO/api`

Usuário inicial:

- E-mail: `demo@spedynet.com.br`
- Senha: `Admin12345`

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
- reinicia os serviços.

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
VITE_KORE_API_URL=http://SEU_IP:8081
VITE_KORE_API_TOKEN=seu-token
```

## Observações de segurança

- Use SSH Key para comunicação com MikroTik sempre que possível.
- Troque o token da API em produção.
- Restrinja portas no firewall conforme o cenário.
- Mantenha backups antes de atualizar.
- Não exponha credenciais em prints, issues ou commits.

## Licença

Projeto privado/comercial da Spedynet Telecom. O uso, redistribuição e publicação devem seguir a autorização do mantenedor.
