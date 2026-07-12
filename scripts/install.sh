#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Kore-HotSpot"
SCRIPT_VERSION="v0.2.31"
REPO_URL="${REPO_URL:-https://github.com/ederdreger/kore-hotspot.git}"
REPO_SLUG="${REPO_SLUG:-ederdreger/kore-hotspot}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/kore-hotspot-src}"
WEB_DIR="${WEB_DIR:-/opt/kore-hotspot}"
API_DIR="${API_DIR:-/opt/kore-hotspot-vpn-api}"
CONFIG_DIR="${CONFIG_DIR:-/etc/kore-hotspot}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
DOMAIN="${DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@spedynet.com.br}"
ENABLE_SSL="${ENABLE_SSL:-auto}"
API_TOKEN="${API_TOKEN:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin12345}"
SSH_PORT="${SSH_PORT:-}"
VPN_LOCAL_IP="${VPN_LOCAL_IP:-10.255.255.1}"
VPN_IP_RANGE="${VPN_IP_RANGE:-10.255.255.2-10.255.255.254}"
VPN_IPSEC_SECRET="${VPN_IPSEC_SECRET:-korevpn123}"
TENANT_ID="${TENANT_ID:-default}"
MULTI_TENANT="${MULTI_TENANT:-true}"
KORE_SAAS_MP_ACCESS_TOKEN="${KORE_SAAS_MP_ACCESS_TOKEN:-}"
NODE_MAJOR="${NODE_MAJOR:-20}"
AUTO_UPDATE="${AUTO_UPDATE:-true}"
PUBLIC_URL=""
API_URL=""

log() { printf '\033[1;36m[%s]\033[0m %s\n' "$APP_NAME" "$*"; }
fail() { printf '\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Execute como root: sudo bash scripts/install.sh"
}

check_ubuntu() {
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || fail "Instalador compativel com Ubuntu Server 20.04 ou superior."
  major="${VERSION_ID%%.*}"
  [ "$major" -ge 20 ] || fail "Versao detectada: Ubuntu ${VERSION_ID}. Use Ubuntu 20.04 ou superior."
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
    PUBLIC_URL="http://${PUBLIC_HOST}:8080"
    API_URL="http://${PUBLIC_HOST}:8081"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    current="$(node -v | sed 's/^v//' | cut -d. -f1)"
    [ "$current" -ge "$NODE_MAJOR" ] && return
  fi
  log "Instalando Node.js ${NODE_MAJOR}.x"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
}

install_packages() {
  log "Instalando pacotes do sistema"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y \
    ca-certificates curl gnupg git nginx openssh-client openssl unzip tar jq \
    certbot python3-certbot-nginx \
    mysql-client freeradius freeradius-mysql \
    strongswan xl2tpd ppp iptables iptables-persistent net-tools \
    unattended-upgrades
  install_node
}

prepare_source() {
  log "Baixando codigo fonte"
  if [ -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" fetch --all --tags
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    rm -rf "$INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

build_frontend() {
  log "Compilando painel web"
  cd "$INSTALL_DIR"
  cat > .env.production <<EOF
VITE_KORE_API_URL=${API_URL}
VITE_KORE_FORCE_API_URL=false
VITE_KORE_API_TOKEN=${API_TOKEN}
VITE_KORE_TENANT_ID=${TENANT_ID}
VITE_KORE_BUILD_ID=$(date +%Y%m%d%H%M%S)
EOF
  npm ci
  npm run build
  rm -rf "$WEB_DIR"
  mkdir -p "$WEB_DIR"
  cp -a dist/. "$WEB_DIR/"
  chown -R root:root "$WEB_DIR"
}

install_backend() {
  log "Instalando API local"
  mkdir -p "$API_DIR/data" "$API_DIR/keys"
  cp "$INSTALL_DIR/server.vps.js" "$API_DIR/server.js"
  chown -R root:root "$API_DIR"
  chmod 700 "$API_DIR/keys"

  cat > /etc/systemd/system/kore-vpn-api.service <<EOF
[Unit]
Description=Kore-HotSpot API, VPN e MikroTik
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${API_DIR}
Environment=PORT=8081
Environment=KORE_VPN_API_TOKEN=${API_TOKEN}
Environment=KORE_ADMIN_PASSWORD=${ADMIN_PASSWORD}
Environment=KORE_PUBLIC_URL=${PUBLIC_URL}
Environment=KORE_DEFAULT_TENANT=${TENANT_ID}
Environment=KORE_MULTI_TENANT=${MULTI_TENANT}
Environment=KORE_SAAS_MP_ACCESS_TOKEN=${KORE_SAAS_MP_ACCESS_TOKEN}
Environment=KORE_WEB_DIR=${WEB_DIR}
Environment=KORE_CERTBOT_EMAIL=${CERTBOT_EMAIL}
Environment=KORE_PUBLIC_HOST=${PUBLIC_HOST}
ExecStart=/usr/bin/node ${API_DIR}/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
}

configure_nginx() {
  log "Configurando Nginx"
  cat > /etc/nginx/sites-available/kore-hotspot <<EOF
server {
    listen 80 default_server;
    listen 8080 default_server;
    server_name _;
    root ${WEB_DIR};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
}

install_updater() {
  log "Instalando atualizador por releases"
  mkdir -p "$CONFIG_DIR"
  cp "$INSTALL_DIR/scripts/update.sh" /usr/local/bin/kore-hotspot-update
  chmod +x /usr/local/bin/kore-hotspot-update
  cp "$INSTALL_DIR/scripts/provider-upsert.sh" /usr/local/bin/kore-provider-upsert
  chmod +x /usr/local/bin/kore-provider-upsert
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
ADMIN_PASSWORD=${ADMIN_PASSWORD}
SSH_PORT=${SSH_PORT}
VPN_LOCAL_IP=${VPN_LOCAL_IP}
VPN_IP_RANGE=${VPN_IP_RANGE}
VPN_IPSEC_SECRET=${VPN_IPSEC_SECRET}
TENANT_ID=${TENANT_ID}
MULTI_TENANT=${MULTI_TENANT}
KORE_SAAS_MP_ACCESS_TOKEN=${KORE_SAAS_MP_ACCESS_TOKEN}
RELEASE_CHANNEL=latest
EOF

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
    systemctl enable kore-hotspot-update.timer >/dev/null
  fi
}

start_services() {
  log "Iniciando servicos"
  systemctl daemon-reload
  systemctl enable --now kore-vpn-api
  systemctl enable --now nginx
  systemctl restart kore-vpn-api nginx
}

print_summary() {
  cat <<EOF

============================================================
Kore-HotSpot instalado com sucesso.

Painel:       ${PUBLIC_URL}
Painel IP:    http://${PUBLIC_HOST}:8080
API:          ${API_URL}
API direta:   http://${PUBLIC_HOST}:8081
Token API:    ${API_TOKEN}
Atualizador:  /usr/local/bin/kore-hotspot-update
SSL:          $([ -n "$DOMAIN" ] && echo "Let's Encrypt para ${DOMAIN}" || echo "nao configurado, informe DOMAIN=seu.dominio")
Tenant:       ${TENANT_ID}

Usuario inicial do painel:
  E-mail: demo@spedynet.com.br
  Senha:  ${ADMIN_PASSWORD}

Para atualizar manualmente:
  sudo kore-hotspot-update

============================================================
EOF
}

main() {
  require_root
  check_ubuntu
  detect_public_host
  API_TOKEN="${API_TOKEN:-$(openssl rand -hex 24)}"
  install_packages
  prepare_source
  build_frontend
  install_backend
  migrate_public_endpoints
  configure_nginx
  configure_nginx_no_cache
  start_services
  configure_ssl
  install_vpn_diagnostics
  configure_l2tp_base
  install_updater
  start_services
  print_summary
}

main "$@"
