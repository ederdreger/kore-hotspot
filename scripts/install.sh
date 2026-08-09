#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_NAME="Kore-HotSpot"
SCRIPT_VERSION="v1.2.84"
REPO_URL="${REPO_URL:-https://github.com/ederdreger/kore-hotspot.git}"
REPO_SLUG="${REPO_SLUG:-ederdreger/kore-hotspot}"
BRANCH="${BRANCH:-main}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-latest}"
ALLOW_UNSIGNED_SOURCE="${ALLOW_UNSIGNED_SOURCE:-false}"
INSTALL_DIR="${INSTALL_DIR:-/opt/kore-hotspot-src}"
WEB_DIR="${WEB_DIR:-/opt/kore-hotspot}"
API_DIR="${API_DIR:-/opt/kore-hotspot-vpn-api}"
CONFIG_DIR="${CONFIG_DIR:-/etc/kore-hotspot}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
DOMAIN="${DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@spedynet.com.br}"
ENABLE_SSL="${ENABLE_SSL:-auto}"
API_TOKEN="${API_TOKEN:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_NAME="${ADMIN_NAME:-}"
SSH_PORT="${SSH_PORT:-}"
VPN_LOCAL_IP="${VPN_LOCAL_IP:-10.255.255.1}"
VPN_IP_RANGE="${VPN_IP_RANGE:-10.255.255.2-10.255.255.254}"
VPN_IPSEC_SECRET="${VPN_IPSEC_SECRET:-}"
TENANT_ID="${TENANT_ID:-default}"
MULTI_TENANT="${MULTI_TENANT:-true}"
INITIAL_TENANT_NAME="${INITIAL_TENANT_NAME:-}"
INITIAL_TENANT_ID="${INITIAL_TENANT_ID:-}"
INITIAL_TENANT_DOMAIN="${INITIAL_TENANT_DOMAIN:-}"
INITIAL_TENANT_CONTACT_NAME="${INITIAL_TENANT_CONTACT_NAME:-}"
INITIAL_TENANT_CONTACT_EMAIL="${INITIAL_TENANT_CONTACT_EMAIL:-}"
INITIAL_TENANT_CONTACT_PHONE="${INITIAL_TENANT_CONTACT_PHONE:-}"
INITIAL_TENANT_PLAN="${INITIAL_TENANT_PLAN:-free}"
INITIAL_TENANT_PASSWORD="${INITIAL_TENANT_PASSWORD:-}"
INITIAL_TENANT_ENABLE_SSL="${INITIAL_TENANT_ENABLE_SSL:-true}"
INSTALL_UNIFI_CONTROLLER="${INSTALL_UNIFI_CONTROLLER:-false}"
SAVE_INSTALL_CREDENTIALS="${SAVE_INSTALL_CREDENTIALS:-true}"
CREDENTIALS_FILE="${CREDENTIALS_FILE:-/root/kore-hotspot-credentials.txt}"
KORE_SAAS_MP_ACCESS_TOKEN="${KORE_SAAS_MP_ACCESS_TOKEN:-}"
NODE_MAJOR="${NODE_MAJOR:-24}"
AUTO_UPDATE="${AUTO_UPDATE:-true}"
PUBLIC_URL=""
API_URL=""
INITIAL_TENANT_ADMIN_EMAIL=""

log() { printf '\033[1;36m[%s]\033[0m %s\n' "$APP_NAME" "$*"; }
fail() { printf '\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }
on_error() { printf '\033[1;31m[ERRO]\033[0m Instalacao interrompida na linha %s. Corrija a causa e execute novamente.\n' "$1" >&2; }
trap 'on_error "$LINENO"' ERR

validate_managed_path() {
  local value="$1" label="$2"
  [[ "$value" = /* ]] || fail "$label deve ser um caminho absoluto"
  [[ "$value" != *'/../'* && "$value" != */.. && "$value" != *'/./'* ]] || fail "$label contem segmentos inseguros"
  case "$value" in /|/opt|/usr|/var|/etc|/root|/home) fail "$label aponta para um diretorio amplo e inseguro: $value" ;; esac
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Execute como root: sudo bash scripts/install.sh"
}

check_ubuntu() {
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || fail "Instalador compativel com Ubuntu Server 20.04 ou superior."
  major="${VERSION_ID%%.*}"
  [ "$major" -ge 20 ] || fail "Versao detectada: Ubuntu ${VERSION_ID}. Use Ubuntu 20.04 ou superior."
}

validate_email() {
  [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
}

validate_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] && [[ "$1" == *.* ]]
}

validate_ipv4() {
  local ip="$1" octet
  local -a octets
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$ip"
  for octet in "${octets[@]}"; do [ "$octet" -le 255 ] || return 1; done
}

validate_password() {
  local password="$1"
  [ "${#password}" -ge 12 ] && [[ "$password" =~ [A-Z] ]] && [[ "$password" =~ [a-z] ]] &&
    [[ "$password" =~ [0-9] ]] && [[ "$password" =~ [^A-Za-z0-9] ]] || return 1
  case "$password" in *[[:space:]\\\"\']*) return 1 ;; esac
}

validate_configuration() {
  validate_ipv4 "$PUBLIC_HOST" || fail "PUBLIC_HOST deve ser um IPv4 publico valido"
  [ "$TENANT_ID" = "default" ] || fail "TENANT_ID deve ser default na instalacao central. Provedores usam INITIAL_TENANT_ID."
  validate_email "$ADMIN_EMAIL" || fail "ADMIN_EMAIL invalido: ${ADMIN_EMAIL:-vazio}"
  [ -n "$ADMIN_NAME" ] || fail "ADMIN_NAME obrigatorio"
  case "$ADMIN_NAME" in *[\\\"\']*|*$'\n'*) fail "ADMIN_NAME nao pode conter aspas, barra invertida ou quebra de linha" ;; esac
  validate_password "$ADMIN_PASSWORD" || fail "ADMIN_PASSWORD deve ter 12+ caracteres, maiuscula, minuscula, numero e simbolo, sem espacos ou aspas"
  case "$ENABLE_SSL" in auto|true|false) ;; *) fail "ENABLE_SSL deve ser auto, true ou false" ;; esac
  case "$MULTI_TENANT" in true|false) ;; *) fail "MULTI_TENANT deve ser true ou false" ;; esac
  case "$AUTO_UPDATE" in true|false) ;; *) fail "AUTO_UPDATE deve ser true ou false" ;; esac
  case "$INSTALL_UNIFI_CONTROLLER" in true|false) ;; *) fail "INSTALL_UNIFI_CONTROLLER deve ser true ou false" ;; esac
  case "$SAVE_INSTALL_CREDENTIALS" in true|false) ;; *) fail "SAVE_INSTALL_CREDENTIALS deve ser true ou false" ;; esac
  if [ "$SAVE_INSTALL_CREDENTIALS" = "true" ]; then
    case "$CREDENTIALS_FILE" in /root/*) ;; *) fail "CREDENTIALS_FILE deve ficar dentro de /root" ;; esac
  fi
  case "$INITIAL_TENANT_ENABLE_SSL" in true|false) ;; *) fail "INITIAL_TENANT_ENABLE_SSL deve ser true ou false" ;; esac
  if [ -n "$DOMAIN" ]; then
    validate_domain "$DOMAIN" || fail "DOMAIN invalido: $DOMAIN"
    validate_email "$CERTBOT_EMAIL" || fail "CERTBOT_EMAIL invalido: $CERTBOT_EMAIL"
  fi
  if [ -n "$INITIAL_TENANT_NAME" ]; then
    [ "$MULTI_TENANT" = "true" ] || fail "O tenant inicial exige MULTI_TENANT=true"
    [[ "$INITIAL_TENANT_ID" =~ ^[a-z0-9][a-z0-9._-]{1,79}$ ]] || fail "INITIAL_TENANT_ID invalido"
    [ "$INITIAL_TENANT_ID" != "default" ] || fail "INITIAL_TENANT_ID nao pode ser default"
    validate_domain "$INITIAL_TENANT_DOMAIN" || fail "INITIAL_TENANT_DOMAIN invalido"
    [ "$INITIAL_TENANT_DOMAIN" != "$DOMAIN" ] || fail "O dominio do tenant deve ser diferente do dominio administrativo"
    validate_email "$INITIAL_TENANT_CONTACT_EMAIL" || fail "INITIAL_TENANT_CONTACT_EMAIL invalido"
    validate_password "$INITIAL_TENANT_PASSWORD" || fail "INITIAL_TENANT_PASSWORD nao atende aos requisitos de seguranca"
    case "$INITIAL_TENANT_PLAN" in free|starter|professional|enterprise) ;; *) fail "INITIAL_TENANT_PLAN invalido" ;; esac
  fi
}

check_resources() {
  local available_kb memory_kb required_kb
  available_kb="$(df -Pk /var | awk 'NR == 2 {print $4}')"
  memory_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  required_kb=5242880
  [ "$INSTALL_UNIFI_CONTROLLER" != "true" ] || required_kb=10485760
  [ "$available_kb" -ge "$required_kb" ] || fail "Espaco insuficiente em /var. Necessario: $((required_kb / 1048576)) GB livres."
  [ "$memory_kb" -ge 950000 ] || fail "A VPS precisa de pelo menos 1 GB de RAM."
  if [ "$INSTALL_UNIFI_CONTROLLER" = "true" ]; then
    [ "$memory_kb" -ge 1900000 ] || fail "A controladora UniFi exige pelo menos 2 GB de RAM."
    [ "${VERSION_ID%%.*}" -eq 22 ] || fail "A instalacao automatica da controladora UniFi e suportada somente no Ubuntu 22.04."
  fi
}

check_existing_installation() {
  if { [ -s "$API_DIR/data/admin-users.json" ] || [ -s "$API_DIR/data/tenants/default/admin-users.json" ]; } && [ "${ALLOW_EXISTING_INSTALL:-false}" != "true" ]; then
    fail "Uma instalacao existente foi detectada em $API_DIR. Use kore-hotspot-update; para reinstalar conscientemente, defina ALLOW_EXISTING_INSTALL=true."
  fi
}

validate_domain_dns() {
  local candidate resolved
  [[ "$PUBLIC_HOST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 0
  for candidate in "$DOMAIN" "$INITIAL_TENANT_DOMAIN"; do
    [ -n "$candidate" ] || continue
    resolved="$(getent ahostsv4 "$candidate" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
    [[ " $resolved " == *" $PUBLIC_HOST "* ]] || fail "O DNS A de $candidate nao aponta para $PUBLIC_HOST. Corrija o DNS antes de instalar."
  done
}

detect_public_host() {
  if [ -z "$PUBLIC_HOST" ]; then
    PUBLIC_HOST="$(curl -fsS --max-time 6 https://api.ipify.org || hostname -I | awk '{print $1}')"
  fi
  [ -n "$PUBLIC_HOST" ] || fail "Nao foi possivel detectar o IP publico. Defina PUBLIC_HOST=seu_ip."
  if [ -n "$DOMAIN" ]; then
    PUBLIC_URL="https://${DOMAIN}"
    API_URL="https://${DOMAIN}"
  else
    PUBLIC_URL="http://${PUBLIC_HOST}"
    API_URL="http://${PUBLIC_HOST}"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    current="$(node -v | sed 's/^v//' | cut -d. -f1)"
    [ "$current" -ge "$NODE_MAJOR" ] && return
  fi
  log "Instalando Node.js ${NODE_MAJOR}.x"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
}

install_packages() {
  log "Instalando pacotes do sistema"
  export DEBIAN_FRONTEND=noninteractive
  while IFS= read -r legacy_unifi_repo; do
    [ -n "$legacy_unifi_repo" ] || continue
    log "Desativando repositorio UniFi legado: $legacy_unifi_repo"
    mv -f "$legacy_unifi_repo" "${legacy_unifi_repo}.disabled-by-kore"
  done < <(grep -l 'dl\.ui\.com/unifi' /etc/apt/sources.list.d/*.list 2>/dev/null || true)
  apt-get update
  apt-get install -y \
    ca-certificates curl gnupg git nginx openssh-client sshpass openssl unzip tar jq \
    certbot python3-certbot-nginx \
    mysql-client freeradius freeradius-mysql \
    strongswan xl2tpd ppp iptables iptables-persistent net-tools \
    unattended-upgrades
  install_node
  systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
}

prepare_source() {
  log "Baixando codigo fonte"
  local tmp metadata tag asset_name checksum_name tarball checksum_url release_api expected_checksum actual_checksum
  tmp="$(mktemp -d)"
  metadata="$tmp/release.json"
  if [ "$RELEASE_CHANNEL" = "latest" ]; then
    release_api="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
  else
    release_api="https://api.github.com/repos/${REPO_SLUG}/releases/tags/${RELEASE_CHANNEL}"
  fi
  curl -fsSL "$release_api" -o "$metadata"
  tag="$(jq -r '.tag_name // empty' "$metadata")"
  asset_name="kore-hotspot-${tag}.tar.gz"
  checksum_name="${asset_name}.sha256"
  tarball="$(jq -r --arg name "$asset_name" '.assets[]? | select(.name == $name) | .browser_download_url' "$metadata" | head -n1)"
  checksum_url="$(jq -r --arg name "$checksum_name" '.assets[]? | select(.name == $name) | .browser_download_url' "$metadata" | head -n1)"
  if [ -n "$tarball" ] && [ -n "$checksum_url" ]; then
    curl -fsSL -L "$tarball" -o "$tmp/source.tar.gz"
    curl -fsSL -L "$checksum_url" -o "$tmp/source.tar.gz.sha256"
    expected_checksum="$(awk 'NR == 1 { print $1 }' "$tmp/source.tar.gz.sha256")"
    actual_checksum="$(sha256sum "$tmp/source.tar.gz" | awk '{ print $1 }')"
    [[ "$expected_checksum" =~ ^[a-fA-F0-9]{64}$ && "$actual_checksum" = "$expected_checksum" ]] || fail "Checksum do pacote invalido"
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$tmp/source.tar.gz" -C "$INSTALL_DIR" --strip-components=1
    rm -rf "$tmp"
    return
  fi
  rm -rf "$tmp"
  [ "$ALLOW_UNSIGNED_SOURCE" = "true" ] || fail "Release ${tag:-desconhecida} sem pacote verificado. Instalacao interrompida."
  log "AVISO: fonte sem checksum liberada explicitamente por ALLOW_UNSIGNED_SOURCE=true"
  rm -rf "$INSTALL_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
}

configure_firewall() {
  command -v ufw >/dev/null 2>&1 || return 0
  ufw status | grep -qi active || return 0
  log "Liberando somente as portas publicas necessarias no UFW"
  if [ -n "$SSH_PORT" ]; then ufw allow "${SSH_PORT}/tcp" >/dev/null; else ufw allow OpenSSH >/dev/null; fi
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 8081/tcp >/dev/null
  ufw allow 500/udp >/dev/null
  ufw allow 4500/udp >/dev/null
  ufw allow 1701/udp >/dev/null
  if [ "$INSTALL_UNIFI_CONTROLLER" = "true" ]; then
    ufw allow 8080/tcp >/dev/null
    ufw allow 8443/tcp >/dev/null
    ufw allow 3478/udp >/dev/null
    ufw allow 10001/udp >/dev/null
  fi
}

build_frontend() {
  log "Compilando painel web"
  cd "$INSTALL_DIR"
  cat > .env.production <<EOF
VITE_KORE_API_URL=${API_URL}
VITE_KORE_FORCE_API_URL=false
VITE_KORE_TENANT_ID=${TENANT_ID}
VITE_KORE_BUILD_ID=$(date +%Y%m%d%H%M%S)
EOF
  npm ci
  npm run build
  rm -rf "$WEB_DIR"
  mkdir -p "$WEB_DIR"
  cp -a dist/. "$WEB_DIR/"
  chown -R root:root "$WEB_DIR"
  find "$WEB_DIR" -type d -exec chmod 0755 {} +
  find "$WEB_DIR" -type f -exec chmod 0644 {} +
}

install_backend() {
  log "Instalando API local"
  mkdir -p "$API_DIR/data" "$API_DIR/keys" "$CONFIG_DIR"
  cp "$INSTALL_DIR/server.vps.js" "$API_DIR/server.js"
  install -m 0750 "$INSTALL_DIR/scripts/unifi-local-adopt.sh" /usr/local/sbin/kore-unifi-adopt
  chown -R root:root "$API_DIR"
  chmod 700 "$API_DIR/data" "$API_DIR/keys"
  find "$API_DIR/data" -type d -exec chmod 0700 {} +
  find "$API_DIR/data" -type f -exec chmod 0600 {} +

  cat > "$CONFIG_DIR/runtime.env" <<EOF
PORT=8082
KORE_BIND_HOST=127.0.0.1
KORE_INTERNAL_API_TOKEN=${API_TOKEN}
KORE_ADMIN_PASSWORD=${ADMIN_PASSWORD}
KORE_ADMIN_EMAIL=${ADMIN_EMAIL}
KORE_ADMIN_NAME=${ADMIN_NAME}
KORE_PUBLIC_URL=${PUBLIC_URL}
KORE_DEFAULT_TENANT=${TENANT_ID}
KORE_MULTI_TENANT=${MULTI_TENANT}
KORE_REQUIRE_TENANT_SIGNATURE=true
KORE_SAAS_MP_ACCESS_TOKEN=${KORE_SAAS_MP_ACCESS_TOKEN}
KORE_WEB_DIR=${WEB_DIR}
KORE_CERTBOT_EMAIL=${CERTBOT_EMAIL}
KORE_PUBLIC_HOST=${PUBLIC_HOST}
EOF
  chmod 600 "$CONFIG_DIR/runtime.env"

  cat > /etc/systemd/system/kore-vpn-api.service <<EOF
[Unit]
Description=Kore-HotSpot API, VPN e MikroTik
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${API_DIR}
EnvironmentFile=${CONFIG_DIR}/runtime.env
ExecStart=/usr/bin/node ${API_DIR}/server.js
Restart=always
RestartSec=3
User=root
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
}

configure_nginx() {
  log "Configurando Nginx"
  cat > /etc/nginx/sites-available/kore-hotspot <<EOF
server {
    listen 80 default_server;
    server_name _;
    root ${WEB_DIR};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /public/ {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 8081 default_server;
    server_name _;

    location = /public/hotspot-login.html {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        return 404;
    }
}
EOF
  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/kore-hotspot /etc/nginx/sites-enabled/kore-hotspot
  nginx -t
}

configure_nginx_no_cache() {
  log "Aplicando politica anti-cache do painel"
  cat > /etc/nginx/conf.d/kore-hotspot-no-cache.conf <<'EOF'
# Gerenciado pelo Kore-HotSpot. Evita frontend antigo apos atualizacoes.
add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;
add_header Pragma "no-cache" always;
add_header Expires "0" always;
EOF
  nginx -t
}

migrate_public_endpoints() {
  local settings_file tmp_file
  local default_settings="${API_DIR}/data/tenants/${TENANT_ID}/settings.json"
  mkdir -p "$(dirname "$default_settings")"
  [ -f "$default_settings" ] || printf '[]\n' > "$default_settings"
  while IFS= read -r -d '' settings_file; do
    tmp_file="$(mktemp)"
    jq --arg host "$PUBLIC_HOST" --arg base "$PUBLIC_URL" '
      (if any(.key == "vpn_server_host") then
        map(if .key == "vpn_server_host" then .value = $host else . end)
      else . + [{id:"setting_vpn_server_host",_id:"setting_vpn_server_host",key:"vpn_server_host",value:$host,category:"system",label:"VPN Server Host"}] end)
      | (if any(.key == "public_base_url") then
          map(if .key == "public_base_url" and ((.value // "") | test("190\\.8\\.174\\.155")) then .value = $base else . end)
        else . + [{id:"setting_public_base_url",_id:"setting_public_base_url",key:"public_base_url",value:$base,category:"system",label:"URL Publica"}] end)
    ' "$settings_file" > "$tmp_file"
    chown --reference="$settings_file" "$tmp_file" 2>/dev/null || true
    chmod --reference="$settings_file" "$tmp_file" 2>/dev/null || true
    mv "$tmp_file" "$settings_file"
  done < <(find "${API_DIR}/data" -type f -name settings.json -print0 2>/dev/null)
}

configure_ssl() {
  [ -n "$DOMAIN" ] || return 0
  if [ "$ENABLE_SSL" = "false" ]; then
    log "SSL desativado por ENABLE_SSL=false"
    return 0
  fi
  log "Solicitando certificado gratis Let's Encrypt para ${DOMAIN}"
  systemctl reload nginx || systemctl restart nginx
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect; then
    systemctl enable --now certbot.timer >/dev/null
    mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    cat > /etc/letsencrypt/renewal-hooks/deploy/kore-hotspot-reload-nginx.sh <<'EOF'
#!/usr/bin/env bash
systemctl reload nginx || true
EOF
    chmod +x /etc/letsencrypt/renewal-hooks/deploy/kore-hotspot-reload-nginx.sh
    log "Certificado instalado. Renovacao automatica ativa pelo certbot.timer."
  else
    if [ "$ENABLE_SSL" = "true" ]; then
      fail "Falha ao emitir certificado. Verifique DNS do dominio e porta 80 liberada."
    fi
    log "Nao foi possivel emitir o certificado agora. O painel continuara em HTTP."
  fi
}

configure_l2tp_base() {
  log "Configurando servidor VPN L2TP/IPsec"
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  cat > /etc/sysctl.d/99-kore-hotspot.conf <<EOF
net.ipv4.ip_forward = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
EOF
  sysctl -p /etc/sysctl.d/99-kore-hotspot.conf >/dev/null || true

  mkdir -p /etc/ipsec.d /etc/xl2tpd /etc/ppp
  cp -a /etc/ipsec.conf "/etc/ipsec.conf.kore-backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  cp -a /etc/ipsec.secrets "/etc/ipsec.secrets.kore-backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  cp -a /etc/xl2tpd/xl2tpd.conf "/etc/xl2tpd/xl2tpd.conf.kore-backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  cp -a /etc/ppp/options.xl2tpd "/etc/ppp/options.xl2tpd.kore-backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true

  cat > /etc/ipsec.conf <<EOF
config setup
    uniqueids=no
    charondebug="ike 1, knl 1, cfg 0"

conn %default
    keyexchange=ikev1
    ikelifetime=60m
    keylife=20m
    rekeymargin=3m
    keyingtries=1
    authby=secret
    ike=aes256-sha256-modp2048,aes256-sha1-modp2048,aes128-sha1-modp2048,aes256-sha256-modp1024,aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024,3des-md5-modp1024!
    esp=aes256-sha1-modp1024,aes192-sha1-modp1024,aes128-sha1-modp1024,aes256-sha1,aes192-sha1,aes128-sha1,3des-sha1-modp1024,3des-sha1!
    fragmentation=yes
    forceencaps=yes
    rekey=no
    dpddelay=15
    dpdtimeout=60
    dpdaction=clear

conn L2TP-PSK-NAT
    rightsubnet=vhost:%priv
    also=L2TP-PSK-noNAT

conn L2TP-PSK-noNAT
    type=transport
    left=%any
    leftprotoport=17/1701
    right=%any
    rightprotoport=17/%any
    auto=add
EOF

  cat > /etc/ipsec.secrets <<EOF
%any %any : PSK "${VPN_IPSEC_SECRET}"
EOF
  chmod 600 /etc/ipsec.secrets

  cat > /etc/xl2tpd/xl2tpd.conf <<EOF
[global]
port = 1701
auth file = /etc/ppp/chap-secrets

[lns default]
ip range = ${VPN_IP_RANGE}
local ip = ${VPN_LOCAL_IP}
require authentication = yes
name = kore-hotspot-vpn
pppoptfile = /etc/ppp/options.xl2tpd
length bit = yes
EOF

  cat > /etc/ppp/options.xl2tpd <<EOF
ipcp-accept-local
ipcp-accept-remote
refuse-pap
refuse-chap
refuse-mschap
require-mschap-v2
ms-dns 1.1.1.1
ms-dns 8.8.8.8
noccp
auth
hide-password
idle 1800
mtu 1400
mru 1400
nodefaultroute
debug
proxyarp
connect-delay 5000
lcp-echo-interval 30
lcp-echo-failure 4
EOF

  touch /etc/ppp/chap-secrets
  chmod 600 /etc/ppp/chap-secrets

  iptables -C INPUT -p udp --dport 500 -j ACCEPT 2>/dev/null || iptables -I INPUT -p udp --dport 500 -j ACCEPT
  iptables -C INPUT -p udp --dport 4500 -j ACCEPT 2>/dev/null || iptables -I INPUT -p udp --dport 4500 -j ACCEPT
  iptables -C INPUT -p udp --dport 1701 -j ACCEPT 2>/dev/null || iptables -I INPUT -p udp --dport 1701 -j ACCEPT
  iptables -C INPUT -p esp -j ACCEPT 2>/dev/null || iptables -I INPUT -p esp -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null || true
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -qi active; then
    if [ -n "$SSH_PORT" ]; then ufw allow "${SSH_PORT}/tcp" >/dev/null || true; fi
    ufw allow 500/udp >/dev/null || true
    ufw allow 4500/udp >/dev/null || true
    ufw allow 1701/udp >/dev/null || true
  fi

  systemctl daemon-reload
  systemctl enable --now xl2tpd || systemctl restart xl2tpd || true
  if systemctl cat strongswan-starter >/dev/null 2>&1; then
    systemctl enable --now strongswan-starter || true
    systemctl restart strongswan-starter || true
  elif systemctl cat strongswan >/dev/null 2>&1; then
    systemctl enable --now strongswan || true
    systemctl restart strongswan || true
  elif command -v ipsec >/dev/null 2>&1; then
    ipsec restart || true
  else
    log "Aviso: strongSwan instalado sem servico systemd detectado; verifique pacote strongswan-starter."
  fi
  systemctl restart xl2tpd
}

install_vpn_diagnostics() {
  cat > /usr/local/bin/kore-vpn-diagnose <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "=== Kore-HotSpot VPN Diagnose ==="
echo "--- IP público detectado ---"
curl -fsS --max-time 5 https://api.ipify.org || true
echo
echo "--- Serviços ---"
systemctl --no-pager --full status xl2tpd || true
systemctl --no-pager --full status strongswan-starter || systemctl --no-pager --full status strongswan || true
command -v ipsec >/dev/null 2>&1 && ipsec statusall || true
echo "--- Portas UDP locais ---"
ss -lunp | grep -E ':(500|4500|1701)\b' || true
echo "--- IPsec status ---"
ipsec statusall || true
echo "--- Arquivos principais ---"
sed -n '1,220p' /etc/ipsec.conf || true
sed -n '1,220p' /etc/xl2tpd/xl2tpd.conf || true
sed -n '1,220p' /etc/ppp/options.xl2tpd || true
echo "--- Usuarios L2TP cadastrados ---"
awk 'NF && $1 !~ /^#/ {print $1, $2, "***", $4}' /etc/ppp/chap-secrets 2>/dev/null || true
echo "--- Logs recentes ---"
journalctl --no-pager -n 180 -u xl2tpd || true
journalctl --no-pager -n 180 -u strongswan-starter || journalctl --no-pager -n 180 -u strongswan || true
journalctl --no-pager -n 240 | grep -iE 'charon|ipsec|xl2tpd|pppd|l2tp' || true
EOF
  chmod +x /usr/local/bin/kore-vpn-diagnose
  cp "$INSTALL_DIR/scripts/doctor.sh" /usr/local/bin/kore-hotspot-doctor
  chmod +x /usr/local/bin/kore-hotspot-doctor
}

bootstrap_initial_tenant() {
  local payload response certificate_response
  [ -n "$INITIAL_TENANT_NAME" ] || return 0
  log "Criando tenant inicial ${INITIAL_TENANT_ID}"
  payload="$(jq -n \
    --arg name "$INITIAL_TENANT_NAME" \
    --arg tenant_id "$INITIAL_TENANT_ID" \
    --arg domain "$INITIAL_TENANT_DOMAIN" \
    --arg contact_name "$INITIAL_TENANT_CONTACT_NAME" \
    --arg contact_email "$INITIAL_TENANT_CONTACT_EMAIL" \
    --arg contact_phone "$INITIAL_TENANT_CONTACT_PHONE" \
    --arg commercial_plan "$INITIAL_TENANT_PLAN" \
    --arg admin_password "$INITIAL_TENANT_PASSWORD" \
    '{action:"upsert", name:$name, tenant_id:$tenant_id, domain:$domain, contact_name:$contact_name, contact_email:$contact_email, contact_phone:$contact_phone, commercial_plan:$commercial_plan, admin_password:$admin_password, status:"active", block_on_overdue:false}')"
  response="$(curl -fsS --max-time 20 -X PUT "http://127.0.0.1:8082/api/providers/${INITIAL_TENANT_ID}" \
    -H "X-Kore-Internal-Token: ${API_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data "$payload")" || fail "Nao foi possivel criar o tenant inicial"
  printf '%s' "$response" | jq -e '.provider.tenant_id and .admin_credentials.email' >/dev/null || fail "A API nao confirmou a criacao do tenant inicial"
  INITIAL_TENANT_ADMIN_EMAIL="$(printf '%s' "$response" | jq -r '.admin_credentials.email')"

  if [ "$INITIAL_TENANT_ENABLE_SSL" = "true" ]; then
    log "Emitindo certificado do tenant ${INITIAL_TENANT_DOMAIN}"
    certificate_response="$(curl -fsS --max-time 180 -X PUT "http://127.0.0.1:8082/api/providers/${INITIAL_TENANT_ID}" \
      -H "X-Kore-Internal-Token: ${API_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data '{"action":"issueCertificate"}')" || fail "Falha ao emitir o certificado do tenant ${INITIAL_TENANT_DOMAIN}"
    printf '%s' "$certificate_response" | jq -e '.provider.ssl_status == "active"' >/dev/null || fail "O certificado do tenant nao foi confirmado como ativo"
  fi
}

verify_initial_access() {
  local host email password payload response session_token tenant_response wiki_page
  local -a access_rows
  access_rows=("${DOMAIN:-$PUBLIC_HOST}|${ADMIN_EMAIL}|${ADMIN_PASSWORD}|default")
  if [ -n "$INITIAL_TENANT_NAME" ]; then
    access_rows+=("${INITIAL_TENANT_DOMAIN}|${INITIAL_TENANT_ADMIN_EMAIL}|${INITIAL_TENANT_PASSWORD}|${INITIAL_TENANT_ID}")
  fi

  log "Validando logins e Wiki pelos dominios publicos"
  for row in "${access_rows[@]}"; do
    IFS='|' read -r host email password expected_tenant <<< "$row"
    payload="$(jq -cn --arg email "$email" --arg password "$password" '{action:"login",email:$email,password:$password}')"
    if [ -s "/etc/letsencrypt/live/${host}/fullchain.pem" ]; then
      response="$(curl -fsS --max-time 20 --resolve "${host}:443:127.0.0.1" -X POST "https://${host}/api/admin/auth" -H 'Content-Type: application/json' --data "$payload")" || fail "Login HTTPS falhou para ${host}"
      wiki_page="$(curl -fsS --max-time 20 --resolve "${host}:443:127.0.0.1" "https://${host}/wiki")" || fail "Wiki HTTPS indisponivel em ${host}"
    else
      response="$(curl -fsS --max-time 20 -X POST 'http://127.0.0.1/api/admin/auth' -H "Host: ${host}" -H 'Content-Type: application/json' --data "$payload")" || fail "Login HTTP falhou para ${host}"
      wiki_page="$(curl -fsS --max-time 20 'http://127.0.0.1/wiki' -H "Host: ${host}")" || fail "Wiki HTTP indisponivel em ${host}"
    fi
    printf '%s' "$response" | jq -e --arg email "$email" '.token and ((.user.email | ascii_downcase) == ($email | ascii_downcase))' >/dev/null || fail "A API nao confirmou o usuario ${email} em ${host}"
    printf '%s' "$wiki_page" | grep -q 'id="root"' || fail "O frontend da Wiki nao foi confirmado em ${host}"
    tenant_response="$(curl -fsS --max-time 10 'http://127.0.0.1:8082/api/tenant/current' -H "Host: ${host}" -H "X-Kore-Internal-Token: ${API_TOKEN}")"
    printf '%s' "$tenant_response" | jq -e --arg tenant "$expected_tenant" '.tenant.id == $tenant' >/dev/null || fail "O dominio ${host} nao resolveu para o tenant ${expected_tenant}"
    session_token="$(printf '%s' "$response" | jq -r '.token')"
    curl -fsS --max-time 10 -X POST 'http://127.0.0.1:8082/api/admin/auth' -H "Host: ${host}" -H 'Content-Type: application/json' --data "$(jq -cn --arg token "$session_token" '{action:"logout",token:$token}')" >/dev/null || true
    log "Acesso validado: ${host} -> tenant ${expected_tenant}"
  done
}

remove_bootstrap_admin_password() {
  local runtime_file="${CONFIG_DIR}/runtime.env" tmp_file
  tmp_file="$(mktemp "${CONFIG_DIR}/runtime.env.XXXXXX")"
  awk '!/^KORE_ADMIN_PASSWORD=/' "$runtime_file" > "$tmp_file"
  chown root:root "$tmp_file"
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$runtime_file"
  systemctl restart kore-vpn-api
  for _ in $(seq 1 15); do
    curl -fsS --max-time 3 http://127.0.0.1:8082/health >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "A API nao reiniciou depois da remocao da senha temporaria"
}

install_optional_unifi() {
  [ "$INSTALL_UNIFI_CONTROLLER" = "true" ] || return 0
  log "Instalando a controladora UniFi Network"
  KORE_PUBLIC_HOST="$PUBLIC_HOST" bash "$INSTALL_DIR/scripts/install-unifi.sh" --public-host "$PUBLIC_HOST"
}

write_credentials_file() {
  [ "$SAVE_INSTALL_CREDENTIALS" = "true" ] || return 0
  case "$CREDENTIALS_FILE" in /root/*) ;; *) fail "CREDENTIALS_FILE deve ficar dentro de /root" ;; esac
  cat > "$CREDENTIALS_FILE" <<EOF
Kore-HotSpot ${SCRIPT_VERSION}
Instalado em: $(date --iso-8601=seconds)

Painel administrativo: ${PUBLIC_URL}
Administrador geral: ${ADMIN_EMAIL}
Senha inicial: ${ADMIN_PASSWORD}
EOF
  if [ -n "$INITIAL_TENANT_NAME" ]; then
    cat >> "$CREDENTIALS_FILE" <<EOF

Tenant: ${INITIAL_TENANT_NAME}
Tenant ID: ${INITIAL_TENANT_ID}
Painel do tenant: https://${INITIAL_TENANT_DOMAIN}
Administrador do tenant: ${INITIAL_TENANT_ADMIN_EMAIL}
Senha inicial do tenant: ${INITIAL_TENANT_PASSWORD}
EOF
  fi
  cat >> "$CREDENTIALS_FILE" <<'EOF'

Este arquivo contem credenciais iniciais. Altere as senhas no primeiro acesso e remova o arquivo.
EOF
  chmod 600 "$CREDENTIALS_FILE"
}

install_updater() {
  log "Instalando atualizador por releases"
  mkdir -p "$CONFIG_DIR"
  cp "$INSTALL_DIR/scripts/update.sh" /usr/local/bin/kore-hotspot-update
  chmod +x /usr/local/bin/kore-hotspot-update
  cp "$INSTALL_DIR/scripts/provider-upsert.sh" /usr/local/bin/kore-provider-upsert
  chmod +x /usr/local/bin/kore-provider-upsert
  cp "$INSTALL_DIR/scripts/install-unifi.sh" /usr/local/bin/kore-unifi-install
  chmod +x /usr/local/bin/kore-unifi-install
  cat > "$CONFIG_DIR/update.env" <<EOF
REPO_URL=${REPO_URL}
REPO_SLUG=${REPO_SLUG}
BRANCH=${BRANCH}
INSTALL_DIR=${INSTALL_DIR}
WEB_DIR=${WEB_DIR}
API_DIR=${API_DIR}
PUBLIC_HOST=${PUBLIC_HOST}
DOMAIN=${DOMAIN}
CERTBOT_EMAIL=${CERTBOT_EMAIL}
ENABLE_SSL=${ENABLE_SSL}
PUBLIC_URL=${PUBLIC_URL}
API_URL=${API_URL}
API_TOKEN=${API_TOKEN}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_NAME=${ADMIN_NAME}
SSH_PORT=${SSH_PORT}
VPN_LOCAL_IP=${VPN_LOCAL_IP}
VPN_IP_RANGE=${VPN_IP_RANGE}
VPN_IPSEC_SECRET=${VPN_IPSEC_SECRET}
TENANT_ID=${TENANT_ID}
MULTI_TENANT=${MULTI_TENANT}
REQUIRE_TENANT_SIGNATURE=true
KORE_SAAS_MP_ACCESS_TOKEN=${KORE_SAAS_MP_ACCESS_TOKEN}
NODE_MAJOR=${NODE_MAJOR}
RELEASE_CHANNEL=latest
EOF
  chmod 600 "$CONFIG_DIR/update.env"

  cat > /etc/systemd/system/kore-hotspot-update.service <<EOF
[Unit]
Description=Atualizacao do Kore-HotSpot via GitHub Releases
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=${CONFIG_DIR}/update.env
ExecStart=/usr/local/bin/kore-hotspot-update
EOF

  cat > /etc/systemd/system/kore-hotspot-update.timer <<EOF
[Unit]
Description=Verificacao diaria de atualizacoes do Kore-HotSpot

[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

  if [ "$AUTO_UPDATE" = "true" ]; then
    systemctl daemon-reload
    systemctl enable --now kore-hotspot-update.timer >/dev/null
  else
    systemctl disable --now kore-hotspot-update.timer >/dev/null 2>&1 || true
  fi
}

start_services() {
  log "Iniciando servicos"
  systemctl daemon-reload
  systemctl enable --now kore-vpn-api
  systemctl enable --now nginx
  systemctl restart kore-vpn-api nginx
}

verify_installation() {
  log "Validando instalacao"
  API_DIR="$API_DIR" WEB_DIR="$WEB_DIR" /usr/local/bin/kore-hotspot-doctor || fail "A instalacao nao passou no diagnostico. Execute kore-hotspot-doctor para detalhes."
}

print_summary() {
  cat <<EOF

============================================================
Kore-HotSpot instalado com sucesso.

Painel:       ${PUBLIC_URL}
Wiki:         ${PUBLIC_URL}/wiki
Painel IP:    http://${PUBLIC_HOST}
API:          ${API_URL}/api
Captive:      http://${PUBLIC_HOST}:8081/public/hotspot-login.html
Atualizador:  /usr/local/bin/kore-hotspot-update
SSL:          $([ -n "$DOMAIN" ] && echo "Let's Encrypt para ${DOMAIN}" || echo "nao configurado, informe DOMAIN=seu.dominio")
Tenant:       ${TENANT_ID}

Usuario inicial do painel:
  Nome:   ${ADMIN_NAME}
  E-mail: ${ADMIN_EMAIL}
  Senha:  ${ADMIN_PASSWORD}

$([ -n "$INITIAL_TENANT_NAME" ] && printf 'Tenant inicial:\n  Nome:   %s\n  ID:     %s\n  Painel: https://%s\n  E-mail: %s\n  Senha:  %s\n' "$INITIAL_TENANT_NAME" "$INITIAL_TENANT_ID" "$INITIAL_TENANT_DOMAIN" "$INITIAL_TENANT_ADMIN_EMAIL" "$INITIAL_TENANT_PASSWORD")
$([ "$INSTALL_UNIFI_CONTROLLER" = "true" ] && printf 'Controladora UniFi:\n  Painel: https://%s:8443\n  Inform: http://%s:8080/inform\n' "$PUBLIC_HOST" "$PUBLIC_HOST")
$([ "$SAVE_INSTALL_CREDENTIALS" = "true" ] && printf 'Credenciais salvas temporariamente em: %s\n' "$CREDENTIALS_FILE")

Para atualizar manualmente:
  sudo kore-hotspot-update

============================================================
EOF
}

main() {
  log "Iniciando instalacao ${SCRIPT_VERSION}"
  if [ "${1:-}" = "--validate-config" ]; then
    validate_configuration
    log "Configuracao valida"
    return 0
  fi
  require_root
  check_ubuntu
  validate_managed_path "$INSTALL_DIR" INSTALL_DIR
  validate_managed_path "$WEB_DIR" WEB_DIR
  validate_managed_path "$API_DIR" API_DIR
  validate_managed_path "$CONFIG_DIR" CONFIG_DIR
  check_existing_installation
  detect_public_host
  API_TOKEN="${API_TOKEN:-$(openssl rand -hex 24)}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-$([ -n "$DOMAIN" ] && printf 'admin@%s' "$DOMAIN" || printf 'admin@kore-hotspot.local')}"
  ADMIN_NAME="${ADMIN_NAME:-Administrador Kore-HotSpot}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-Kore$(openssl rand -hex 10)!}"
  VPN_IPSEC_SECRET="${VPN_IPSEC_SECRET:-$(openssl rand -hex 24)}"
  SSH_PORT="${SSH_PORT:-$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}')}"
  validate_configuration
  check_resources
  validate_domain_dns
  install_packages
  configure_firewall
  prepare_source
  build_frontend
  install_backend
  migrate_public_endpoints
  configure_nginx
  configure_nginx_no_cache
  start_services
  configure_ssl
  bootstrap_initial_tenant
  verify_initial_access
  remove_bootstrap_admin_password
  install_vpn_diagnostics
  configure_l2tp_base
  install_updater
  install_optional_unifi
  start_services
  verify_installation
  write_credentials_file
  print_summary
}

main "$@"
