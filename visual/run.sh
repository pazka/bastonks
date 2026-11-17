#!/usr/bin/env bash
# Visual regression of a built image (hosh-management AGENTS.md §3, use cases in TESTING.md).
#   visual/run.sh [IMAGE] [--update]      (default bastonks:local)
# Seeds a data dir with the synthetic board (scripts/seed.ts, as the CI container smoke), starts the image
# hardened (read-only, no caps, uid 10001, no Trello credentials: it serves that snapshot, stale), then
# visual/shoot.mjs shoots every use case at 1400 / 1024 / 390 and compares with visual/baseline/.
# Needs: docker, node >= 22, a Chrome ($CHROME, default google-chrome), deno (or the Dockerfile's pinned
# build image runs scripts/seed.ts). No package is installed.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${1:-bastonks:local}"
shift || true
PORT="${VISUAL_PORT:-18310}"
NAME="bastonks-visual-$$"
SEED="$(mktemp -d)"
VOL="bastonks-visual-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; rm -rf "$SEED" 2>/dev/null || sudo rm -rf "$SEED" 2>/dev/null || true' EXIT

if command -v deno >/dev/null; then
  deno run --allow-read --allow-write="$SEED" scripts/seed.ts "$SEED"
else
  DENO_IMG="$(sed -nE 's/^FROM (denoland\/deno:\S+) AS build$/\1/p' Dockerfile)"
  docker run --rm -v "$PWD":/app:ro -v "$SEED":/seed -w /app ${DENO_CERT:+-v "$DENO_CERT":/ca.crt:ro -e DENO_CERT=/ca.crt} \
    "$DENO_IMG" run --allow-read --allow-write=/seed scripts/seed.ts /seed
fi

docker create --name "$NAME" --read-only --tmpfs /tmp --cap-drop ALL --user 10001:10001 \
  --security-opt no-new-privileges:true --pids-limit 128 --memory 512m \
  -v "$VOL":/data -p "127.0.0.1:$PORT:8000" "$IMAGE" >/dev/null
# the seed belongs to 10001 inside the volume (docker cp -a keeps the owner)
if [ "$(id -u)" = 0 ]; then chown -R 10001:10001 "$SEED"; else sudo chown -R 10001:10001 "$SEED"; fi
if [ "$(id -u)" = 0 ]; then docker cp -a "$SEED/." "$NAME:/data/"; else sudo docker cp -a "$SEED/." "$NAME:/data/"; fi
docker start "$NAME" >/dev/null
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || { docker logs "$NAME"; exit 1; }
test "$(docker exec "$NAME" /app/bastonks healthcheck >/dev/null && docker inspect -f '{{.Config.User}}' "$NAME")" = 10001:10001

node visual/shoot.mjs "http://127.0.0.1:$PORT" "$@"
