#!/usr/bin/env bash
# Puts nginx in front of Nimbus with Let's Encrypt certificates, on Debian/Ubuntu.
# Reads DOMAIN, S3_DOMAIN and CERTBOT_EMAIL from .env at the repo root.
# Run as root once DNS for both names points here: sudo ./setup-nginx.sh
set -euo pipefail
cd "$(dirname "$0")"

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0" >&2; exit 1; }
[ -f ../.env ] || { echo "No .env at the repo root. Copy production_script/.env.example to .env and fill it in." >&2; exit 1; }

env_value() { sed -n "s/^$1=\([^ #]*\).*/\1/p" ../.env | tail -n1; }
export DOMAIN="$(env_value DOMAIN)" S3_DOMAIN="$(env_value S3_DOMAIN)"
EMAIL="$(env_value CERTBOT_EMAIL)"
[ "$EMAIL" = you@example.com ] && EMAIL=""
for v in DOMAIN S3_DOMAIN EMAIL; do
  [ -n "${!v}" ] || { echo "$v is empty in .env (CERTBOT_EMAIL for EMAIL)." >&2; exit 1; }
done

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx gettext-base

envsubst '${DOMAIN} ${S3_DOMAIN}' < nginx/nimbus.conf.template > /etc/nginx/sites-available/nimbus
ln -sf /etc/nginx/sites-available/nimbus /etc/nginx/sites-enabled/nimbus
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN" -d "$S3_DOMAIN"

echo "nginx is serving https://$DOMAIN and https://$S3_DOMAIN"
