#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Kore-HotSpot"
SCRIPT_VERSION="v0.2.42"
REPO_URL="${REPO_URL:-https://github.com/ederdreger/kore-hotspot.git}"
REPO_SLUG="${REPO_SLUG:-ederdreger/kore-hotspot}"
BRANCH="${BRANCH:-main}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/kore-hotspot-src}"
WEB_DIR="${WEB_DIR:-/opt/kore-hotspot}"
API_DIR="${API_DIR:-/opt/kore-hotspot-vpn-api}"
CONFIG_DIR="${CONFIG_DIR:-/etc/kore-hotspot}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
DOMAIN="${DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
PUBLIC_URL="${PUBLIC_URL:-}"
API_URL="${API_URL:-}"
API_TOKEN="${API_TOKEN:-kore-vpn-api-2026}"
SSH_PORT="${SSH_PORT:-}"
VPN_LOCAL_IP="${VPN_LOCAL_IP:-10.255.255.1}"
VPN_IP_RANGE="${VPN_IP_RANGE:-10.255.255.2-10.255.255.254}"
VPN_IPSEC_SECRET="${VPN_IPSEC_SECRET:-korevpn123}"
TENANT_ID="${TENANT_ID:-default}"
MULTI_TENANT="${MULTI_TENANT:-true}"
KORE_SAAS_MP_ACCESS_TOKEN="${KORE_SAAS_MP_ACCESS_TOKEN:-}"
BACKUP_DIR="${BACKUP_DIR:-/opt/kore-hotspot-backups}"

log() { printf '\033[1;36m[%s]\033[0m %s\n' "$APP_NAME" "$*"; }
fail() { printf '\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."

load_install_config() {
  local config_file="${CONFIG_DIR}/install.env"
  if [ -f "$config_file" ]; then
    [ -n "$DOMAIN" ] || DOMAIN="$(sed -n 's/^DOMAIN=//p' "$config_file" | tail -n 1)"
    [ -n "$CERTBOT_EMAIL" ] || CERTBOT_EMAIL="$(sed -n 's/^CERTBOT_EMAIL=//p' "$config_file" | tail -n 1)"
  fi
  if [ -z "$DOMAIN" ] && [ -d /etc/letsencrypt/live ]; then
    DOMAIN="$(find /etc/letsencrypt/live -mindepth 1 -maxdepth 1 -type d ! -name README -printf '%f\n' 2>/dev/null | head -n 1)"
  fi
  CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@spedynet.com.br}"
}

detect_public_host() {
  if [ -z "$PUBLIC_HOST" ]; then
    PUBLIC_HOST="$(curl -fsS --max-time 6 https://api.ipify.org || hostname -I | awk '{print $1}')"
  fi
  [ -n "$PUBLIC_HOST" ] || fail "Nao foi possivel detectar o IP publico. Defina PUBLIC_HOST=seu_ip."
}

backup_data() {
  mkdir -p "$BACKUP_DIR"
  if [ -d "$API_DIR/data" ]; then
    tar -czf "$BACKUP_DIR/data-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$API_DIR" data keys 2>/dev/null || true
  fi
}

migrate_public_endpoints() {
  local settings_file tmp_file migrated=0
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
    migrated=$((migrated + 1))
  done < <(find "${API_DIR}/data" -type f -name settings.json -print0 2>/dev/null)
  log "Endereco publico ${PUBLIC_HOST} sincronizado em ${migrated} banco(s)"
}

install_vpn_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y strongswan xl2tpd ppp iptables iptables-persistent net-tools certbot python3-certbot-nginx
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

download_release() {
  tmp="$(mktemp -d)"
  if [ "$RELEASE_CHANNEL" = "latest" ]; then
    api="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
    tarball="$(curl -fsSL "$api" | jq -r '.tarball_url // empty')"
    [ -n "$tarball" ] || return 1
    curl -fsSL -L "$tarball" -o "$tmp/source.tar.gz"
    mkdir -p "$tmp/source"
    tar -xzf "$tmp/source.tar.gz" -C "$tmp/source" --strip-components=1
    echo "$tmp/source"
    return 0
  fi
  return 1
}

prepare_source() {
  if source_dir="$(download_release)"; then
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    cp -a "$source_dir/." "$INSTALL_DIR/"
    return
  fi

  if [ -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" fetch --all --tags
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    rm -rf "$INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

build_and_install() {
  cd "$INSTALL_DIR"
  if [ -z "$PUBLIC_URL" ]; then
    if [ -n "$DOMAIN" ]; then PUBLIC_URL="https://${DOMAIN}"; else PUBLIC_URL="http://${PUBLIC_HOST}:8080"; fi
  fi
  if [ -z "$API_URL" ]; then
    if [ -n "$DOMAIN" ]; then API_URL="https://${DOMAIN}"; else API_URL="http://${PUBLIC_HOST}:8081"; fi
  fi
  cat > .env.production <<EOF
VITE_KORE_API_URL=${API_URL}
VITE_KORE_FORCE_API_URL=false
VITE_KORE_API_TOKEN=${API_TOKEN}
VITE_KORE_TENANT_ID=${TENANT_ID}
VITE_KORE_BUILD_ID=$(date +%Y%m%d%H%M%S)
EOF
  npm ci
  npm run build
  node --check "$INSTALL_DIR/server.vps.js"

  rm -rf "${WEB_DIR}.new"
  mkdir -p "${WEB_DIR}.new"
  cp -a dist/. "${WEB_DIR}.new/"
  rm -rf "${WEB_DIR}.old"
  [ -d "$WEB_DIR" ] && mv "$WEB_DIR" "${WEB_DIR}.old"
  mv "${WEB_DIR}.new" "$WEB_DIR"

  mkdir -p "$API_DIR/data" "$API_DIR/keys"
  [ -f "$API_DIR/server.js" ] && cp "$API_DIR/server.js" "$API_DIR/server.js.rollback"
  cp "$INSTALL_DIR/server.vps.js" "$API_DIR/server.js"
  if [ -f "$INSTALL_DIR/scripts/provider-upsert.sh" ]; then
    cp "$INSTALL_DIR/scripts/provider-upsert.sh" /usr/local/bin/kore-provider-upsert
    chmod +x /usr/local/bin/kore-provider-upsert
  fi
  if [ -f "$INSTALL_DIR/scripts/install-unifi.sh" ]; then
    cp "$INSTALL_DIR/scripts/install-unifi.sh" /usr/local/bin/kore-unifi-install
    chmod +x /usr/local/bin/kore-unifi-install
  fi
  chown -R root:root "$WEB_DIR" "$API_DIR"
}

install_updater_binary() {
  if [ -f "$INSTALL_DIR/scripts/update.sh" ]; then
    # Replacing the running script through cp truncates its current inode and
    # can make Bash skip or corrupt the remaining commands. Rename atomically.
    install -m 0755 "$INSTALL_DIR/scripts/update.sh" /usr/local/bin/kore-hotspot-update.new
    mv -f /usr/local/bin/kore-hotspot-update.new /usr/local/bin/kore-hotspot-update
  fi
  if [ -f "$INSTALL_DIR/scripts/provider-upsert.sh" ]; then
    cp "$INSTALL_DIR/scripts/provider-upsert.sh" /usr/local/bin/kore-provider-upsert
    chmod +x /usr/local/bin/kore-provider-upsert
  fi
}

configure_nginx_no_cache() {
  if command -v nginx >/dev/null 2>&1; then
    cat > /etc/nginx/conf.d/kore-hotspot-no-cache.conf <<'EOF'
# Gerenciado pelo Kore-HotSpot. Evita frontend antigo apos atualizacoes.
add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;
add_header Pragma "no-cache" always;
add_header Expires "0" always;
EOF
    nginx -t
  fi
}

configure_nginx_site() {
  if command -v nginx >/dev/null 2>&1; then
    local target=/etc/nginx/sites-available/kore-hotspot
    local candidate
    candidate="$(mktemp)"
    cp -a "$target" "${target}.backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    cat > "$candidate" <<EOF
server {
    listen 80 default_server;
    listen 8080 default_server;
    server_name ${DOMAIN:-_};
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
    if [ -n "$DOMAIN" ] && [ -s "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] && [ -s "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]; then
      # Porta 80 sempre deve levar ao HTTPS; 8080 permanece disponivel para diagnostico.
      sed -i 's/    listen 80 default_server;//' "$candidate"
      cat >> "$candidate" <<EOF

server {
    listen 80 default_server;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
EOF
      cat >> "$candidate" <<EOF

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};
    root ${WEB_DIR};
    index index.html;

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

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
    fi
    cp "$candidate" "$target"
    rm -f "$candidate"
    rm -f /etc/nginx/sites-enabled/default
    ln -sf "$target" /etc/nginx/sites-enabled/kore-hotspot
    if ! nginx -t; then
      latest_backup="$(find /etc/nginx/sites-available -maxdepth 1 -name 'kore-hotspot.backup.*' -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)"
      [ -n "$latest_backup" ] && cp "$latest_backup" "$target"
      nginx -t
      fail "Nova configuracao Nginx rejeitada; configuracao anterior restaurada."
    fi
  fi
}

repair_ssl() {
  [ -n "$DOMAIN" ] || return 0
  if [ ! -s "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] || [ ! -s "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]; then
    log "Certificado de ${DOMAIN} ausente; solicitando novamente ao Let's Encrypt"
    systemctl reload nginx || systemctl restart nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
  fi
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  certbot renew --quiet || log "Aviso: renovacao SSL pendente; o certificado atual foi preservado."
  configure_nginx_site
}

configure_api_environment() {
  mkdir -p /etc/systemd/system/kore-vpn-api.service.d
  cat > /etc/systemd/system/kore-vpn-api.service.d/20-kore-env.conf <<EOF
[Service]
Environment=KORE_WEB_DIR=${WEB_DIR}
Environment=KORE_CERTBOT_EMAIL=${CERTBOT_EMAIL:-admin@spedynet.com.br}
Environment=KORE_PUBLIC_HOST=${PUBLIC_HOST}
Environment=KORE_SAAS_MP_ACCESS_TOKEN=${KORE_SAAS_MP_ACCESS_TOKEN}
EOF
}

restart_services() {
  systemctl daemon-reload
  systemctl restart kore-vpn-api
  systemctl reload nginx || systemctl restart nginx
}

verify_or_rollback() {
  local _
  for _ in $(seq 1 15); do
    if curl -fsS --max-time 3 http://127.0.0.1:8081/health | jq -e '.ok == true' >/dev/null 2>&1; then
      API_DIR="$API_DIR" WEB_DIR="$WEB_DIR" /usr/local/bin/kore-hotspot-doctor
      rm -f "$API_DIR/server.js.rollback"
      return 0
    fi
    sleep 2
  done
  log "Nova API falhou no health check; restaurando versao anterior"
  if [ -f "$API_DIR/server.js.rollback" ]; then
    cp "$API_DIR/server.js.rollback" "$API_DIR/server.js"
    if [ -d "${WEB_DIR}.old" ]; then rm -rf "$WEB_DIR"; mv "${WEB_DIR}.old" "$WEB_DIR"; fi
    systemctl restart kore-vpn-api
  fi
  fail "Atualizacao revertida porque a nova versao nao iniciou corretamente."
}

main() {
  log "Iniciando atualizacao ${SCRIPT_VERSION}"
  load_install_config
  backup_data
  detect_public_host
  install_vpn_packages
  prepare_source
  install_updater_binary
  build_and_install
  migrate_public_endpoints
  install_vpn_diagnostics
  configure_l2tp_base
  configure_nginx_site
  repair_ssl
  configure_nginx_no_cache
  configure_api_environment
  restart_services
  verify_or_rollback
  log "Atualizacao concluida"
}

main "$@"
