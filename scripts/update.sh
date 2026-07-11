#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Kore-HotSpot"
REPO_URL="${REPO_URL:-https://github.com/ederdreger/kore-hotspot.git}"
REPO_SLUG="${REPO_SLUG:-ederdreger/kore-hotspot}"
BRANCH="${BRANCH:-main}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/kore-hotspot-src}"
WEB_DIR="${WEB_DIR:-/opt/kore-hotspot}"
API_DIR="${API_DIR:-/opt/kore-hotspot-vpn-api}"
PUBLIC_HOST="${PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}"
DOMAIN="${DOMAIN:-}"
PUBLIC_URL="${PUBLIC_URL:-}"
API_URL="${API_URL:-}"
API_TOKEN="${API_TOKEN:-kore-vpn-api-2026}"
TENANT_ID="${TENANT_ID:-default}"
MULTI_TENANT="${MULTI_TENANT:-true}"
KORE_SAAS_MP_ACCESS_TOKEN="${KORE_SAAS_MP_ACCESS_TOKEN:-}"
BACKUP_DIR="${BACKUP_DIR:-/opt/kore-hotspot-backups}"

log() { printf '\033[1;36m[%s]\033[0m %s\n' "$APP_NAME" "$*"; }
fail() { printf '\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."

backup_data() {
  mkdir -p "$BACKUP_DIR"
  if [ -d "$API_DIR/data" ]; then
    tar -czf "$BACKUP_DIR/data-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$API_DIR" data keys 2>/dev/null || true
  fi
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

  rm -rf "${WEB_DIR}.new"
  mkdir -p "${WEB_DIR}.new"
  cp -a dist/. "${WEB_DIR}.new/"
  rm -rf "${WEB_DIR}.old"
  [ -d "$WEB_DIR" ] && mv "$WEB_DIR" "${WEB_DIR}.old"
  mv "${WEB_DIR}.new" "$WEB_DIR"

  mkdir -p "$API_DIR/data" "$API_DIR/keys"
  cp "$INSTALL_DIR/server.vps.js" "$API_DIR/server.js"
  if [ -f "$INSTALL_DIR/scripts/provider-upsert.sh" ]; then
    cp "$INSTALL_DIR/scripts/provider-upsert.sh" /usr/local/bin/kore-provider-upsert
    chmod +x /usr/local/bin/kore-provider-upsert
  fi
  chown -R root:root "$WEB_DIR" "$API_DIR"
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
  fi
}

restart_services() {
  systemctl daemon-reload
  systemctl restart kore-vpn-api
  systemctl reload nginx || systemctl restart nginx
}

main() {
  log "Iniciando atualizacao"
  backup_data
  prepare_source
  build_and_install
  configure_nginx_site
  configure_nginx_no_cache
  restart_services
  log "Atualizacao concluida"
}

main "$@"
