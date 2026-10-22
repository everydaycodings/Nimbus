#!/usr/bin/env bash
# Interactive production setup: asks a few questions, writes .env, starts Nimbus
# with Docker Compose, and (if you say so) puts nginx with HTTPS in front.
# Run from anywhere as a user that can use Docker: ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

PORTS=(3400 3401 3402 3403 54340 6340)

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ask VAR "Question" [default]. Answers go into .env single-quoted, so they
# can't contain a single quote.
ask() {
  local answer
  while :; do
    read -rp "$2${3:+ [$3]}: " answer
    [[ "$answer" != *"'"* ]] && break
    warn "Single quotes (') aren't allowed."
  done
  printf -v "$1" '%s' "${answer:-${3:-}}"
}
ask_secret() {
  local answer
  while :; do
    read -rsp "$2: " answer
    echo
    [[ "$answer" != *"'"* ]] && break
    warn "Single quotes (') aren't allowed."
  done
  printf -v "$1" '%s' "$answer"
}
# confirm "Question" y|n  → exit status
confirm() {
  local answer hint="y/N"
  [ "$2" = y ] && hint="Y/n"
  read -rp "$1 [$hint]: " answer
  answer="${answer:-$2}"
  [[ "$answer" =~ ^[Yy] ]]
}
# set_env KEY VALUE: replaces KEY's line in .env.
set_env() {
  KEY="$1" VALUE="$2" awk 'BEGIN { k = ENVIRON["KEY"] "=" }
    index($0, k) == 1 { print k ENVIRON["VALUE"]; next } { print }' .env > .env.tmp
  mv .env.tmp .env
}
# Free text goes in single quotes so compose takes $ and # literally.
quoted() { [ -n "$1" ] && printf "'%s'" "$1" || true; }
valid_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]]; }
env_value() { sed -n "s/^$1=\([^ #]*\).*/\1/p" .env | tail -n1; }

# --- Checks -------------------------------------------------------------------
bold "Nimbus setup"
command -v docker >/dev/null || die "Docker isn't installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 isn't installed (docker compose)."
docker info >/dev/null 2>&1 ||
  die "Can't talk to Docker. Start it, or add yourself to the docker group: sudo usermod -aG docker \$USER (then log in again)."

running=$(docker compose ps -q 2>/dev/null || true)
if [ -z "$running" ] && command -v ss >/dev/null; then
  for p in "${PORTS[@]}"; do
    ss -ltnH "sport = :$p" | grep -q . &&
      die "Port $p is already in use. Change it in docker-compose.yml and production_script/nginx/nimbus.conf.template, then run this again."
  done
fi

# --- Questions ----------------------------------------------------------------
write_env=y
if [ -f .env ]; then
  warn ".env already exists."
  echo "  Keeping it is right if Nimbus has run before: a new .env makes new secrets,"
  echo "  and the existing database won't accept the new password."
  if confirm "Keep the existing .env?" y; then write_env=n; fi
fi

if [ "$write_env" = y ]; then
  bold "Domains"
  echo "You need two DNS A records pointing at this server: one for the app and one"
  echo "for file storage (browsers download files from it directly)."
  while :; do
    ask DOMAIN "App domain, e.g. nimbus.example.com"
    valid_domain "$DOMAIN" && break
    warn "That doesn't look like a domain name."
  done
  while :; do
    ask S3_DOMAIN "Storage domain" "s3.$DOMAIN"
    valid_domain "$S3_DOMAIN" && [ "$S3_DOMAIN" != "$DOMAIN" ] && break
    warn "Use a different domain name from the app's."
  done

  bold "Email (optional)"
  echo "Used for password resets and notices. You can also set it up later in Admin → System → Email."
  EMAIL_TRANSPORT=""
  if confirm "Set up email now?" n; then
    while :; do
      ask EMAIL_TRANSPORT "Send with smtp or resend" smtp
      [[ "$EMAIL_TRANSPORT" =~ ^(smtp|resend)$ ]] && break
    done
    ask EMAIL_FROM "From address, e.g. Nimbus <nimbus@$DOMAIN>" "Nimbus <nimbus@$DOMAIN>"
    if [ "$EMAIL_TRANSPORT" = smtp ]; then
      ask SMTP_HOST "SMTP host"
      ask SMTP_PORT "SMTP port" 587
      SMTP_SECURE=false
      [ "$SMTP_PORT" = 465 ] && SMTP_SECURE=true
      ask SMTP_USER "SMTP username (empty for none)"
      SMTP_PASSWORD=""
      [ -n "$SMTP_USER" ] && ask_secret SMTP_PASSWORD "SMTP password"
    else
      ask_secret RESEND_API_KEY "Resend API key"
    fi
  fi

  bold "Sign in with Google or GitHub (optional)"
  GOOGLE_CLIENT_ID="" GOOGLE_CLIENT_SECRET="" GITHUB_CLIENT_ID="" GITHUB_CLIENT_SECRET=""
  if confirm "Add Google sign-in?" n; then
    echo "  Callback URL: https://$DOMAIN/api/auth/callback/google"
    ask GOOGLE_CLIENT_ID "Google client ID"
    ask_secret GOOGLE_CLIENT_SECRET "Google client secret"
  fi
  if confirm "Add GitHub sign-in?" n; then
    echo "  Callback URL: https://$DOMAIN/api/auth/callback/github"
    ask GITHUB_CLIENT_ID "GitHub client ID"
    ask_secret GITHUB_CLIENT_SECRET "GitHub client secret"
  fi
else
  DOMAIN=$(env_value DOMAIN)
  S3_DOMAIN=$(env_value S3_DOMAIN)
  [ -n "$DOMAIN" ] && [ -n "$S3_DOMAIN" ] || die "DOMAIN or S3_DOMAIN is empty in .env."
fi

bold "Backups (optional)"
echo "The backup worker dumps the database and copies files to S3-compatible storage"
echo "you choose later in Admin → System → Backups. It needs this server's Docker socket,"
echo "which is root-level access, so it's opt-in."
BACKUP=n
confirm "Run the backup worker?" n && BACKUP=y

bold "nginx and HTTPS"
echo "Nimbus listens only on 127.0.0.1. nginx makes it public on https://$DOMAIN and"
echo "https://$S3_DOMAIN with free Let's Encrypt certificates (Debian/Ubuntu, needs sudo)."
echo "It also removes nginx's 'default' site; your other nginx sites stay."
NGINX=n
if confirm "Set up nginx and HTTPS for you?" y; then
  NGINX=y
  CERTBOT_EMAIL=$(env_value CERTBOT_EMAIL 2>/dev/null || true)
  [ "$CERTBOT_EMAIL" = you@example.com ] && CERTBOT_EMAIL=""
  ask CERTBOT_EMAIL "Email for Let's Encrypt expiry notices" "$CERTBOT_EMAIL"
fi

# --- Write .env ---------------------------------------------------------------
if [ "$write_env" = y ]; then
  bold "Writing .env"
  cp production_script/.env.example .env
  set_env DOMAIN "$DOMAIN"
  set_env S3_DOMAIN "$S3_DOMAIN"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env S3_SECRET_KEY "$(openssl rand -hex 24)"
  set_env TUS_HOOK_SECRET "$(openssl rand -hex 24)"
  set_env BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
  set_env BACKUP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  set_env GOOGLE_CLIENT_ID "$(quoted "$GOOGLE_CLIENT_ID")"
  set_env GOOGLE_CLIENT_SECRET "$(quoted "$GOOGLE_CLIENT_SECRET")"
  set_env GITHUB_CLIENT_ID "$(quoted "$GITHUB_CLIENT_ID")"
  set_env GITHUB_CLIENT_SECRET "$(quoted "$GITHUB_CLIENT_SECRET")"
  if [ -n "$EMAIL_TRANSPORT" ]; then
    set_env EMAIL_TRANSPORT "$EMAIL_TRANSPORT"
    set_env EMAIL_FROM "$(quoted "$EMAIL_FROM")"
    if [ "$EMAIL_TRANSPORT" = smtp ]; then
      set_env SMTP_HOST "$(quoted "$SMTP_HOST")"
      set_env SMTP_PORT "$SMTP_PORT"
      set_env SMTP_SECURE "$SMTP_SECURE"
      set_env SMTP_USER "$(quoted "$SMTP_USER")"
      set_env SMTP_PASSWORD "$(quoted "$SMTP_PASSWORD")"
    else
      set_env RESEND_API_KEY "$(quoted "$RESEND_API_KEY")"
    fi
  fi
fi
[ "$NGINX" = y ] && set_env CERTBOT_EMAIL "$CERTBOT_EMAIL"
chmod 600 .env
[ "$write_env" = y ] && echo "Saved .env (readable only by you)."

# --- Start --------------------------------------------------------------------
bold "Starting Nimbus (the first build takes a few minutes)"
profile=()
[ "$BACKUP" = y ] && profile=(--profile backup)
docker compose "${profile[@]}" up -d --build

printf "Waiting for the app"
for _ in $(seq 60); do
  curl -fs -o /dev/null http://127.0.0.1:3400/sign-up && break
  printf .
  sleep 2
done
echo
curl -fs -o /dev/null http://127.0.0.1:3400/sign-up ||
  die "The app didn't come up. See: docker compose logs migrate app"
echo "The app is running on 127.0.0.1:3400."

# --- nginx --------------------------------------------------------------------
for d in "$DOMAIN" "$S3_DOMAIN"; do
  ip=$(getent ahostsv4 "$d" | awk 'NR == 1 { print $1 }' || true)
  if [ -z "$ip" ]; then warn "$d doesn't resolve yet. Add its DNS A record before HTTPS can work."
  else echo "$d → $ip"; fi
done

if [ "$NGINX" = y ]; then
  bold "Setting up nginx (asks for your sudo password)"
  sudo ./production_script/setup-nginx.sh ||
    die "nginx setup failed. Fix the error above (often DNS not pointing here yet), then run: sudo ./production_script/setup-nginx.sh"
else
  bold "Set up your reverse proxy yourself"
  cat <<EOF
Point your proxy at these (all on 127.0.0.1), with HTTPS on both names:

  https://$DOMAIN/files/  → 127.0.0.1:3401  (resumable uploads: no body size limit,
                                           no request buffering, X-Forwarded-Host/Proto)
  https://$DOMAIN/        → 127.0.0.1:3400  (no response buffering: zips stream)
  https://$S3_DOMAIN/     → 127.0.0.1:3402  (pass the Host header through unchanged)

A ready nginx config is in production_script/nginx/nimbus.conf.template. Render it with:
  DOMAIN=$DOMAIN S3_DOMAIN=$S3_DOMAIN envsubst '\${DOMAIN} \${S3_DOMAIN}' \\
    < production_script/nginx/nimbus.conf.template
Or let the script do it later: sudo ./production_script/setup-nginx.sh
EOF
fi

# --- Done ---------------------------------------------------------------------
bold "Done"
cat <<EOF
1. Open https://$DOMAIN and sign up right away: the first account becomes the owner.
2. Turn on two-factor in Account, then check Admin → System → Health is all green.
3. Copy BACKUP_ENCRYPTION_KEY from .env somewhere off this server. Without it, no backup
   can be restored.

Update later with: git pull && ./setup.sh   (keep the existing .env when asked)
EOF
