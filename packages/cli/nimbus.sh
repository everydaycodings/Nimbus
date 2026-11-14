#!/usr/bin/env bash
# Nimbus Secrets client in bash. Needs bash, curl, and jq or python3. See CONTRACT.md.
# Usage: nimbus.sh run    [--env E] [--project P] [--path /] -- cmd...
#        nimbus.sh export [--env E] [--project P] [--path /] [--format dotenv|json|yaml]
#        nimbus.sh agent  --out FILE [--on-change CMD] [--interval SECONDS] [--format F] [--once]
#        nimbus.sh ssh cert --project P --principal deploy[,root] [--ttl HOURS] [--key FILE.pub] [--out FILE]
#        nimbus.sh dynamic get NAME [--ttl 1h] [--format env|json|url] [--prefix DB_] | dynamic list | dynamic revoke LEASE_ID
#        nimbus.sh kms encrypt|decrypt|sign|verify --key K [--in FILE | --text S | stdin] [--context S] [--signature SIG] [--out FILE]
#        nimbus.sh kms keys
# Env: NIMBUS_TOKEN (or ~/.config/nimbus/config.json from `nimbus login`), NIMBUS_SERVER, NIMBUS_PROJECT, NIMBUS_ENV.
# ./.nimbus.json (from `nimbus init`) gives project, env, path and server when nothing else does.
set -euo pipefail

die() { echo "nimbus: $1" >&2; exit "${2:-1}"; }
cmd=${1:-}
if [ -n "$cmd" ]; then shift; else die "usage: nimbus.sh run|export|agent|ssh|dynamic|kms [options] (see the top of this file)" 2; fi
project=${NIMBUS_PROJECT:-}; env=${NIMBUS_ENV:-}; path=; fmt=
out=; onchange=; interval=30; once=; principal=; ttl=; key=; prefix=DB_; infile=; text=; has_text=; context=; signature=; server_flag=
pos=()
opt() { # opt NAME VALUE
  case $1 in
    --project) project=$2 ;; --env) env=$2 ;; --path) path=$2 ;; --format) fmt=$2 ;; --server) server_flag=$2 ;;
    --out) out=$2 ;; --on-change) onchange=$2 ;; --interval) interval=$2 ;;
    --principal) principal=$2 ;; --ttl) ttl=$2 ;; --key) key=$2 ;; --prefix) prefix=$2 ;;
    --in) infile=$2 ;; --text) text=$2; has_text=1 ;; --context) context=$2 ;; --signature) signature=$2 ;;
    *) die "unknown option $1" 2 ;;
  esac
}
while [ $# -gt 0 ]; do
  case $1 in
    --) shift; break ;;
    --once) once=1 ;;
    --*=*) opt "${1%%=*}" "${1#*=}" ;;
    --*) [ $# -ge 2 ] || die "$1 needs a value" 2; opt "$1" "$2"; shift ;;
    *) pos+=("$1") ;;
  esac
  shift
done

cfg=${NIMBUS_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/nimbus}/config.json
# Parse JSON: jq if present, else python3.
json() { # json <filter-name> ; reads stdin
  if command -v jq >/dev/null; then
    case $1 in
      pairs) jq -r 'sort_by(.key)[] | [.key, .value] | @json' ;;
      error) jq -r '.error.message // empty' ;;
      unlock) jq -r '.unlockUrl // empty' ;;
      cfgtoken) jq -r '.token // empty' ;;
      cfgserver) jq -r '.server // empty' ;;
      object) jq -S 'map({(.key): .value}) | add // {}' ;;
      yaml) jq -r 'sort_by(.key)[] | "\(.key): \(.value | tojson)"' ;;
    esac
  else
    local py='import sys,json
d=json.load(sys.stdin); k=sys.argv[1]
if k=="pairs":
    [print(json.dumps([s["key"],s["value"]])) for s in sorted(d,key=lambda s:s["key"])]
elif k=="error": print((d.get("error") or {}).get("message",""))
elif k=="unlock": print(d.get("unlockUrl",""))
elif k=="cfgtoken": print(d.get("token",""))
elif k=="cfgserver": print(d.get("server",""))
elif k=="object": print(json.dumps({s["key"]:s["value"] for s in d},indent=2,sort_keys=True))
elif k=="yaml": [print(s["key"]+": "+json.dumps(s["value"],ensure_ascii=False)) for s in sorted(d,key=lambda s:s["key"])]'
    command -v python3 >/dev/null || die "need jq or python3"
    python3 -c "$py" "$1"
  fi
}
cfgval() { [ -f "$cfg" ] && json "$1" <"$cfg" || true; }

# jget FIELD: a top-level field, raw (strings as-is, others as JSON, missing as nothing).
jget() {
  if command -v jq >/dev/null; then jq -r --arg f "$1" '.[$f] // empty | if type == "string" then . else tojson end'
  else python3 -c 'import sys,json
v=json.load(sys.stdin).get(sys.argv[1])
sys.stdout.write("" if v is None else v if isinstance(v,str) else json.dumps(v))' "$1"; fi
}
# jrows ARRAY F1 F2 ...: one tab-separated line per element of .ARRAY.
jrows() {
  local a=$1; shift
  if command -v jq >/dev/null; then jq -r --arg a "$a" '$ARGS.positional as $f | .[$a][] | [.[$f[]] | tostring] | @tsv' --args "$@"
  else python3 -c 'import sys,json
d=json.load(sys.stdin)
for x in d[sys.argv[1]]: print("\t".join(str(x.get(f)) for f in sys.argv[2:]))' "$a" "$@"; fi
}
# jbody s:KEY=VALUE n:KEY=NUMBER a:KEY=v1,v2 ...: a JSON object.
jbody() {
  if command -v jq >/dev/null; then
    jq -nc '$ARGS.positional | map(capture("^(?<t>[sna]):(?<k>[^=]*)=(?<v>.*)$"; "s") | {(.k): (if .t == "n" then (.v | tonumber) elif .t == "a" then (.v | split(",")) else .v end)}) | add // {}' --args "$@"
  else python3 -c 'import sys,json
o={}
for a in sys.argv[1:]:
    t,_,kv=a.partition(":"); k,_,v=kv.partition("=")
    o[k]=float(v) if t=="n" else v.split(",") if t=="a" else v
print(json.dumps(o))' "$@"; fi
}
uri() { if command -v jq >/dev/null; then jq -rn --arg v "$1" '$v | @uri'; else python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; fi; }
# Shell- and dotenv-safe: always double-quoted, \ " $ ` and newlines escaped.
q() { local v=$1; v=${v//\\/\\\\}; v=${v//\"/\\\"}; v=${v//\$/\\\$}; v=${v//\`/\\\`}; v=${v//$'\n'/\\n}; printf '"%s"' "$v"; }
# kv LINE: k and v from one ["key","value"] line of `json pairs`. The x keeps the
# value's trailing newlines, which $(...) would strip.
kv() {
  if command -v jq >/dev/null; then k=$(jq -r '.[0]' <<<"$1"); v=$(jq -j '.[1]' <<<"$1"; printf x)
  else k=$(python3 -c 'import sys,json;print(json.loads(sys.stdin.read())[0])' <<<"$1"); v=$(python3 -c 'import sys,json;sys.stdout.write(json.loads(sys.stdin.read())[1])' <<<"$1"; printf x); fi
  v=${v%x}
}

# .nimbus.json fills what flags and the environment left out.
if [ -f .nimbus.json ]; then
  nj() { jget "$1" <.nimbus.json; }
  [ -n "$project" ] || project=$(nj project)
  [ -n "$env" ] || env=$(nj env)
  [ -n "$path" ] || path=$(nj path)
  [ -n "$server_flag" ] || [ -n "${NIMBUS_SERVER:-}" ] || server_flag=$(nj server)
fi
path=${path:-/}

server=${server_flag:-${NIMBUS_SERVER:-$(cfgval cfgserver)}}
server=${server%/}
# The saved sign-in only goes to the server it came from, never to one a cloned
# repo's .nimbus.json (or a stray --server) points at.
saved=$(cfgval cfgserver)
token=${NIMBUS_TOKEN:-}
if [ -z "$token" ] && [ "${saved%/}" = "$server" ]; then token=$(cfgval cfgtoken); fi
[ -n "$token" ] || die "no token: set NIMBUS_TOKEN or run 'nimbus login'" 4
[ -n "$server" ] || die "no server: set NIMBUS_SERVER" 2

body=$(mktemp); hdrs=$(mktemp); reqf=$(mktemp); trap 'rm -f "$body" "$hdrs" "$reqf"' EXIT
code=
# get_secrets [ETAG]: GET /secrets into $body (headers in $hdrs); sets $code (000: unreachable).
get_secrets() {
  local args=(--get --data-urlencode "path=$path" --data-urlencode "expand=true")
  [ -n "$project" ] && args+=(--data-urlencode "project=$project")
  [ -n "$env" ] && args+=(--data-urlencode "env=$env")
  [ -n "${1:-}" ] && args+=(-H "If-None-Match: $1")
  code=$(curl -sS -o "$body" -D "$hdrs" -w '%{http_code}' -H "Authorization: Bearer $token" "${args[@]}" "${server%/}/api/v1/secrets/secrets") || code=000
}
fail_on() { # fail_on CODE: exits with the CLI's code for an error answer
  case $1 in
    000) die "cannot reach $server" ;;
    423) die "Secrets are locked. Unlock in the web app: $(json unlock <"$body")" 3 ;;
    401) msg=$(json error <"$body"); die "Unauthorized: ${msg%.}. Run \`nimbus login\`." 4 ;;
    *) die "$1: $(json error <"$body")" ;;
  esac
}
# api METHOD PATH [JSON]: a call under /api/v1/secrets into $body; any non-2xx exits.
api() {
  local args=(-X "$1" -H "Authorization: Bearer $token" -H "Accept: application/json")
  if [ $# -ge 3 ]; then printf '%s' "$3" >"$reqf"; args+=(-H "Content-Type: application/json" --data-binary "@$reqf"); fi
  code=$(curl -sS -o "$body" -w '%{http_code}' "${args[@]}" "${server%/}/api/v1/secrets$2") || code=000
  case $code in 2??) ;; *) fail_on "$code" ;; esac
}
pq() { [ -n "$project" ] && printf '%s=%s' "$1" "$(uri "$project")" || true; }

# Values are JSON strings: decoded one pair at a time, then quoted with q.
dotenv() {
  json pairs <"$body" | while IFS= read -r line; do kv "$line"; printf '%s=%s\n' "$k" "$(q "$v")"; done
}
render() {
  case ${fmt:-dotenv} in
    json) json object <"$body" ;;
    yaml) json yaml <"$body" ;;
    dotenv) dotenv ;;
    *) die "format must be dotenv, json or yaml" 2 ;;
  esac
}

# Polls with If-None-Match; on a change writes $out atomically (0600) and runs --on-change.
agent() {
  [ -n "$out" ] || die "--out FILE is required" 2
  local etag='' tmp
  mkdir -p "$(dirname "$out")"
  while :; do
    get_secrets "$etag"
    case $code in
      200)
        etag=$(sed -n 's/^[Ee][Tt][Aa][Gg]: *//p' "$hdrs" | tr -d '\r' | head -n 1)
        # mktemp: a fresh 0600 file, never a planted symlink.
        tmp=$(mktemp "$out.XXXXXX")
        render >"$tmp"
        if [ -f "$out" ] && cmp -s "$tmp" "$out"; then rm -f "$tmp"
        else
          mv -f "$tmp" "$out"
          echo "nimbus: wrote $out" >&2
          if [ -n "$onchange" ]; then NIMBUS_OUT=$out sh -c "$onchange" || true; fi
        fi ;;
      304) ;;
      401) fail_on 401 ;;
      # Locked or unreachable: retried, unless --once never got a first copy.
      *) if [ -n "$once" ] && [ -z "$etag" ]; then fail_on "$code"; fi
         echo "nimbus: $code, retrying in ${interval}s" >&2 ;;
    esac
    [ -z "$once" ] || return 0
    sleep "$interval"
  done
}

ssh_cert() {
  [ "${pos[0]:-}" = cert ] || die "usage: nimbus.sh ssh cert --project P --principal deploy[,root] [--ttl H] [--key FILE.pub] [--out FILE]" 2
  [ -n "$principal" ] || die "Pass --principal user[,user] (the accounts it may log in as)." 2
  [ -n "$project" ] || die "Pass --project." 2
  local args=("s:project=$project" "a:principals=${principal// /}" "n:ttl=${ttl:-1}") keyfile certfile pk
  [ -z "$key" ] || args+=("s:publicKey=$(cat "$key")")
  api POST /ssh/cert "$(jbody "${args[@]}")"
  if [ -n "$key" ]; then keyfile=${key%.pub}; else keyfile=${out:-$HOME/.ssh/nimbus_cert}; fi
  certfile=$keyfile-cert.pub
  mkdir -p "$(dirname "$keyfile")"
  pk=$(jget privateKey <"$body")
  if [ -n "$pk" ]; then tmp=$(mktemp "$keyfile.XXXXXX"); printf '%s\n' "$pk" >"$tmp"; mv -f "$tmp" "$keyfile"; fi
  printf '%s\n' "$(jget certificate <"$body")" >"$certfile"
  chmod 644 "$certfile"
  echo "Certificate valid until $(jget expiresAt <"$body"): $certfile"
  echo "ssh -i $keyfile -o CertificateFile=$certfile ${principal%%,*}@HOST"
}

dynamic() {
  local sub=${pos[0]:-} name=${pos[1]:-} args f v
  case $sub in
    list)
      api GET "/dynamic?$(pq project)"
      jrows connections name engine defaultTtl maxTtl <"$body" | while IFS=$'\t' read -r n e d m; do printf '%s\t%s\tdefault %ss\tmax %ss\n' "$n" "$e" "$d" "$m"; done ;;
    revoke)
      [ -n "$name" ] || die "usage: nimbus.sh dynamic revoke LEASE_ID" 2
      api DELETE "/dynamic?lease=$(uri "$name")&$(pq project)"
      echo "Revoked." >&2 ;;
    get)
      [ -n "$name" ] || die "usage: nimbus.sh dynamic get NAME [--ttl 1h] [--format env|json|url]" 2
      args=("s:connection=$name")
      [ -z "$project" ] || args+=("s:project=$project")
      [ -z "$ttl" ] || args+=("s:ttl=$ttl")
      api POST /dynamic "$(jbody "${args[@]}")"
      case ${fmt:-env} in
        url) jget url <"$body"; echo ;;
        json) if command -v jq >/dev/null; then jq '{leaseId, engine, host, port, database, username, password, url, expiresAt}' <"$body"
              else python3 -c 'import sys,json
d=json.load(sys.stdin); print(json.dumps({k:d.get(k) for k in "leaseId engine host port database username password url expiresAt".split()},indent=2))' <"$body"; fi ;;
        env)
          for f in HOST:host PORT:port NAME:database USER:username PASSWORD:password URL:url LEASE_ID:leaseId EXPIRES_AT:expiresAt; do
            v=$(jget "${f#*:}" <"$body")
            [ -z "$v" ] || printf '%s%s=%s\n' "$prefix" "${f%%:*}" "$(q "$v")"
          done ;;
        *) die "format must be env, json or url" 2 ;;
      esac
      echo "nimbus: lease $(jget leaseId <"$body") ends $(jget expiresAt <"$body")" >&2 ;;
    *) die "usage: nimbus.sh dynamic get NAME | list | revoke LEASE_ID" 2 ;;
  esac
}

kms() {
  local op=${pos[0]:-} b64 rest ct args
  if [ "$op" = keys ]; then
    api GET "/kms/keys?$(pq project)"
    jrows keys name kind latest state <"$body" | while IFS=$'\t' read -r n k l s; do printf '%s\t%s\tv%s\t%s\n' "$n" "$k" "$l" "$s"; done
    return
  fi
  case $op in encrypt|decrypt|sign|verify) ;; *) die "usage: nimbus.sh kms encrypt|decrypt|sign|verify --key K | kms keys" 2 ;; esac
  [ -n "$key" ] || die "Pass --key." 2
  input() { if [ -n "$has_text" ]; then printf '%s' "$text"; elif [ -n "$infile" ]; then cat "$infile"; else cat; fi; }
  args=("s:key=$key")
  [ -z "$project" ] || args+=("s:project=$project")
  [ -z "$context" ] || args+=("s:context=$context")
  [ "$op" != verify ] || args+=("s:signature=$(printf '%s' "$signature" | tr -d '[:space:]')")
  rest=$(jbody "${args[@]}")
  # Data and ciphertext can be up to 1 MB, too big for an argument: spliced in with printf.
  # Both are base64 or nkms:v1:… text, so they need no JSON escaping.
  if [ "$op" = decrypt ]; then
    ct=$(input | tr -d '[:space:]')
    case $ct in *[!A-Za-z0-9:_=+/-]*) die "That isn't a ciphertext from nimbus kms encrypt." 2 ;; esac
    api POST /kms/decrypt "$(printf '{"ciphertext":"%s",%s' "$ct" "${rest#\{}")"
    if [ -n "$out" ]; then (umask 077; jget data <"$body" | base64 -d >"$out"); else jget data <"$body" | base64 -d; fi
    return
  fi
  b64=$(input | base64 | tr -d '\n')
  api POST "/kms/$op" "$(printf '{"data":"%s",%s' "$b64" "${rest#\{}")"
  case $op in
    encrypt) jget ciphertext <"$body"; echo ;;
    sign) jget signature <"$body"; echo ;;
    verify) if [ "$(jget valid <"$body")" = true ]; then echo valid; else echo invalid; exit 1; fi ;;
  esac
}

case $cmd in
  export)
    get_secrets
    [ "$code" = 200 ] || fail_on "$code"
    render ;;
  run)
    [ $# -gt 0 ] || die "usage: nimbus.sh run ... -- cmd" 2
    get_secrets
    [ "$code" = 200 ] || fail_on "$code"
    # exec replaces this shell, so signals and the exit code pass straight through.
    # Values are exported as data (no eval), trailing newlines and all.
    while IFS= read -r line; do kv "$line"; export "$k=$v"; done < <(json pairs <"$body")
    exec "$@" ;;
  agent) agent ;;
  ssh) ssh_cert ;;
  dynamic) dynamic ;;
  kms) kms ;;
  *) die "unknown command $cmd (run, export, agent, ssh, dynamic, kms)" 2 ;;
esac
