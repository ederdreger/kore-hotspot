#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Kore-HotSpot"
REPO_URL="${REPO_URL:-https://github.com/ederdreger/kore-hotspot.git}"
REPO_SLUG="${REPO_SLUG:-ederdreger/kore-hotspot}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/kore-hotspot-src}"
WEB_DIR="${WEB_DIR:-/opt/kore-hotspot}"
API_DIR="${API_DIR:-/opt/kore-hotspot-vpn-api}"
CONFIG_DIR="${CONFIG_DIR:-/etc/kore-hotspot}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
API_TOKEN="${API_TOKEN:-}"
NODE_MAJOR="${NODE_MAJOR:-20}"
AUTO_UPDATE="${AUTO_UPDATE:-true}"

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
VITE_KORE_API_URL=http://${PUBLIC_HOST}:8081
VITE_KORE_API_TOKEN=${API_TOKEN}
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
Environment=KORE_PUBLIC_URL=http://${PUBLIC_HOST}:8080
ExecStart=/usr/bin/node ${API_DIR}/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
}

configure_nginx() {
  log "Configurando Nginx na porta 8080"
  cat > /etc/nginx/sites-available/kore-hotspot <<EOF
server {
    listen 8080;
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
  ln -sf /etc/nginx/sites-available/kore-hotspot /etc/nginx/sites-enabled/kore-hotspot
  nginx -t
}

configure_l2tp_base() {
  log "Preparando pacotes VPN L2TP/IPsec"
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  cat > /etc/sysctl.d/99-kore-hotspot.conf <<EOF
net.ipv4.ip_forward = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.default.send_redirects = 0
EOF
}

install_updater() {
  log "Instalando atualizador por releases"
  mkdir -p "$CONFIG_DIR"
  cp "$INSTALL_DIR/scripts/update.sh" /usr/local/bin/kore-hotspot-update
  chmod +x /usr/local/bin/kore-hotspot-update
  cat > "$CONFIG_DIR/update.env" <<EOF
REPO_URL=${REPO_URL}
REPO_SLUG=${REPO_SLUG}
BRANCH=${BRANCH}
INSTALL_DIR=${INSTALL_DIR}
WEB_DIR=${WEB_DIR}
API_DIR=${API_DIR}
PUBLIC_HOST=${PUBLIC_HOST}
API_TOKEN=${API_TOKEN}
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

Painel:       http://${PUBLIC_HOST}:8080
API:          http://${PUBLIC_HOST}:8081
Token API:    ${API_TOKEN}
Atualizador:  /usr/local/bin/kore-hotspot-update

Usuario inicial do painel:
  E-mail: demo@spedynet.com.br
  Senha:  Admin12345

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
  configure_nginx
  configure_l2tp_base
  install_updater
  start_services
  print_summary
}

main "$@"
