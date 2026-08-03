#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_HOST="${KORE_PUBLIC_HOST:-}"
INFORM_PORT="${KORE_UNIFI_INFORM_PORT:-8080}"
UI_PORT="${KORE_UNIFI_UI_PORT:-8443}"
UNIFI_VERSION="${KORE_UNIFI_VERSION:-9.4.19}"
MONGO_VERSION="${KORE_UNIFI_MONGO_VERSION:-4.4.31}"

log() { printf '\033[36m[Kore-HotSpot UniFi]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[Kore-HotSpot UniFi] ERRO:\033[0m %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --public-host) PUBLIC_HOST="${2:-}"; shift 2 ;;
    --inform-port) INFORM_PORT="${2:-}"; shift 2 ;;
    --ui-port) UI_PORT="${2:-}"; shift 2 ;;
    *) fail "Parametro desconhecido: $1" ;;
  esac
done

[ "${EUID}" -eq 0 ] || fail "Execute como root."
[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Host publico invalido."
[[ "$INFORM_PORT" =~ ^[0-9]+$ ]] || fail "Porta de inform invalida."
[[ "$UI_PORT" =~ ^[0-9]+$ ]] || fail "Porta da interface invalida."

. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || fail "Instalacao automatica suportada somente no Ubuntu Server."
major="${VERSION_ID%%.*}"
[ "$major" -ge 22 ] || fail "UniFi Network Server requer Ubuntu 22.04 ou superior."
[ "$major" -lt 24 ] || fail "Ubuntu 24.04+ deve usar UniFi OS Server; este instalador nao substitui o metodo oficial novo."

available_kb="$(df -Pk /var | awk 'NR==2 {print $4}')"
[ "$available_kb" -ge 10485760 ] || fail "Sao necessarios pelo menos 10 GB livres em /var."
memory_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
[ "$memory_kb" -ge 1900000 ] || fail "Sao necessarios pelo menos 2 GB de RAM."

nginx_kore_site="/etc/nginx/sites-available/kore-hotspot"
if [ "$INFORM_PORT" = "8080" ] && [ -f "$nginx_kore_site" ] && grep -qE '^[[:space:]]*listen[[:space:]]+8080([[:space:]]+default_server)?;' "$nginx_kore_site"; then
  log "Reservando 8080/tcp para o inform UniFi"
  cp -a "$nginx_kore_site" "${nginx_kore_site}.pre-unifi.$(date +%Y%m%d%H%M%S)"
  sed -i -E 's/^([[:space:]]*listen[[:space:]]+)8080([[:space:]]+default_server)?;/\118082\2;/' "$nginx_kore_site"
  nginx -t || fail "A troca da porta auxiliar do Nginx falhou; o backup foi preservado."
  systemctl reload nginx
fi

if ss -ltnH "sport = :${UI_PORT}" | grep -q . && ! systemctl is-active --quiet unifi; then
  fail "A porta ${UI_PORT}/tcp ja esta em uso por outro servico."
fi
if ss -ltnH "sport = :${INFORM_PORT}" | grep -q . && ! systemctl is-active --quiet unifi; then
  fail "A porta ${INFORM_PORT}/tcp ja esta em uso por outro servico."
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
log "Instalando dependencias oficiais"
if [ -f /etc/apt/sources.list.d/100-ubnt-unifi.list ]; then
  log "Desativando repositorio UniFi legado; esta instalacao usa pacote versionado direto"
  mv -f /etc/apt/sources.list.d/100-ubnt-unifi.list /etc/apt/sources.list.d/100-ubnt-unifi.list.disabled
fi
apt-get update -y
apt-get install -y ca-certificates curl gnupg jq openjdk-17-jre-headless

install -d -m 0755 /usr/share/keyrings
rm -f /etc/apt/sources.list.d/mongodb-org-8.0.list /etc/apt/sources.list.d/kore-mongodb-4.4.list

log "Configurando MongoDB ${MONGO_VERSION}, compativel com CPUs com ou sem AVX"
curl -fsSL https://pgp.mongodb.com/server-4.4.asc | gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-4.4.gpg
cat > /etc/apt/sources.list.d/kore-mongodb-4.4.list <<EOF
deb [arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-4.4.gpg] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse
EOF

# MongoDB 4.4 needs libssl1.1 on Jammy. Use only the signed Ubuntu package.
if ! dpkg-query -W libssl1.1 >/dev/null 2>&1; then
  echo 'deb http://security.ubuntu.com/ubuntu focal-security main' > /etc/apt/sources.list.d/kore-focal-libssl.list
  apt-get update -y
  if ! apt-get install -y libssl1.1; then
    rm -f /etc/apt/sources.list.d/kore-focal-libssl.list
    fail "Nao foi possivel instalar a biblioteca compativel com MongoDB 4.4."
  fi
  rm -f /etc/apt/sources.list.d/kore-focal-libssl.list
fi

apt-get update -y
apt-mark unhold mongodb-org mongodb-org-server mongodb-org-mongos mongodb-org-shell mongodb-org-tools >/dev/null 2>&1 || true
apt-get install -y --allow-downgrades \
  "mongodb-org=${MONGO_VERSION}" \
  "mongodb-org-server=${MONGO_VERSION}" \
  "mongodb-org-mongos=${MONGO_VERSION}" \
  "mongodb-org-shell=${MONGO_VERSION}" \
  "mongodb-org-tools=${MONGO_VERSION}"
apt-mark hold mongodb-org mongodb-org-server mongodb-org-mongos mongodb-org-shell mongodb-org-tools >/dev/null

installed_unifi="$(dpkg-query -W -f='${Version}' unifi 2>/dev/null | sed 's/-.*//' || true)"
if [ -n "$installed_unifi" ] && dpkg --compare-versions "$installed_unifi" gt "$UNIFI_VERSION"; then
  fail "UniFi ${installed_unifi} ja possui uma base mais nova. Restaure um backup compativel antes de instalar ${UNIFI_VERSION}."
fi

unifi_deb="/tmp/unifi-${UNIFI_VERSION}.deb"
curl -fL "https://dl.ui.com/unifi/${UNIFI_VERSION}/unifi_sysvinit_all.deb" -o "$unifi_deb"
apt-get install -y --allow-downgrades "$unifi_deb"
apt-mark hold unifi >/dev/null
systemctl stop unifi || true

properties="/var/lib/unifi/system.properties"
install -d -o unifi -g unifi -m 0750 /var/lib/unifi
[ ! -f "$properties" ] || cp -a "$properties" "${properties}.backup.$(date +%Y%m%d%H%M%S)"
touch "$properties"

set_property() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$properties"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$properties"
  else
    printf '%s=%s\n' "$key" "$value" >> "$properties"
  fi
}

set_property unifi.http.port "$INFORM_PORT"
set_property unifi.https.port "$UI_PORT"
set_property system_ip "$PUBLIC_HOST"
set_property unifi.override_inform_host false
chown unifi:unifi "$properties"
chmod 0640 "$properties"

for rule in \
  "tcp ${INFORM_PORT}" \
  "tcp ${UI_PORT}" \
  "udp 3478" \
  "udp 10001"; do
  protocol="${rule%% *}"
  port="${rule##* }"
  iptables -C INPUT -p "$protocol" --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT -p "$protocol" --dport "$port" -j ACCEPT
done
command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null

systemctl disable --now mongod >/dev/null 2>&1 || true
systemctl enable unifi
systemctl restart unifi
for _ in $(seq 1 60); do
  if ss -ltnH "sport = :${UI_PORT}" | grep -q . && ss -ltnH "sport = :${INFORM_PORT}" | grep -q .; then
    version="$(dpkg-query -W -f='${Version}' unifi 2>/dev/null || true)"
    log "Controladora ativa (versao ${version:-desconhecida})"
    log "Painel: https://${PUBLIC_HOST}:${UI_PORT}"
    log "Inform: http://${PUBLIC_HOST}:${INFORM_PORT}/inform"
    exit 0
  fi
  sleep 3
done

journalctl -u unifi -n 30 --no-pager >&2 || true
fail "A controladora foi instalada, mas nao abriu as portas esperadas."
