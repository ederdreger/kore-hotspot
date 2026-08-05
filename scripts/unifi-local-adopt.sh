#!/usr/bin/env bash
set -euo pipefail

MAC="${1:-}"
MAC="${MAC,,}"
ACTION="${2:-adopt}"
if [[ ! "$MAC" =~ ^([0-9a-f]{2}:){5}[0-9a-f]{2}$ ]]; then
  echo '{"success":false,"error":"MAC UniFi invalido"}'
  exit 2
fi
if [[ "$ACTION" != adopt && "$ACTION" != forget ]]; then
  echo '{"success":false,"error":"Acao UniFi invalida"}'
  exit 2
fi

exec 9>/run/kore-unifi-adopt.lock
flock -w 30 9 || { echo '{"success":false,"error":"Outra adocao UniFi esta em andamento"}'; exit 3; }

MONGO_PORT="${KORE_UNIFI_MONGO_PORT:-27117}"
UNIFI_URL="${KORE_UNIFI_URL:-https://127.0.0.1:8443}"
WORK_DIR="$(mktemp -d /run/kore-unifi-adopt.XXXXXX)"
chmod 700 "$WORK_DIR"

ADMIN_ID=""
ORIGINAL_HASH=""
PASSWORD_RESTORED=yes

mongo_eval() {
  mongo --quiet --port "$MONGO_PORT" ace --eval "$1"
}

restore_password() {
  if [[ "$PASSWORD_RESTORED" == no && -n "$ADMIN_ID" && -n "$ORIGINAL_HASH" ]]; then
    mongo_eval "db.admin.update({_id:ObjectId('$ADMIN_ID')},{\$set:{x_shadow:'$ORIGINAL_HASH'}});" >/dev/null
    PASSWORD_RESTORED=yes
  fi
}

cleanup() {
  restore_password || true
  rm -f -- "$WORK_DIR/login.json" "$WORK_DIR/login-response.json" "$WORK_DIR/cookies" "$WORK_DIR/adopt-response.json"
  rmdir -- "$WORK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

DEVICE_STATE="$(mongo_eval "var d=db.device.findOne({mac:'$MAC'});print(d&&d.adopted?'adopted':(d?'present':'missing'));")"
PENDING="$(mongo_eval "print(db.config_meta.count({mac:'$MAC'}));")"
if [[ "$ACTION" == adopt && "$DEVICE_STATE" == adopted ]]; then
  echo "{\"success\":true,\"adopted\":true,\"mac\":\"$MAC\",\"already_adopted\":true}"
  exit 0
fi
if [[ "$ACTION" == adopt && "$PENDING" == 0 ]]; then
  echo "{\"success\":false,\"error\":\"AP nao esta pendente na controladora\",\"mac\":\"$MAC\"}"
  exit 4
fi
if [[ "$ACTION" == forget && "$DEVICE_STATE" == missing && "$PENDING" == 0 ]]; then
  echo "{\"success\":true,\"forgotten\":true,\"mac\":\"$MAC\",\"already_absent\":true}"
  exit 0
fi

ADMIN_ID="$(mongo_eval 'var a=db.admin.findOne({});if(a)print(a._id.valueOf());')"
ORIGINAL_HASH="$(mongo_eval "var a=db.admin.findOne({_id:ObjectId('$ADMIN_ID')});if(a)print(a.x_shadow);")"
if [[ -z "$ADMIN_ID" || -z "$ORIGINAL_HASH" ]]; then
  echo '{"success":false,"error":"Administrador local da controladora nao encontrado"}'
  exit 5
fi

TEMP_PASSWORD="$(openssl rand -hex 18)"
TEMP_HASH="$(openssl passwd -6 "$TEMP_PASSWORD")"
mongo_eval "db.admin.update({_id:ObjectId('$ADMIN_ID')},{\$set:{x_shadow:'$TEMP_HASH'}});" >/dev/null
PASSWORD_RESTORED=no

ADMIN_NAME="$(mongo_eval "var a=db.admin.findOne({_id:ObjectId('$ADMIN_ID')});if(a)print(a.name);")"
jq -n --arg username "$ADMIN_NAME" --arg password "$TEMP_PASSWORD" \
  '{username:$username,password:$password,remember:false,strict:true}' > "$WORK_DIR/login.json"

LOGIN_CODE="$(curl -k -sS -c "$WORK_DIR/cookies" -o "$WORK_DIR/login-response.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary @"$WORK_DIR/login.json" "$UNIFI_URL/api/login")"
CSRF="$(awk '$6=="csrf_token"{print $7}' "$WORK_DIR/cookies" | tail -1)"

restore_password
CURRENT_HASH="$(mongo_eval "var a=db.admin.findOne({_id:ObjectId('$ADMIN_ID')});if(a)print(a.x_shadow);")"
if [[ "$CURRENT_HASH" != "$ORIGINAL_HASH" ]]; then
  echo '{"success":false,"error":"A credencial administrativa nao foi restaurada"}'
  exit 6
fi
if [[ "$LOGIN_CODE" != 200 || -z "$CSRF" ]]; then
  echo "{\"success\":false,\"error\":\"Falha ao abrir sessao local na controladora\",\"http_code\":$LOGIN_CODE}"
  exit 7
fi

COMMAND=adopt
[[ "$ACTION" == forget ]] && COMMAND=delete-device
ADOPT_CODE="$(curl -k -sS -b "$WORK_DIR/cookies" -o "$WORK_DIR/adopt-response.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  --data "{\"cmd\":\"$COMMAND\",\"mac\":\"$MAC\"}" "$UNIFI_URL/api/s/default/cmd/devmgr")"
ADOPT_RC="$(jq -r '.meta.rc // "error"' "$WORK_DIR/adopt-response.json" 2>/dev/null || echo error)"
if [[ "$ADOPT_CODE" != 200 || "$ADOPT_RC" != ok ]]; then
  ADOPT_MESSAGE="$(jq -r '.meta.msg // "A controladora recusou a adocao"' "$WORK_DIR/adopt-response.json" 2>/dev/null || echo 'A controladora recusou a adocao')"
  jq -n --arg error "$ADOPT_MESSAGE" --arg mac "$MAC" --argjson http_code "$ADOPT_CODE" \
    '{success:false,error:$error,mac:$mac,http_code:$http_code}'
  exit 8
fi

if [[ "$ACTION" == forget ]]; then
  for _ in $(seq 1 15); do
    DEVICE_STATE="$(mongo_eval "var d=db.device.findOne({mac:'$MAC'});print(d&&d.adopted?'adopted':(d?'present':'missing'));")"
    [[ "$DEVICE_STATE" != adopted ]] && break
    sleep 2
  done
  if [[ "$DEVICE_STATE" == adopted ]]; then
    echo "{\"success\":false,\"error\":\"A controladora ainda mantem o AP adotado\",\"mac\":\"$MAC\"}"
    exit 9
  fi
  echo "{\"success\":true,\"forgotten\":true,\"mac\":\"$MAC\",\"password_restored\":true}"
  exit 0
fi

for _ in $(seq 1 15); do
  DEVICE_STATE="$(mongo_eval "var d=db.device.findOne({mac:'$MAC'});print(d&&d.adopted?'adopted':'waiting');")"
  [[ "$DEVICE_STATE" == adopted ]] && break
  sleep 2
done

if [[ "$DEVICE_STATE" == adopted ]]; then
  echo "{\"success\":true,\"adopted\":true,\"mac\":\"$MAC\",\"password_restored\":true}"
else
  echo "{\"success\":true,\"adopted\":false,\"mac\":\"$MAC\",\"accepted\":true,\"password_restored\":true}"
fi
