#!/usr/bin/env bash
# Puts nginx in front of Nimbus with Let's Encrypt certificates, on Debian/Ubuntu.
# Reads DOMAIN, S3_DOMAIN (empty when you use your own S3) and CERTBOT_EMAIL from
# .env at the repo root. Already set up and working? It checks and changes nothing.
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
site=/etc/nginx/sites-available/nimbus
cert=/etc/letsencrypt/live/$DOMAIN/fullchain.pem

# HTTPS answers through this nginx for every name, with a certificate that
# covers it and is good for another day.
working() {
  [ -f "$cert" ] && openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null || return 1
  local d path code
  for d in "${names[@]}"; do
    openssl x509 -in "$cert" -noout -ext subjectAltName | grep -q "DNS:$d\b" || return 1
    path=/sign-in
    [ "$d" = "$S3_DOMAIN" ] && path=/minio/health/live
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
      --resolve "$d:443:127.0.0.1" "https://$d$path" || true)
    [[ "$code" =~ ^[23] ]] || return 1
  done
}

if command -v nginx >/dev/null && [ -f "$site" ] && working; then
  echo "nginx already serves ${names[*]} over HTTPS. Nothing to do."
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
