#!/usr/bin/env bash
set -uo pipefail

API_DIR="${API_DIR:-/opt/kore-hotspot-vpn-api}"
WEB_DIR="${WEB_DIR:-/opt/kore-hotspot}"
API_PORT="${API_PORT:-8081}"
failures=0
warnings=0

ok() { printf '[OK] %s\n' "$*"; }
fail() { printf '[FALHA] %s\n' "$*" >&2; failures=$((failures + 1)); }
warn() { printf '[AVISO] %s\n' "$*" >&2; warnings=$((warnings + 1)); }
check_service() { if systemctl is-active --quiet "$1"; then ok "Servico $1 ativo"; else fail "Servico $1 inativo"; fi; }

echo '=== Diagnostico Kore-HotSpot ==='
check_service kore-vpn-api
check_service nginx
if curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/health" | jq -e '.ok == true' >/dev/null; then ok 'API respondeu ao health check'; else fail 'API nao respondeu corretamente em /health'; fi
if nginx -t >/dev/null 2>&1; then ok 'Configuracao do Nginx valida'; else fail 'Configuracao do Nginx invalida'; fi
if node --check "${API_DIR}/server.js" >/dev/null 2>&1; then ok 'Sintaxe da API valida'; else fail 'Sintaxe da API invalida'; fi
if [ -s "${WEB_DIR}/index.html" ]; then ok 'Frontend instalado'; else fail 'Frontend ausente'; fi

if [ -d "${API_DIR}/data" ]; then
  invalid_json=0
  while IFS= read -r -d '' file; do jq empty "$file" >/dev/null 2>&1 || { fail "JSON invalido: $file"; invalid_json=1; }; done < <(find "${API_DIR}/data" -type f -name '*.json' -print0)
  [ "$invalid_json" -eq 1 ] || ok 'Arquivos do banco JSON validos'
  if [ -w "${API_DIR}/data" ]; then ok 'Banco JSON gravavel'; else fail 'Diretorio do banco sem permissao de escrita'; fi
else
  fail 'Diretorio do banco nao existe'
fi

if systemctl is-active --quiet xl2tpd; then ok 'Servidor L2TP ativo'; else warn 'Servidor L2TP inativo; necessario apenas para equipamentos via VPN'; fi
if systemctl is-active --quiet strongswan-starter || systemctl is-active --quiet strongswan; then ok 'Servidor IPsec ativo'; elif command -v ipsec >/dev/null 2>&1 && ipsec status >/dev/null 2>&1; then ok 'Servidor IPsec disponivel'; else warn 'Servidor IPsec inativo; necessario apenas para equipamentos via VPN'; fi

printf 'Resultado: %d falha(s), %d aviso(s).\n' "$failures" "$warnings"
[ "$failures" -eq 0 ]
