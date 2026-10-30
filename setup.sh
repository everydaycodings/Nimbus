#!/usr/bin/env bash
# Interactive production setup: asks a few questions, writes .env, starts Nimbus
# with Docker Compose, and (if you say so) puts nginx with HTTPS in front.
# Run from anywhere as a user that can use Docker: ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

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
# choose VAR "Question" "option 1" "option 2" … → VAR is the number picked
choose() {
  local var=$1 q=$2 i answer
  shift 2
  echo "$q"
  for i in $(seq $#); do echo "  $i) ${!i}"; done
  while :; do
    read -rp "Choose 1-$# [1]: " answer
    answer=${answer:-1}
    [[ "$answer" =~ ^[0-9]+$ ]] && [ "$answer" -ge 1 ] && [ "$answer" -le $# ] && break
  done
  printf -v "$var" '%s' "$answer"
}
# set_env KEY VALUE: sets KEY's line in .env, adding it if missing.
set_env() {
  KEY="$1" VALUE="$2" awk 'BEGIN { k = ENVIRON["KEY"] "=" }
    index($0, k) == 1 { print k ENVIRON["VALUE"]; found = 1; next } { print }
    END { if (!found) print k ENVIRON["VALUE"] }' .env > .env.tmp
  mv .env.tmp .env
}
# Free text goes in single quotes so compose takes $ and # literally.
quoted() { [ -n "$1" ] && printf "'%s'" "$1" || true; }
valid_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]]; }
env_value() { sed -n "s/^$1=['\"]\{0,1\}\([^ #'\"]*\).*/\1/p" .env 2>/dev/null | tail -n1; }
has_profile() { [[ ",$PROFILES," == *",$1,"* ]]; }

# --- Checks -------------------------------------------------------------------
bold "Nimbus setup"
command -v docker >/dev/null || die "Docker isn't installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 isn't installed (docker compose)."
docker info >/dev/null 2>&1 ||
  die "Can't talk to Docker. Start it, or add yourself to the docker group: sudo usermod -aG docker \$USER (then log in again)."

# --- Questions ----------------------------------------------------------------
write_env=y
if [ -f .env ]; then
  warn ".env already exists."
  echo "  Keeping it is right if Nimbus has run before: a new .env makes new secrets,"
  echo "  and the existing database won't accept the new password."
  if confirm "Keep the existing .env?" y; then write_env=n; fi
fi

if [ "$write_env" = y ]; then
  bold "Domain"
  echo "The app's public name needs a DNS A record pointing at this server."
  while :; do
    ask DOMAIN "App domain, e.g. nimbus.example.com"
    valid_domain "$DOMAIN" && break
    warn "That doesn't look like a domain name."
  done

  bold "Database"
  choose db "Which Postgres should Nimbus use?" \
    "Run one here in Docker (recommended)" \
    "My own Postgres (managed, or already on this server)"
  PROFILES=""
  if [ "$db" = 1 ]; then
    PROFILES=postgres
    POSTGRES_PASSWORD=$(openssl rand -hex 24)
    DATABASE_URL="postgres://nimbus:$POSTGRES_PASSWORD@postgres:5432/nimbus"
    HOST_DATABASE_URL="postgres://nimbus:$POSTGRES_PASSWORD@127.0.0.1:54340/nimbus"
  else
    echo "Use an empty database. Its user must be allowed to create the pg_trgm extension."
    while :; do
      ask_secret DATABASE_URL "Database URL, postgres://user:password@host:5432/dbname (hidden)"
      [[ "$DATABASE_URL" =~ ^postgres(ql)?://[^@]+@[^/]+/.+ ]] && break
      warn "That doesn't look like postgres://user:password@host:port/dbname."
    done
    # Inside a container, localhost is the container. This host is host.docker.internal
    # there, while the backup worker (host network) still sees it as 127.0.0.1.
    HOST_DATABASE_URL="$DATABASE_URL"
    if [[ "$DATABASE_URL" =~ @(localhost|127\.0\.0\.1)[:/] ]]; then
      DATABASE_URL=$(sed -E 's/@(localhost|127\.0\.0\.1)([:\/])/@host.docker.internal\2/' <<<"$DATABASE_URL")
      HOST_DATABASE_URL=$(sed -E 's/@(localhost|127\.0\.0\.1)([:\/])/@127.0.0.1\2/' <<<"$HOST_DATABASE_URL")
      warn "Postgres on this server: it must listen on the Docker bridge (listen_addresses) and"
      warn "allow 172.16.0.0/12 in pg_hba.conf, or the containers can't reach it."
    fi
  fi

  bold "File storage"
  choose storage "Where should files be stored?" \
    "Run MinIO here in Docker (needs a second domain, e.g. s3.$DOMAIN)" \
    "My own S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, Wasabi, …)"
  if [ "$storage" = 1 ]; then
    PROFILES="${PROFILES:+$PROFILES,}minio"
    echo "Browsers download files from storage directly, so it needs its own public name"
    echo "with a DNS A record pointing here too."
    while :; do
      ask S3_DOMAIN "Storage domain" "s3.$DOMAIN"
      valid_domain "$S3_DOMAIN" && [ "$S3_DOMAIN" != "$DOMAIN" ] && break
      warn "Use a domain name different from the app's."
    done
    S3_ENDPOINT="https://$S3_DOMAIN" S3_REGION=us-east-1 S3_BUCKET=nimbus S3_ACCESS_KEY=nimbus
    S3_SECRET_KEY=$(openssl rand -hex 24) S3_FORCE_PATH_STYLE=true
  else
    S3_DOMAIN=""
    echo "Examples of endpoints: R2 https://<account-id>.r2.cloudflarestorage.com,"
    echo "B2 https://s3.<region>.backblazeb2.com, Wasabi https://s3.<region>.wasabisys.com."
    ask S3_ENDPOINT "Endpoint URL (empty for AWS S3)"
    [ -z "$S3_ENDPOINT" ] || [[ "$S3_ENDPOINT" =~ ^https?:// ]] || S3_ENDPOINT="https://$S3_ENDPOINT"
    ask S3_REGION "Region (R2 uses auto)" us-east-1
    while :; do
      ask S3_BUCKET "Bucket name (create it first)"
      [ -n "$S3_BUCKET" ] && break
    done
    ask S3_ACCESS_KEY "Access key ID"
    ask_secret S3_SECRET_KEY "Secret access key (hidden)"
    S3_FORCE_PATH_STYLE=false
    confirm "Use path-style URLs? (only self-hosted MinIO, Garage, SeaweedFS usually need it)" n &&
      S3_FORCE_PATH_STYLE=true
  fi

  bold "Email (optional)"
  echo "Used for password resets and notices. You can also set it up later in Admin → System → Email."
  EMAIL_TRANSPORT=""
  if confirm "Set up email now?" n; then
    while :; do
      ask EMAIL_TRANSPORT "Send with smtp or resend" smtp
      [[ "$EMAIL_TRANSPORT" =~ ^(smtp|resend)$ ]] && break
    done
    ask EMAIL_FROM "From address" "Nimbus <nimbus@$DOMAIN>"
    if [ "$EMAIL_TRANSPORT" = smtp ]; then
      ask SMTP_HOST "SMTP host"
      ask SMTP_PORT "SMTP port" 587
      SMTP_SECURE=false
      [ "$SMTP_PORT" = 465 ] && SMTP_SECURE=true
      ask SMTP_USER "SMTP username (empty for none)"
      SMTP_PASSWORD=""
      [ -n "$SMTP_USER" ] && ask_secret SMTP_PASSWORD "SMTP password (hidden)"
    else
      ask_secret RESEND_API_KEY "Resend API key (hidden)"
    fi
  fi

  bold "Sign in with Google or GitHub (optional)"
  GOOGLE_CLIENT_ID="" GOOGLE_CLIENT_SECRET="" GITHUB_CLIENT_ID="" GITHUB_CLIENT_SECRET=""
  if confirm "Add Google sign-in?" n; then
    echo "  Callback URL: https://$DOMAIN/api/auth/callback/google"
    ask GOOGLE_CLIENT_ID "Google client ID"
    ask_secret GOOGLE_CLIENT_SECRET "Google client secret (hidden)"
  fi
  if confirm "Add GitHub sign-in?" n; then
    echo "  Callback URL: https://$DOMAIN/api/auth/callback/github"
    ask GITHUB_CLIENT_ID "GitHub client ID"
    ask_secret GITHUB_CLIENT_SECRET "GitHub client secret (hidden)"
  fi
else
  DOMAIN=$(env_value DOMAIN)
  S3_DOMAIN=$(env_value S3_DOMAIN)
  [ -n "$DOMAIN" ] || die "DOMAIN is empty in .env."
  if grep -q '^COMPOSE_PROFILES=' .env; then
    PROFILES=$(env_value COMPOSE_PROFILES)
  else
    # Written by the first setup.sh, which always ran Postgres and MinIO here.
    PROFILES=postgres,minio
    pw=$(env_value POSTGRES_PASSWORD)
    [ -n "$pw" ] && [ -n "$S3_DOMAIN" ] || die "This .env is missing POSTGRES_PASSWORD or S3_DOMAIN."
    set_env DATABASE_URL "postgres://nimbus:$pw@postgres:5432/nimbus"
    set_env HOST_DATABASE_URL "postgres://nimbus:$pw@127.0.0.1:54340/nimbus"
    set_env S3_ENDPOINT "https://$S3_DOMAIN"
    set_env S3_REGION us-east-1
    set_env S3_BUCKET nimbus
    set_env S3_ACCESS_KEY nimbus
    set_env S3_FORCE_PATH_STYLE true
    echo "Updated .env from the earlier setup's format (same secrets)."
  fi
  has_profile postgres || has_profile minio || grep -q '^DATABASE_URL=.' .env ||
    die "DATABASE_URL is empty in .env."
fi

bold "Backups (optional)"
echo "The backup worker dumps the database and copies files to S3-compatible storage"
echo "you choose later in Admin → System → Backups. It needs this server's Docker socket,"
echo "which is root-level access, so it's opt-in."
PROFILES=$(tr ',' '\n' <<<"$PROFILES" | grep -vx -e backup -e '' | paste -sd, || true)
default=n
[ "$write_env" = n ] && [[ ",$(env_value COMPOSE_PROFILES)," == *",backup,"* ]] && default=y
confirm "Run the backup worker?" "$default" && PROFILES="${PROFILES:+$PROFILES,}backup"

bold "nginx and HTTPS"
names="https://$DOMAIN${S3_DOMAIN:+ and https://$S3_DOMAIN}"
echo "Nimbus listens only on 127.0.0.1. nginx makes it public on $names"
echo "with free Let's Encrypt certificates (Debian/Ubuntu, needs sudo). It skips this if"
echo "that's already set up and working, and leaves your other nginx sites alone (it does"
echo "remove nginx's 'default' site)."
NGINX=n
if confirm "Set up nginx and HTTPS for you?" y; then
  NGINX=y
  CERTBOT_EMAIL=$(env_value CERTBOT_EMAIL)
  [ "$CERTBOT_EMAIL" = you@example.com ] && CERTBOT_EMAIL=""
  while :; do
    ask CERTBOT_EMAIL "Email for Let's Encrypt expiry notices" "$CERTBOT_EMAIL"
    [[ "$CERTBOT_EMAIL" == *@*.* ]] && break
  done
fi

# --- Ports and old data -------------------------------------------------------
ports=(3400 3401 3404 6340)
has_profile postgres && ports+=(54340)
has_profile minio && ports+=(3402 3403)
if [ -z "$(docker compose ps -q 2>/dev/null || true)" ] && command -v ss >/dev/null; then
  for p in "${ports[@]}"; do
    [ -z "$(ss -ltnH "sport = :$p")" ] ||
      die "Port $p is already in use. Change it in docker-compose.yml and production_script/nginx/*.template, then run this again."
  done
fi

if [ "$write_env" = y ]; then
  old=()
  for v in postgres minio; do
    has_profile "$v" && docker volume inspect "nimbus_$v" >/dev/null 2>&1 && old+=("nimbus_$v")
  done
  if [ ${#old[@]} -gt 0 ]; then
    warn "Data from an earlier Nimbus install is still here: ${old[*]}"
    echo "  It was set up with the old .env's passwords and won't accept the new ones."
    confirm "Delete it? Everything stored in it is lost" n ||
      die "Stopped. Restore the old .env (keep it when asked), or delete ${old[*]} yourself."
    docker compose down --remove-orphans >/dev/null 2>&1 || true
    docker volume rm "${old[@]}" >/dev/null
  fi
fi

# --- Write .env ---------------------------------------------------------------
if [ "$write_env" = y ]; then
  bold "Writing .env"
  cp production_script/.env.example .env
  set_env DOMAIN "$DOMAIN"
  set_env S3_DOMAIN "$S3_DOMAIN"
  set_env TUS_HOOK_SECRET "$(openssl rand -hex 24)"
  set_env BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
  set_env BACKUP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  set_env POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}"
  set_env DATABASE_URL "$(quoted "$DATABASE_URL")"
  set_env HOST_DATABASE_URL "$(quoted "$HOST_DATABASE_URL")"
  set_env S3_ENDPOINT "$(quoted "$S3_ENDPOINT")"
  set_env S3_REGION "$(quoted "$S3_REGION")"
  set_env S3_BUCKET "$(quoted "$S3_BUCKET")"
  set_env S3_ACCESS_KEY "$(quoted "$S3_ACCESS_KEY")"
  set_env S3_SECRET_KEY "$(quoted "$S3_SECRET_KEY")"
  set_env S3_FORCE_PATH_STYLE "$S3_FORCE_PATH_STYLE"
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
set_env COMPOSE_PROFILES "$PROFILES"
[ "$NGINX" = y ] && set_env CERTBOT_EMAIL "$CERTBOT_EMAIL"
chmod 600 .env
[ "$write_env" = y ] && echo "Saved .env (readable only by you)."

# --- Start --------------------------------------------------------------------
bold "Starting Nimbus (the first build takes a few minutes)"
echo "Services: app, worker, webdav, tusd, redis${PROFILES:+, ${PROFILES//,/, }}"
docker compose up -d --build --remove-orphans

printf "Waiting for the app"
for _ in $(seq 60); do
  curl -fs -o /dev/null http://127.0.0.1:3400/sign-in && break
  printf .
  sleep 2
done
echo
curl -fs -o /dev/null http://127.0.0.1:3400/sign-in ||
  die "The app didn't come up. See: docker compose logs migrate app"
echo "The app is running on 127.0.0.1:3400."

# The first setup.sh tagged its image nimbus:latest; this one builds nimbus-app.
if docker image inspect nimbus:latest >/dev/null 2>&1 &&
  confirm "Remove the old nimbus:latest image an earlier setup built?" y; then
  docker image rm nimbus:latest >/dev/null && echo "Removed nimbus:latest."
fi

# --- nginx --------------------------------------------------------------------
for d in "$DOMAIN" ${S3_DOMAIN:+"$S3_DOMAIN"}; do
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
Point your proxy at these (all on 127.0.0.1), with HTTPS:

  https://$DOMAIN/files/  → 127.0.0.1:3401  (resumable uploads: no body size limit,
                                           no request buffering, X-Forwarded-Host/Proto)
  https://$DOMAIN/        → 127.0.0.1:3400  (no response buffering: zips stream)
EOF
  [ -n "$S3_DOMAIN" ] &&
    echo "  https://$S3_DOMAIN/     → 127.0.0.1:3402  (pass the Host header through unchanged)"
  cat <<EOF

Ready nginx configs are in production_script/nginx/. Or let the script do it later:
  sudo ./production_script/setup-nginx.sh
EOF
fi

# --- Done ---------------------------------------------------------------------
bold "Done"
if ! has_profile minio; then
  cat <<EOF
Your bucket must let the browser read from it. Add this CORS rule to it
(AWS: bucket → Permissions → CORS; R2: bucket → Settings → CORS policy):

  [{"AllowedOrigins": ["https://$DOMAIN"], "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"], "ExposeHeaders": ["Content-Range", "Content-Length", "ETag"],
    "MaxAgeSeconds": 3600}]

EOF
fi
cat <<EOF
1. Open https://$DOMAIN and sign up right away: the first account becomes the owner.
2. Turn on two-factor in Account, then check Admin → System → Health is all green.
3. Copy BACKUP_ENCRYPTION_KEY from .env somewhere off this server. Without it, no backup
   can be restored.

Update later with: git pull && ./setup.sh   (keep the existing .env when asked)
Day to day, plain "docker compose up -d" starts the same services (COMPOSE_PROFILES in .env).
EOF
