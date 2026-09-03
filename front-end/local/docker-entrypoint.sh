#!/bin/sh
# front-end/docker-entrypoint.sh
#
# Substitutes runtime placeholders in config.js from a .env file (or real
# environment variables, if no .env is present) before nginx starts.
#
# Precedence: real environment variables (e.g. `docker run -e BACKEND_URL=...`,
# an ECS task definition, a Kubernetes Deployment's env:) always win over
# whatever is in .env, so this works the same whether you inject config via
# a mounted .env file in local/dev or via orchestrator-level env vars in
# staging/prod -- you never have to bake secrets into the image.
#
# PORTABILITY NOTES (both bugs below were found by actually running this
# script under dash/busybox ash, not guessed at):
#
#   1. Indirect variable expansion via `eval "current=\${$key:-}"` is a
#      bash-ism that POSIX dash and busybox ash (what nginx:alpine actually
#      runs) can misparse, previously surfacing as "arithmetic syntax
#      error". Fixed by using `printenv "$key"` -- a real command, not a
#      shell-parser construct -- to check whether a variable is already set.
#
#   2. `.env` files commonly have whitespace around "=" (e.g.
#      `BACKEND_URL = "http://backend:8000/"`) or quoted values (e.g.
#      `BACKEND_URL="http://backend:8000/"`). Without trimming, `$key` can
#      end up as "BACKEND_URL " (trailing space), and `export "$key=$value"`
#      then fails with "bad variable name" because busybox's stricter export
#      validation rejects an identifier containing a space. Fixed by
#      trimming whitespace from both key and value, and stripping one layer
#      of surrounding single/double quotes from the value, before exporting.
set -eu

ENV_FILE="${ENV_FILE:-/usr/share/nginx/html/.env}"
CONFIG_JS="${CONFIG_JS:-/usr/share/nginx/html/config.js}"

trim() {
  # Strips leading/trailing spaces and tabs using pure shell parameter
  # expansion (no external process per line).
  t="$1"
  while [ "${t# }" != "$t" ]; do t="${t# }"; done
  while [ "${t#	}" != "$t" ]; do t="${t#	}"; done
  while [ "${t% }" != "$t" ]; do t="${t% }"; done
  while [ "${t%	}" != "$t" ]; do t="${t%	}"; done
  printf '%s' "$t"
}

strip_quotes() {
  # Removes one layer of matching surrounding quotes, e.g. "value" -> value
  # or 'value' -> value. Leaves unquoted or mismatched-quote values as-is.
  t="$1"
  case "$t" in
    \"*\") t="${t#\"}"; t="${t%\"}" ;;
    \'*\') t="${t#\'}"; t="${t%\'}" ;;
  esac
  printf '%s' "$t"
}

if [ -f "$ENV_FILE" ]; then
  echo "docker-entrypoint: loading $ENV_FILE"
  while IFS='=' read -r key value; do
    key=$(trim "$key")
    case "$key" in
      ''|'#'*) continue ;;
    esac
    value=$(trim "$value")
    value=$(strip_quotes "$value")
    # Only set it if not already present in the real environment.
    if [ -z "$(printenv "$key" 2>/dev/null || true)" ]; then
      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

: "${BACKEND_URL:?BACKEND_URL must be set via .env or the environment}"
: "${GITHUB_OAUTH_CLIENT_ID:=}"
: "${GITLAB_OAUTH_CLIENT_ID:=}"

echo "docker-entrypoint: writing config.js (BACKEND_URL=${BACKEND_URL})"

# Plain string replacement (not envsubst) so values containing "$" or other
# shell-special characters in a token/URL are never misinterpreted.
sed_script=$(mktemp)
{
  printf 's|__BACKEND_URL__|%s|g\n' "$(printf '%s' "$BACKEND_URL" | sed 's/[&|\\]/\\&/g')"
  printf 's|__GITHUB_OAUTH_CLIENT_ID__|%s|g\n' "$(printf '%s' "$GITHUB_OAUTH_CLIENT_ID" | sed 's/[&|\\]/\\&/g')"
  printf 's|__GITLAB_OAUTH_CLIENT_ID__|%s|g\n' "$(printf '%s' "$GITLAB_OAUTH_CLIENT_ID" | sed 's/[&|\\]/\\&/g')"
} > "$sed_script"

sed -i -f "$sed_script" "$CONFIG_JS"
rm -f "$sed_script"

exec "$@"
