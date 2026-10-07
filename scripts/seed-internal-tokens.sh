#!/usr/bin/env bash
# Stores the service-to-service token (X-Internal-Token) in Vault for every service that
# sends or receives internal calls, using each service's own config key (docs/internal-token.md):
#   secret/<AUTH_SERVICE> -> {"internal": {"token": T}, "clients": {"expo": {"internal-token": T}}}
#   secret/expo           -> {"EXPO_INTERNAL_TOKEN": T, "expo": {"standard": {...}, "training": {...}, "delete-internal-token": T}}
#   secret/apply          -> {"application": {"internal-token": T}}
#   secret/form           -> {"INTERNAL_TOKEN": T, "USER_SERVICE_INTERNAL_TOKEN": T}
# One token per environment, shared by these services (the current code sends one token to several
# receivers). Never written to secret/application or secret/gateway.
# Other keys already stored under those paths are preserved (KV v2 merge-patch).
# Without TOKEN_FILE a new random token is generated (rotation). With TOKEN_FILE the token in that
# file is stored as-is (e.g. moving a token services already use into Vault, or re-running after a
# partial failure). The token is never printed; only a SHA-256 fingerprint is.
# Services only read config at boot, so restart them after running this.
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
: "${VAULT_TOKEN:?VAULT_TOKEN must be set}"
AUTH_SERVICE="${AUTH_SERVICE:-auth}"
EXPO_SERVICE="${EXPO_SERVICE:-expo}"
APPLY_SERVICE="${APPLY_SERVICE:-apply}"
FORM_SERVICE="${FORM_SERVICE:-form}"
TOKEN_FILE="${TOKEN_FILE:-}"
MIN_TOKEN_LENGTH=32

for cmd in openssl curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "missing required command: $cmd" >&2; exit 1; }
done

for service in "$AUTH_SERVICE" "$EXPO_SERVICE" "$APPLY_SERVICE" "$FORM_SERVICE"; do
  case "$service" in
    application|gateway)
      echo "refusing to write the internal token to secret/${service}: it is delivered to services that must not have it" >&2
      exit 1
      ;;
  esac
done

umask 077
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

printf 'X-Vault-Token: %s\n' "$VAULT_TOKEN" > "$workdir/headers"

if [ -n "$TOKEN_FILE" ]; then
  tr -d '\r\n' < "$TOKEN_FILE" > "$workdir/token"
else
  openssl rand -hex 32 | tr -d '\n' > "$workdir/token"
fi

token_length="$(wc -c < "$workdir/token" | tr -d ' ')"
if [ "$token_length" -lt "$MIN_TOKEN_LENGTH" ]; then
  echo "internal token must be at least ${MIN_TOKEN_LENGTH} characters (got ${token_length})" >&2
  exit 1
fi

write_secret() {
  local service="$1" layout="$2"
  local url="${VAULT_ADDR%/}/v1/secret/data/${service}"

  python3 - "$layout" "$workdir/token" > "$workdir/payload.json" <<'PY'
import json
import sys

layout, token_file = sys.argv[1], sys.argv[2]
with open(token_file) as f:
    t = f.read()
layouts = {
    "auth": {"internal": {"token": t}, "clients": {"expo": {"internal-token": t}}},
    "expo": {
        "EXPO_INTERNAL_TOKEN": t,
        "expo": {
            "standard": {"internal-token": t},
            "training": {"internal-token": t},
            "delete-internal-token": t,
        },
    },
    "apply": {"application": {"internal-token": t}},
    "form": {"INTERNAL_TOKEN": t, "USER_SERVICE_INTERNAL_TOKEN": t},
}
print(json.dumps({"data": layouts[layout]}))
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
    200|204) echo "wrote internal token to secret/${service}" ;;
    *)
      echo "failed to write secret/${service} (HTTP ${status}). Rerun with TOKEN_FILE set to the same token to finish." >&2
      if [ -z "$TOKEN_FILE" ]; then
        echo "(the generated token was not saved; rerun without TOKEN_FILE to rotate all four paths again)" >&2
      fi
      exit 1
      ;;
  esac
}

write_secret "$AUTH_SERVICE" auth
write_secret "$EXPO_SERVICE" expo
write_secret "$APPLY_SERVICE" apply
write_secret "$FORM_SERVICE" form

fingerprint="$(openssl dgst -sha256 < "$workdir/token" | awk '{print $NF}')"
echo "internal token sha256 fingerprint: ${fingerprint:0:16}"
echo "Restart ${AUTH_SERVICE}, ${EXPO_SERVICE}, ${APPLY_SERVICE} and ${FORM_SERVICE} so they pick up the token."
