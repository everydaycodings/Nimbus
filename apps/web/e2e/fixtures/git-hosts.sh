#!/bin/bash
# Starts a real Gitea (:3910) and Forgejo (:3911) for e2e/git-backup-hosts.spec.ts, each with an admin "octo", a token
# (written to $OUT/<name>.token), the org "acme" and, via the API, the repos octo/hello, octo/secret-notes (private)
# and acme/api, each with a commit. Idempotent: a running container is kept. No volumes (sqlite inside the container).
# Webhooks may go anywhere (ALLOWED_HOST_LIST=*) and the containers reach the app at host.docker.internal.
# Usage: OUT=<dir> bash e2e/fixtures/git-hosts.sh   Stop: docker rm -f nimbus-e2e-gitea nimbus-e2e-forgejo
set -euo pipefail
export DOCKER_HOST=${DOCKER_HOST:-unix:///var/run/docker.sock}
OUT=${OUT:?set OUT}
mkdir -p "$OUT"
PASS=e2e-pass-12345

start() { # name image port bin
  local name=nimbus-e2e-$1 image=$2 port=$3 bin=$4 P
  P=$(echo "$bin" | tr a-z A-Z)
  if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
    docker rm -f "$name" >/dev/null 2>&1 || true
    rm -f "$OUT/$1.token" # a new container has no users, so an old token is dead
    docker run -d --name "$name" --add-host=host.docker.internal:host-gateway -p "$port:3000" \
      -e "${P}__security__INSTALL_LOCK=true" -e "${P}__server__ROOT_URL=http://localhost:$port/" \
      -e "${P}__database__DB_TYPE=sqlite3" -e "${P}__webhook__ALLOWED_HOST_LIST=*" -e "${P}__service__DISABLE_REGISTRATION=true" \
      -e "${P}__log__LEVEL=Warn" "$image" >/dev/null
  fi
  for _ in $(seq 60); do curl -sf "http://localhost:$port/api/v1/version" >/dev/null && break; sleep 2; done
  local api="http://localhost:$port/api/v1"
  if [ ! -s "$OUT/$1.token" ]; then
    docker exec -u git "$name" "$bin" admin user create --username octo --password "$PASS" --email octo@example.invalid --admin --must-change-password=false >/dev/null 2>&1 || true
    docker exec -u git "$name" "$bin" admin user generate-access-token --username octo --token-name "e2e-$RANDOM" --scopes all --raw > "$OUT/$1.token"
  fi
  local tok; tok=$(tr -d '\n' < "$OUT/$1.token")
  local c=(curl -sf -H "Authorization: token $tok" -H "Content-Type: application/json")
  "${c[@]}" "$api/orgs/acme" >/dev/null 2>&1 || "${c[@]}" -X POST "$api/orgs" -d '{"username":"acme"}' >/dev/null
  mk() { # path repo private
    "${c[@]}" "$api/repos/$1/$2" >/dev/null 2>&1 && return 0
    if [ "$1" = acme ]; then "${c[@]}" -X POST "$api/orgs/acme/repos" -d "{\"name\":\"$2\",\"private\":$3}" >/dev/null
    else "${c[@]}" -X POST "$api/user/repos" -d "{\"name\":\"$2\",\"private\":$3}" >/dev/null; fi
    "${c[@]}" -X POST "$api/repos/$1/$2/contents/README.md" -d "{\"content\":\"$(echo "# $2" | base64)\",\"message\":\"first\"}" >/dev/null
  }
  mk octo hello false; mk octo secret-notes true; mk acme api true
}
start gitea gitea/gitea:1.24.5 3910 gitea
start forgejo codeberg.org/forgejo/forgejo:11.0.3 3911 forgejo
echo ready
