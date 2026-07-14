#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_HOST="${KORE_PUBLIC_HOST:-}"
INFORM_PORT="${KORE_UNIFI_INFORM_PORT:-18080}"
UI_PORT="${KORE_UNIFI_UI_PORT:-8443}"

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

if ss -ltnH "sport = :${UI_PORT}" | grep -q . && ! systemctl is-active --quiet unifi; then
  fail "A porta ${UI_PORT}/tcp ja esta em uso por outro servico."
fi
if ss -ltnH "sport = :${INFORM_PORT}" | grep -q . && ! systemctl is-active --quiet unifi; then
  fail "A porta ${INFORM_PORT}/tcp ja esta em uso por outro servico."
fi

export DEBIAN_FRONTEND=noninteractive
log "Instalando dependencias oficiais"
apt-get update -y
apt-get install -y ca-certificates curl gnupg jq

install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pgp.mongodb.com/server-8.0.asc | gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
cat > /etc/apt/sources.list.d/mongodb-org-8.0.list <<EOF
deb [arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/8.0 multiverse
EOF

curl -fsSL https://dl.ui.com/unifi/unifi-repo.gpg -o /usr/share/keyrings/unifi-repo.gpg
cat > /etc/apt/sources.list.d/100-ubnt-unifi.list <<EOF
deb [arch=amd64 signed-by=/usr/share/keyrings/unifi-repo.gpg] https://www.ui.com/downloads/unifi/debian stable ubiquiti
EOF

apt-get update -y
apt-get install -y mongodb-org unifi
systemctl enable --now mongod
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
set_property unifi.override_inform_host true
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

systemctl enable --now unifi
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
