#!/usr/bin/env bash
set -uo pipefail

API_DIR="${API_DIR:-/opt/kore-hotspot-vpn-api}"
WEB_DIR="${WEB_DIR:-/opt/kore-hotspot}"
API_PORT="${API_PORT:-8082}"
failures=0
warnings=0

ok() { printf '[OK] %s\n' "$*"; }
fail() { printf '[FALHA] %s\n' "$*" >&2; failures=$((failures + 1)); }
warn() { printf '[AVISO] %s\n' "$*" >&2; warnings=$((warnings + 1)); }
check_service() { if systemctl is-active --quiet "$1"; then ok "Servico $1 ativo"; else fail "Servico $1 inativo"; fi; }

echo '=== Diagnostico Kore-HotSpot ==='
check_service kore-vpn-api
check_service nginx
check_service freeradius
if curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/health" | jq -e '.ok == true' >/dev/null; then ok 'API respondeu ao health check'; else fail 'API nao respondeu corretamente em /health'; fi
if ss -lntH "sport = :${API_PORT}" 2>/dev/null | awk '{print $4}' | grep -Eq '^127\.0\.0\.1:'; then ok 'API interna restrita ao loopback'; else fail 'API interna nao esta restrita ao loopback'; fi
if curl -fsS --max-time 5 http://127.0.0.1:8081/public/hotspot-login.html >/dev/null; then ok 'Entrada publica do captive ativa na porta 8081'; else fail 'Entrada publica do captive indisponivel na porta 8081'; fi
public_health_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8081/health || true)"
if [ "$public_health_status" = "404" ]; then ok 'API administrativa bloqueada na porta publica 8081'; else fail "Porta publica 8081 expos rota indevida (HTTP ${public_health_status})"; fi
if nginx -t >/dev/null 2>&1; then ok 'Configuracao do Nginx valida'; else fail 'Configuracao do Nginx invalida'; fi
if node --check "${API_DIR}/server.js" >/dev/null 2>&1; then ok 'Sintaxe da API valida'; else fail 'Sintaxe da API invalida'; fi
if [ -s "${WEB_DIR}/index.html" ]; then ok 'Frontend instalado'; else fail 'Frontend ausente'; fi
if systemctl show kore-vpn-api -p Environment --value 2>/dev/null | tr ' ' '\n' | grep -q '^KORE_ADMIN_PASSWORD='; then fail 'Senha bootstrap do administrador ainda esta no ambiente do servico'; else ok 'Senha bootstrap removida do ambiente do servico'; fi
runtime_config=/etc/kore-hotspot/runtime.env
[ -f "$runtime_config" ] || runtime_config=/etc/kore-hotspot/update.env
if [ -f "$runtime_config" ] && [ "$(stat -c '%a' "$runtime_config")" = 600 ]; then ok 'Configuracao de runtime protegida'; else fail 'Configuracao de runtime ausente ou com permissao diferente de 600'; fi

if [ -d "${API_DIR}/data" ]; then
  invalid_json=0
  while IFS= read -r -d '' file; do jq empty "$file" >/dev/null 2>&1 || { fail "JSON invalido: $file"; invalid_json=1; }; done < <(find "${API_DIR}/data" -type f -name '*.json' -print0)
  [ "$invalid_json" -eq 1 ] || ok 'Arquivos do banco JSON validos'
  if [ -w "${API_DIR}/data" ]; then ok 'Banco JSON gravavel'; else fail 'Diretorio do banco sem permissao de escrita'; fi
  insecure_files="$(find "${API_DIR}/data" -type f -perm /077 -print -quit)"
  if [ -z "$insecure_files" ]; then ok 'Arquivos de dados restritos ao proprietario'; else fail 'Existem arquivos de dados acessiveis por grupo ou outros usuarios'; fi
  insecure_dirs="$(find "${API_DIR}/data" -type d -perm /077 -print -quit)"
  if [ -z "$insecure_dirs" ]; then ok 'Diretorios de dados restritos ao proprietario'; else fail 'Existem diretorios de dados acessiveis por grupo ou outros usuarios'; fi
else
  fail 'Diretorio do banco nao existe'
fi

if systemctl is-active --quiet xl2tpd; then ok 'Servidor L2TP ativo'; else warn 'Servidor L2TP inativo; necessario apenas para equipamentos via VPN'; fi
if systemctl is-active --quiet strongswan-starter || systemctl is-active --quiet strongswan; then ok 'Servidor IPsec ativo'; elif command -v ipsec >/dev/null 2>&1 && ipsec status >/dev/null 2>&1; then ok 'Servidor IPsec disponivel'; else warn 'Servidor IPsec inativo; necessario apenas para equipamentos via VPN'; fi
if dpkg-query -W unifi >/dev/null 2>&1; then
  if systemctl is-active --quiet unifi && ss -lntH 'sport = :8080' | grep -q . && ss -lntH 'sport = :8443' | grep -q .; then ok 'Controladora UniFi ativa nas portas 8080 e 8443'; else fail 'Controladora UniFi instalada, mas indisponivel nas portas esperadas'; fi
fi

printf 'Resultado: %d falha(s), %d aviso(s).\n' "$failures" "$warnings"
[ "$failures" -eq 0 ]
