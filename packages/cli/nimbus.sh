#!/usr/bin/env bash
# Minimal Nimbus Secrets client: run / export with token auth. Needs bash, curl; jq optional (python3 or node fallback).
# Usage: nimbus.sh run    [--env E] [--project P] [--path /] -- cmd...
#        nimbus.sh export [--env E] [--project P] [--path /] [--format dotenv|json]
# Env: NIMBUS_TOKEN (or ~/.config/nimbus/config.json from `nimbus login`), NIMBUS_SERVER, NIMBUS_PROJECT, NIMBUS_ENV
set -euo pipefail

die() { echo "nimbus: $*" >&2; exit "${2:-1}"; }
cmd=${1:-}; [ -n "$cmd" ] && shift || die "usage: nimbus.sh run|export [--env E] [--project P] [--path /] [--format F] [-- cmd...]" 2
project=${NIMBUS_PROJECT:-}; env=${NIMBUS_ENV:-}; path=/; fmt=dotenv
while [ $# -gt 0 ]; do
  case $1 in
    --project=*) project=${1#*=} ;; --env=*) env=${1#*=} ;; --path=*) path=${1#*=} ;; --format=*) fmt=${1#*=} ;;
    --project) project=$2; shift ;; --env) env=$2; shift ;; --path) path=$2; shift ;; --format) fmt=$2; shift ;;
    --) shift; break ;;
    *) die "unknown option $1" 2 ;;
  esac
  shift
done

cfg=${NIMBUS_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/nimbus}/config.json
# Parse JSON: jq if present, else python3, else node.
json() { # json <filter-name> ; reads stdin
  if command -v jq >/dev/null; then
    case $1 in
      pairs) jq -r '.[] | [.key, .value] | @json' ;;
      error) jq -r '.error.message // empty' ;;
      unlock) jq -r '.unlockUrl // empty' ;;
      cfgtoken) jq -r '.token // empty' ;;
      cfgserver) jq -r '.server // empty' ;;
      object) jq -S 'map({(.key): .value}) | add // {}' ;;
    esac
  else
    local py='import sys,json
d=json.load(sys.stdin); k=sys.argv[1]
if k=="pairs":
    [print(json.dumps([s["key"],s["value"]])) for s in d]
elif k=="error": print((d.get("error") or {}).get("message",""))
elif k=="unlock": print(d.get("unlockUrl",""))
elif k=="cfgtoken": print(d.get("token",""))
elif k=="cfgserver": print(d.get("server",""))
elif k=="object": print(json.dumps({s["key"]:s["value"] for s in d},indent=2,sort_keys=True))'
    command -v python3 >/dev/null || die "need jq or python3"
    python3 -c "$py" "$1"
  fi
}
cfgval() { [ -f "$cfg" ] && json "$1" <"$cfg" || true; }

token=${NIMBUS_TOKEN:-$(cfgval cfgtoken)}
server=${NIMBUS_SERVER:-$(cfgval cfgserver)}
[ -n "$token" ] || die "no token: set NIMBUS_TOKEN or run 'nimbus login'" 4
[ -n "$server" ] || die "no server: set NIMBUS_SERVER" 2

body=$(mktemp); trap 'rm -f "$body"' EXIT
args=(--get --data-urlencode "path=$path" --data-urlencode "expand=true")
[ -n "$project" ] && args+=(--data-urlencode "project=$project")
[ -n "$env" ] && args+=(--data-urlencode "env=$env")
code=$(curl -sS -o "$body" -w '%{http_code}' -H "Authorization: Bearer $token" "${args[@]}" "${server%/}/api/v1/secrets/secrets") || die "cannot reach $server"
case $code in
  200) ;;
  423) die "Secrets are locked. Unlock in the web app: $(json unlock <"$body")" 3 ;;
  401) die "unauthorized: $(json error <"$body")" 4 ;;
  *) die "$code: $(json error <"$body")" ;;
esac

# Values are JSON strings: decode to bash with jq/python for run, and quote for dotenv.
dotenv() {
  json pairs <"$body" | while IFS= read -r line; do
    python3 -c 'import sys,json
k,v=json.loads(sys.stdin.read()); print(k+"=\""+v.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"")' <<<"$line" 2>/dev/null ||
      jq -r '"\(.[0])=\"" + (.[1] | gsub("\\\\";"\\\\\\\\") | gsub("\"";"\\\"") | gsub("\n";"\\n")) + "\""' <<<"$line"
  done
}

case $cmd in
  export)
    case $fmt in
      json) json object <"$body" ;;
      dotenv) dotenv ;;
      *) die "format must be dotenv or json" 2 ;;
    esac ;;
  run)
    [ $# -gt 0 ] || die "usage: nimbus.sh run ... -- cmd" 2
    # exec replaces this shell, so signals and the exit code pass straight through.
    # Each pair is exported via `printf %q`-safe eval of a single decoded value.
    while IFS= read -r line; do
      if command -v jq >/dev/null; then k=$(jq -r '.[0]' <<<"$line"); v=$(jq -r '.[1]' <<<"$line")
      else k=$(python3 -c 'import sys,json;print(json.loads(sys.stdin.read())[0])' <<<"$line"); v=$(python3 -c 'import sys,json;sys.stdout.write(json.loads(sys.stdin.read())[1])' <<<"$line"); fi
      export "$k=$v"
    done < <(json pairs <"$body")
    exec "$@" ;;
  *) die "unknown command $cmd (run, export)" 2 ;;
esac
