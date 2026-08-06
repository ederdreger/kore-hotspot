#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_NAME="Kore-HotSpot Installer"
REPO_SLUG="${REPO_SLUG:-ederdreger/kore-hotspot}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-latest}"

log() { printf '\033[1;36m[%s]\033[0m %s\n' "$APP_NAME" "$*"; }
fail() { printf '\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root: curl .../install-wizard.sh | sudo bash"
[ -r /dev/tty ] || fail "Este assistente precisa de um terminal interativo. Para automacao, use scripts/install.sh com variaveis de ambiente."
exec 3<>/dev/tty

. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || fail "Somente Ubuntu Server e suportado."
ubuntu_major="${VERSION_ID%%.*}"
[ "$ubuntu_major" -ge 20 ] || fail "Use Ubuntu Server 20.04 ou superior."

prompt() {
  local variable="$1" label="$2" default_value="${3:-}" answer
  if [ -n "$default_value" ]; then
    printf '%s [%s]: ' "$label" "$default_value" >&3
  else
    printf '%s: ' "$label" >&3
  fi
  IFS= read -r answer <&3
  printf -v "$variable" '%s' "${answer:-$default_value}"
}

confirm() {
  local label="$1" default_answer="${2:-yes}" answer suffix
  [ "$default_answer" = "yes" ] && suffix='S/n' || suffix='s/N'
  printf '%s [%s]: ' "$label" "$suffix" >&3
  IFS= read -r answer <&3
  answer="${answer:-$default_answer}"
  [[ "$answer" =~ ^([sS]|[sS][iI][mM]|[yY]|[yY][eE][sS])$ ]]
}

valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }
valid_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] && [[ "$1" == *.* ]]; }
valid_ipv4() {
  local ip="$1" octet
  local -a octets
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$ip"
  for octet in "${octets[@]}"; do [ "$octet" -le 255 ] || return 1; done
}
valid_password() {
  local password="$1"
  [ "${#password}" -ge 12 ] && [[ "$password" =~ [A-Z] ]] && [[ "$password" =~ [a-z] ]] &&
    [[ "$password" =~ [0-9] ]] && [[ "$password" =~ [^A-Za-z0-9] ]] || return 1
  case "$password" in *[[:space:]\\\"\']*) return 1 ;; esac
}

random_password() {
  if command -v openssl >/dev/null 2>&1; then
    printf 'Kore%s!9a' "$(openssl rand -hex 10)"
  else
    printf 'Kore%s!9a' "$(od -An -N10 -tx1 /dev/urandom | tr -d ' \n')"
  fi
}

prompt_email() {
  local variable="$1" label="$2" default_value="$3" value
  while true; do
    prompt value "$label" "$default_value"
    if valid_email "$value"; then printf -v "$variable" '%s' "$value"; return; fi
    printf 'E-mail invalido. Tente novamente.\n' >&3
  done
}

prompt_domain() {
  local variable="$1" label="$2" optional="${3:-false}" value
  while true; do
    prompt value "$label" ""
    value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')"
    if [ -z "$value" ] && [ "$optional" = "true" ]; then printf -v "$variable" ''; return; fi
    if valid_domain "$value"; then printf -v "$variable" '%s' "$value"; return; fi
    printf 'Dominio invalido. Informe apenas o host, exemplo: painel.empresa.com.br\n' >&3
  done
}

prompt_password() {
  local variable="$1" label="$2" first second generated
  while true; do
    printf '%s (Enter gera uma senha forte): ' "$label" >&3
    IFS= read -r -s first <&3
    printf '\n' >&3
    if [ -z "$first" ]; then
      generated="$(random_password)"
      printf -v "$variable" '%s' "$generated"
      printf 'Senha forte gerada; ela sera exibida somente no resumo final.\n' >&3
      return
    fi
    if ! valid_password "$first"; then
      printf 'Use 12+ caracteres com maiuscula, minuscula, numero e simbolo; sem espacos, aspas ou barra invertida.\n' >&3
      continue
    fi
    printf 'Confirme a senha: ' >&3
    IFS= read -r -s second <&3
    printf '\n' >&3
    if [ "$first" = "$second" ]; then printf -v "$variable" '%s' "$first"; return; fi
    printf 'As senhas nao conferem.\n' >&3
  done
}

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+|-+$//g' | cut -c1-80
}

download_verified_installer() {
  local target_dir="$1" metadata tag asset package_url checksum_url expected actual
  metadata="$target_dir/release.json"
  if [ "$RELEASE_CHANNEL" = "latest" ]; then
    curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases/latest" -o "$metadata"
  else
    curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases/tags/${RELEASE_CHANNEL}" -o "$metadata"
  fi
  tag="$(jq -r '.tag_name // empty' "$metadata")"
  [ -n "$tag" ] || fail "Release nao encontrada"
  asset="kore-hotspot-${tag}.tar.gz"
  package_url="$(jq -r --arg name "$asset" '.assets[]? | select(.name == $name) | .browser_download_url' "$metadata" | head -n1)"
  checksum_url="$(jq -r --arg name "${asset}.sha256" '.assets[]? | select(.name == $name) | .browser_download_url' "$metadata" | head -n1)"
  if [ -z "$package_url" ] || [ -z "$checksum_url" ]; then fail "Release $tag nao possui pacote e checksum"; fi
  curl -fsSL -L "$package_url" -o "$target_dir/source.tar.gz"
  curl -fsSL -L "$checksum_url" -o "$target_dir/source.tar.gz.sha256"
  expected="$(awk 'NR == 1 {print $1}' "$target_dir/source.tar.gz.sha256")"
  actual="$(sha256sum "$target_dir/source.tar.gz" | awk '{print $1}')"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ && "$expected" = "$actual" ]] || fail "Checksum do release $tag invalido"
  mkdir -p "$target_dir/source"
  tar -xzf "$target_dir/source.tar.gz" -C "$target_dir/source" --strip-components=1
  printf '%s' "$target_dir/source/scripts/install.sh"
}

clear 2>/dev/null || true
cat >&3 <<'EOF'
============================================================
             KORE-HOTSPOT - INSTALADOR INTELIGENTE
============================================================
O assistente validara a VPS antes de instalar e nao exibira
senhas durante o preenchimento.
EOF

detected_ip="$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
while true; do
  prompt PUBLIC_HOST "IP publico da VPS" "$detected_ip"
  valid_ipv4 "$PUBLIC_HOST" && break
  printf 'IPv4 invalido.\n' >&3
done

printf '\n--- Painel administrativo central ---\n' >&3
prompt_domain DOMAIN "Dominio administrativo (vazio permite HTTP por IP)" true
default_admin_email="$([ -n "$DOMAIN" ] && printf 'admin@%s' "$DOMAIN" || printf 'admin@kore-hotspot.local')"
prompt ADMIN_NAME "Nome do administrador geral" "Administrador Kore-HotSpot"
prompt_email ADMIN_EMAIL "E-mail do administrador geral" "$default_admin_email"
prompt_password ADMIN_PASSWORD "Senha do administrador geral"
if [ -n "$DOMAIN" ]; then
  prompt_email CERTBOT_EMAIL "E-mail do Let's Encrypt" "$ADMIN_EMAIL"
  ENABLE_SSL=true
else
  CERTBOT_EMAIL="$ADMIN_EMAIL"
  ENABLE_SSL=false
fi

MULTI_TENANT=true
INITIAL_TENANT_NAME=''
INITIAL_TENANT_ID=''
INITIAL_TENANT_DOMAIN=''
INITIAL_TENANT_CONTACT_NAME=''
INITIAL_TENANT_CONTACT_EMAIL=''
INITIAL_TENANT_CONTACT_PHONE=''
INITIAL_TENANT_PLAN='free'
INITIAL_TENANT_PASSWORD=''
INITIAL_TENANT_ENABLE_SSL=false

printf '\n--- Tenant inicial ---\n' >&3
if confirm "Criar o primeiro tenant agora?" yes; then
  prompt INITIAL_TENANT_NAME "Nome da empresa/provedor" ""
  while [ -z "$INITIAL_TENANT_NAME" ]; do prompt INITIAL_TENANT_NAME "Nome obrigatorio" ""; done
  default_tenant_id="$(slugify "$INITIAL_TENANT_NAME")"
  while true; do
    prompt INITIAL_TENANT_ID "Tenant ID" "$default_tenant_id"
    [[ "$INITIAL_TENANT_ID" =~ ^[a-z0-9][a-z0-9._-]{1,79}$ ]] && [ "$INITIAL_TENANT_ID" != default ] && break
    printf 'Tenant ID invalido. Use letras minusculas, numeros, ponto, hifen ou sublinhado.\n' >&3
  done
  while true; do
    prompt_domain INITIAL_TENANT_DOMAIN "Dominio do tenant" false
    [ "$INITIAL_TENANT_DOMAIN" != "$DOMAIN" ] && break
    printf 'O tenant precisa de um dominio diferente do painel administrativo.\n' >&3
  done
  prompt INITIAL_TENANT_CONTACT_NAME "Nome do administrador do tenant" "$INITIAL_TENANT_NAME"
  prompt_email INITIAL_TENANT_CONTACT_EMAIL "E-mail do administrador do tenant" "$ADMIN_EMAIL"
  prompt INITIAL_TENANT_CONTACT_PHONE "Telefone do tenant (opcional)" ""
  while true; do
    prompt INITIAL_TENANT_PLAN "Plano (free/starter/professional/enterprise)" "free"
    case "$INITIAL_TENANT_PLAN" in free|starter|professional|enterprise) break ;; esac
    printf 'Plano invalido.\n' >&3
  done
  prompt_password INITIAL_TENANT_PASSWORD "Senha do administrador do tenant"
  INITIAL_TENANT_ENABLE_SSL=true
fi

printf '\n--- Componentes ---\n' >&3
if [ "$ubuntu_major" -eq 22 ]; then
  if confirm "Instalar tambem a controladora UniFi Network?" yes; then INSTALL_UNIFI_CONTROLLER=true; else INSTALL_UNIFI_CONTROLLER=false; fi
else
  INSTALL_UNIFI_CONTROLLER=false
  printf 'UniFi automatico desativado: o instalador classico requer Ubuntu 22.04.\n' >&3
fi
if confirm "Ativar atualizacoes automaticas do Kore-HotSpot?" yes; then AUTO_UPDATE=true; else AUTO_UPDATE=false; fi
if confirm "Salvar credenciais iniciais em /root (modo 600)?" yes; then SAVE_INSTALL_CREDENTIALS=true; else SAVE_INSTALL_CREDENTIALS=false; fi

cat >&3 <<EOF

--- Resumo ---
VPS:              ${PUBLIC_HOST}
Painel central:   ${DOMAIN:-HTTP pelo IP}
Administrador:    ${ADMIN_NAME} <${ADMIN_EMAIL}>
Tenant inicial:   ${INITIAL_TENANT_NAME:-nao criar}
Dominio tenant:   ${INITIAL_TENANT_DOMAIN:-nao se aplica}
Controladora:     ${INSTALL_UNIFI_CONTROLLER}
Atualizacao auto: ${AUTO_UPDATE}
EOF
confirm "Confirmar e iniciar a instalacao?" yes || fail "Instalacao cancelada pelo usuario."

export PUBLIC_HOST DOMAIN CERTBOT_EMAIL ENABLE_SSL ADMIN_NAME ADMIN_EMAIL ADMIN_PASSWORD
export TENANT_ID=default MULTI_TENANT AUTO_UPDATE INSTALL_UNIFI_CONTROLLER SAVE_INSTALL_CREDENTIALS
export INITIAL_TENANT_NAME INITIAL_TENANT_ID INITIAL_TENANT_DOMAIN INITIAL_TENANT_CONTACT_NAME
export INITIAL_TENANT_CONTACT_EMAIL INITIAL_TENANT_CONTACT_PHONE INITIAL_TENANT_PLAN INITIAL_TENANT_PASSWORD INITIAL_TENANT_ENABLE_SSL

if script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"; then :; else script_dir=''; fi
if [ -n "$script_dir" ] && [ -f "$script_dir/install.sh" ]; then
  installer="$script_dir/install.sh"
else
  command -v curl >/dev/null 2>&1 || fail "curl nao esta instalado"
  command -v jq >/dev/null 2>&1 || { apt-get update; apt-get install -y jq ca-certificates; }
  work_dir="$(mktemp -d /tmp/kore-installer.XXXXXX)"
  trap 'case "${work_dir:-}" in /tmp/kore-installer.*) rm -rf "$work_dir" ;; esac' EXIT
  installer="$(download_verified_installer "$work_dir")"
fi

log "Dados validados. Iniciando o mecanismo de instalacao verificado."
bash "$installer"
