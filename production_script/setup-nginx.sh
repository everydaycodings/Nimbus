#!/usr/bin/env bash
# Puts nginx in front of Nimbus with Let's Encrypt certificates, on Debian/Ubuntu.
# Reads DOMAIN, S3_DOMAIN (empty when you use your own S3), CERTBOT_EMAIL and
# COMPOSE_PROFILES ("push" adds ntfy.DOMAIN) from .env at the repo root.
# Already set up and working? It checks and changes nothing.
# Run as root once DNS points here: sudo ./setup-nginx.sh
set -euo pipefail
cd "$(dirname "$0")"

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0" >&2; exit 1; }
[ -f ../.env ] || { echo "No .env at the repo root. Run ./setup.sh first." >&2; exit 1; }

env_value() { sed -n "s/^$1=['\"]\{0,1\}\([^ #'\"]*\).*/\1/p" ../.env | tail -n1; }
export DOMAIN="$(env_value DOMAIN)" S3_DOMAIN="$(env_value S3_DOMAIN)"
EMAIL="$(env_value CERTBOT_EMAIL)"
[ "$EMAIL" = you@example.com ] && EMAIL=""
[ -n "$DOMAIN" ] || { echo "DOMAIN is empty in .env." >&2; exit 1; }
[ -n "$EMAIL" ] || { echo "CERTBOT_EMAIL is empty in .env." >&2; exit 1; }

names=("$DOMAIN")
[ -n "$S3_DOMAIN" ] && names+=("$S3_DOMAIN")
export NTFY_DOMAIN=""
[[ ",$(env_value COMPOSE_PROFILES)," == *",push,"* ]] && NTFY_DOMAIN="ntfy.$DOMAIN" && names+=("$NTFY_DOMAIN")
site=/etc/nginx/sites-available/nimbus
cert=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
realip=/etc/nginx/snippets/nimbus-realip.conf

# The visitor's IP. Behind Cloudflare or another proxy, $remote_addr is the proxy, so nginx
# takes the address from X-Forwarded-For, but only when the connection comes from a trusted
# proxy: a visitor connecting directly can't fake it. Skipped trusted entries are walked from
# the right (real_ip_recursive). The app reads X-Real-IP, which is $remote_addr.
cidrs() { grep -E '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$' || true; }
write_realip() {
  local cf="" own
  if [ "$(env_value TRUST_CLOUDFLARE)" != 0 ]; then
    cf=$( { curl -fsS --max-time 10 https://www.cloudflare.com/ips-v4; echo
      curl -fsS --max-time 10 https://www.cloudflare.com/ips-v6; } 2>/dev/null | cidrs)
    [ "$(printf '%s\n' "$cf" | grep -c .)" -ge 10 ] || cf=$(cidrs < nginx/cloudflare-ips.txt)
  fi
  own=$(env_value TRUSTED_PROXIES | tr ',' '\n' | cidrs)
  mkdir -p "$(dirname "$realip")"
  {
    echo "# Written by setup-nginx.sh: proxies trusted to name the visitor's IP. Re-run it to refresh."
    echo "real_ip_header X-Forwarded-For;"
    echo "real_ip_recursive on;"
    printf '%s\n' "$cf" "$own" | grep . | sed 's/.*/set_real_ip_from &;/' || true
  } > "$realip.new"
  if cmp -s "$realip.new" "$realip"; then rm "$realip.new"; return 1; fi
  mv "$realip.new" "$realip"
}
realip_changed=no
write_realip && realip_changed=yes

# HTTPS answers through this nginx for every name, with a certificate that
# covers it and is good for another day.
working() {
  [ -f "$cert" ] && openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null || return 1
  # Sites set up before the trusted-proxy file don't include it.
  grep -q nimbus-realip "$site" || return 1
  local d path code
  for d in "${names[@]}"; do
    openssl x509 -in "$cert" -noout -ext subjectAltName | grep -q "DNS:$d\b" || return 1
    path=/sign-in
    [ "$d" = "$S3_DOMAIN" ] && path=/minio/health/live
    [ "$d" = "$NTFY_DOMAIN" ] && path=/v1/health
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
      --resolve "$d:443:127.0.0.1" "https://$d$path" || true)
    [[ "$code" =~ ^[23] ]] || return 1
  done
  # Sites set up before WebDAV have no /dav block.
  curl -s -o /dev/null -D - -X OPTIONS --max-time 10 \
    --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/dav/" | grep -qi '^dav:' || return 1
  # ...and sites set up before the SSH terminal have no /ssh-ws block (the sidecar answers a plain GET with 426).
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/ssh-ws" || true)
  [ "$code" = 426 ]
}

if command -v nginx >/dev/null && [ -f "$site" ] && working; then
  if [ "$realip_changed" = yes ]; then
    nginx -t && systemctl reload nginx
    echo "nginx already serves ${names[*]} over HTTPS. Updated the trusted proxy list."
  else
    echo "nginx already serves ${names[*]} over HTTPS. Nothing to do."
  fi
  exit 0
fi

# Another site claiming one of these names would clash with ours.
if [ -d /etc/nginx/sites-enabled ]; then
  for d in "${names[@]}"; do
    other=$(grep -lE "server_name[^;]*[[:space:]]$d[[:space:];]" /etc/nginx/sites-enabled/* 2>/dev/null |
      grep -v '/nimbus$' || true)
    if [ -n "$other" ]; then
      echo "$d is already in another nginx site: $other" >&2
      echo "Remove it from there (or remove that site), then run this again." >&2
      exit 1
    fi
  done
fi

if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null || ! command -v envsubst >/dev/null ||
  ! dpkg -s python3-certbot-nginx >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx certbot python3-certbot-nginx gettext-base
fi

{
  envsubst '${DOMAIN}' < nginx/nimbus.conf.template
  [ -n "$S3_DOMAIN" ] && envsubst '${S3_DOMAIN}' < nginx/nimbus-s3.conf.template
  [ -n "$NTFY_DOMAIN" ] && envsubst '${NTFY_DOMAIN}' < nginx/nimbus-ntfy.conf.template
} > "$site"
ln -sf "$site" /etc/nginx/sites-enabled/nimbus
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

domains=()
for d in "${names[@]}"; do domains+=(-d "$d"); done
# Reuses a still-valid certificate instead of asking for a new one.
certbot --nginx --non-interactive --agree-tos --redirect --keep-until-expiring --expand \
  --cert-name "$DOMAIN" -m "$EMAIL" "${domains[@]}"

if working; then
  echo "nginx is serving ${names[*]/#/https://}"
else
  echo "nginx is set up, but HTTPS doesn't answer yet. Check: docker compose ps, and nginx's error log." >&2
  exit 1
fi
