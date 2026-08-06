# Instalador inteligente do Kore-HotSpot

O assistente instala uma VPS nova, valida os dados antes de alterar o servidor e configura o painel central, o primeiro tenant e os serviços necessários.

## Requisitos

- Ubuntu Server 20.04 ou superior.
- Ubuntu 22.04 quando a controladora UniFi Network também for instalada.
- Acesso `root`.
- IPv4 público.
- Mínimo de 1 GB de RAM e 5 GB livres em `/var`.
- Com UniFi: mínimo de 2 GB de RAM e 10 GB livres em `/var`.
- Registros DNS `A` do painel administrativo e dos tenants apontando para o IPv4 da VPS.

O domínio administrativo deve ser diferente dos domínios dos tenants. Exemplo:

```text
admin.exemplo.com.br       -> painel central
wifi.provedor-a.com.br     -> tenant provedor-a
wifi.provedor-b.com.br     -> tenant provedor-b
```

## Instalação interativa

Execute em uma VPS nova:

```bash
apt-get update
apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/ederdreger/kore-hotspot/main/scripts/install-wizard.sh | sudo bash
```

O assistente solicita:

1. IPv4 público da VPS.
2. Domínio administrativo e e-mail do Let's Encrypt.
3. Nome, e-mail e senha do administrador geral.
4. Nome, ID, domínio, contato, plano e administrador do tenant inicial.
5. Instalação opcional da controladora UniFi.
6. Ativação das atualizações automáticas.
7. Opção de salvar temporariamente as credenciais em `/root` com permissão `600`.

Senhas vazias são geradas automaticamente. Senhas informadas precisam ter pelo menos 12 caracteres, letra maiúscula, letra minúscula, número e símbolo.

Antes de instalar, o assistente valida Ubuntu, privilégios, memória, disco, IPv4, e-mails, domínios, DNS, identificadores dos tenants e senhas. O mecanismo definitivo é obtido de um GitHub Release e só é executado quando o SHA-256 confere.

## Componentes instalados

- Node.js 24 LTS e aplicação Kore-HotSpot.
- Nginx e Certbot/Let's Encrypt.
- FreeRADIUS e cliente MySQL.
- strongSwan, L2TP, PPP e regras VPN.
- Ferramentas SSH, JSON, diagnóstico e backup.
- Atualizações de segurança automáticas do Ubuntu.
- Timer de atualização verificada do Kore-HotSpot.
- Opcionalmente, UniFi Network Server, Java e MongoDB compatível.

## Portas

| Porta | Uso |
|---|---|
| `80/tcp` | HTTP e emissão/renovação TLS |
| `443/tcp` | Painel e API via HTTPS |
| `8081/tcp` | Entrada pública exclusiva do captive portal |
| `500/udp`, `4500/udp`, `1701/udp` | VPN L2TP/IPsec |
| `8080/tcp` | Inform UniFi, quando instalado |
| `8443/tcp` | Painel UniFi, quando instalado |
| `3478/udp`, `10001/udp` | Descoberta e STUN UniFi |
| porta SSH atual | Administração da VPS |

A API Node escuta somente em `127.0.0.1:8082` e não deve ser aberta no firewall.

## Administradores e tenants

O administrador geral pertence ao tenant reservado `default` e acessa o módulo de provedores. Cada provedor criado recebe um tenant isolado e um usuário `provider_admin` próprio.

O instalador usa a senha administrativa apenas no primeiro boot. Depois de criar o hash, remove a senha do arquivo de ambiente e reinicia a API. A senha do tenant também é armazenada somente como hash.

Se a gravação temporária das credenciais for aceita, elas ficam em:

```text
/root/kore-hotspot-credentials.txt
```

Troque as senhas no primeiro acesso e apague esse arquivo.

## Instalação automatizada

Para cloud-init ou automação sem terminal, use diretamente `scripts/install.sh` com variáveis:

```bash
sudo env \
  PUBLIC_HOST="203.0.113.10" \
  DOMAIN="admin.exemplo.com.br" \
  CERTBOT_EMAIL="infra@exemplo.com.br" \
  ENABLE_SSL=true \
  ADMIN_NAME="Administrador Geral" \
  ADMIN_EMAIL="admin@exemplo.com.br" \
  ADMIN_PASSWORD="SenhaCentral123!" \
  TENANT_ID=default \
  MULTI_TENANT=true \
  INITIAL_TENANT_NAME="Provedor A" \
  INITIAL_TENANT_ID="provedor-a" \
  INITIAL_TENANT_DOMAIN="wifi.provedor-a.com.br" \
  INITIAL_TENANT_CONTACT_NAME="Administrador Provedor A" \
  INITIAL_TENANT_CONTACT_EMAIL="admin@provedor-a.com.br" \
  INITIAL_TENANT_PASSWORD="SenhaTenant123!" \
  INITIAL_TENANT_PLAN=free \
  INITIAL_TENANT_ENABLE_SSL=true \
  INSTALL_UNIFI_CONTROLLER=true \
  AUTO_UPDATE=true \
  bash scripts/install.sh
```

Para validar os parâmetros sem instalar:

```bash
sudo -E bash scripts/install.sh --validate-config
```

## Verificação final

O instalador só informa sucesso depois de executar:

```bash
kore-hotspot-doctor
```

Verificações manuais úteis:

```bash
systemctl status kore-vpn-api nginx freeradius strongswan-starter xl2tpd
curl http://127.0.0.1:8082/health
ss -lntup | grep -E ':(8080|8081|8082|8443)'
```

Se uma instalação existente for encontrada, o instalador para e orienta o uso de `kore-hotspot-update`, evitando sobrescrever dados por engano.
