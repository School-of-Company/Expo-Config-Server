#!/usr/bin/env bash
# Generates an RS256 key pair and stores it in Vault:
#   private key -> secret/<AUTH_SERVICE>    as {"jwt": {"privateKey": "<PKCS#8 PEM>"}}
#   public key  -> secret/<GATEWAY_SERVICE> as {"jwt": {"publicKey": "<SPKI PEM>"}}
# Other keys already stored under those paths are preserved (KV v2 merge-patch).
# Services only read config at boot, so restart both after running this.
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
: "${VAULT_TOKEN:?VAULT_TOKEN must be set}"
AUTH_SERVICE="${AUTH_SERVICE:-auth}"
GATEWAY_SERVICE="${GATEWAY_SERVICE:-gateway}"
KEY_BITS="${KEY_BITS:-2048}"

for cmd in openssl curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "missing required command: $cmd" >&2; exit 1; }
done

umask 077
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

printf 'X-Vault-Token: %s\n' "$VAULT_TOKEN" > "$workdir/headers"

openssl genpkey -algorithm RSA -pkeyopt "rsa_keygen_bits:${KEY_BITS}" -out "$workdir/private.pem" 2>/dev/null
openssl pkey -in "$workdir/private.pem" -pubout -out "$workdir/public.pem"

write_secret() {
  local service="$1" key="$2" pem_file="$3"
  local url="${VAULT_ADDR%/}/v1/secret/data/${service}"

  python3 - "$key" "$pem_file" > "$workdir/payload.json" <<'PY'
import json
import sys

key, pem_file = sys.argv[1], sys.argv[2]
with open(pem_file) as f:
    print(json.dumps({"data": {"jwt": {key: f.read()}}}))
PY

  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH \
    -H "@${workdir}/headers" -H 'Content-Type: application/merge-patch+json' \
    --data "@${workdir}/payload.json" "$url")"
  if [ "$status" = "404" ]; then
    status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
      -H "@${workdir}/headers" --data "@${workdir}/payload.json" "$url")"
  fi

  case "$status" in
    200|204) echo "wrote jwt.${key} to secret/${service}" ;;
    *)
      echo "failed to write secret/${service} (HTTP ${status}). Rerun the script to write a fresh, matching pair." >&2
      exit 1
      ;;
  esac
}

write_secret "$GATEWAY_SERVICE" publicKey "$workdir/public.pem"
write_secret "$AUTH_SERVICE" privateKey "$workdir/private.pem"

fingerprint="$(openssl pkey -pubin -in "$workdir/public.pem" -outform DER | openssl dgst -sha256 | awk '{print $NF}')"
echo "public key sha256 fingerprint: ${fingerprint:0:16}"
echo "Restart ${AUTH_SERVICE} and ${GATEWAY_SERVICE} so they pick up the new pair."
