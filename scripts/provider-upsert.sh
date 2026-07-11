#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${API_URL:-http://127.0.0.1:8081}"
SERVICE="${SERVICE:-kore-vpn-api}"

TOKEN="${API_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v systemctl >/dev/null 2>&1; then
  TOKEN="$(systemctl show "$SERVICE" -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^KORE_VPN_API_TOKEN=//p' | tail -n1)"
fi
TOKEN="${TOKEN:-kore-vpn-api-2026}"

NAME="${NAME:-${1:-}}"
TENANT_ID="${TENANT_ID:-${2:-}}"
DOMAIN="${DOMAIN:-${3:-}}"
CONTACT_NAME="${CONTACT_NAME:-${4:-}}"
CONTACT_EMAIL="${CONTACT_EMAIL:-${5:-}}"
CONTACT_PHONE="${CONTACT_PHONE:-${6:-}}"
COMMERCIAL_PLAN="${COMMERCIAL_PLAN:-${7:-enterprise}}"
STATUS="${STATUS:-active}"
CONTRACT_DUE_DATE="${CONTRACT_DUE_DATE:-$(date +%F)}"
LAST_PAYMENT_DATE="${LAST_PAYMENT_DATE:-$(date +%F)}"
GRACE_DAYS="${GRACE_DAYS:-5}"
MAX_CLIENTS="${MAX_CLIENTS:-0}"
MAX_MIKROTIKS="${MAX_MIKROTIKS:-0}"

usage() {
  cat <<'EOF'
Uso:
  NAME="Voxion" TENANT_ID="voxion" DOMAIN="kore-wifi.spedynet.com.br" \
  CONTACT_NAME="Eder" CONTACT_EMAIL="ederdreger@icloud.com" CONTACT_PHONE="1143083133" \
  COMMERCIAL_PLAN="enterprise" sudo -E kore-provider-upsert

Ou:
  sudo kore-provider-upsert "Voxion" "voxion" "kore-wifi.spedynet.com.br" "Eder" "ederdreger@icloud.com" "1143083133" "enterprise"

Planos comerciais:
  starter, professional, enterprise
EOF
}

if [ -z "$NAME" ]; then
  usage >&2
  exit 2
fi

if [ -z "$TENANT_ID" ]; then
  TENANT_ID="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/https?:\/\///; s/[^a-z0-9_.-]+/-/g; s/^-+|-+$//g' | cut -c1-80)"
fi

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

payload="$(cat <<EOF
{
  "action": "upsert",
  "name": "$(json_escape "$NAME")",
  "tenant_id": "$(json_escape "$TENANT_ID")",
  "domain": "$(json_escape "$DOMAIN")",
  "contact_name": "$(json_escape "$CONTACT_NAME")",
  "contact_email": "$(json_escape "$CONTACT_EMAIL")",
  "contact_phone": "$(json_escape "$CONTACT_PHONE")",
  "commercial_plan": "$(json_escape "$COMMERCIAL_PLAN")",
  "status": "$(json_escape "$STATUS")",
  "contract_due_date": "$(json_escape "$CONTRACT_DUE_DATE")",
  "last_payment_date": "$(json_escape "$LAST_PAYMENT_DATE")",
  "grace_days": ${GRACE_DAYS},
  "max_clients": ${MAX_CLIENTS},
  "max_mikrotiks": ${MAX_MIKROTIKS},
  "block_on_overdue": true
}
EOF
)"

response="$(curl -fsS -X PUT "${API_URL%/}/api/providers/${TENANT_ID}" \
  -H "X-Kore-Token: ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$payload")"

printf '%s\n' "$response"
printf '\nProvedor salvo. Conferencia local:\n'
curl -fsS "${API_URL%/}/api/providers" -H "X-Kore-Token: ${TOKEN}" | jq ".providers[] | select(.tenant_id == \"${TENANT_ID}\")"
