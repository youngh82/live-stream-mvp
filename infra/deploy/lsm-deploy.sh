#!/usr/bin/env bash
# 새 이미지가 올라왔으면 갈아끼운다.
#
# **당겨오는(pull) 방식이다.** GitHub Actions가 서버에 SSH로 들어오게 하려면
# 러너의 IP가 매번 바뀌므로 방화벽을 열어둬야 한다. 그 구멍을 만들지 않기 위해
# 서버가 스스로 확인한다. 들어오는 연결이 하나도 늘지 않는다.
#
# 바뀐 게 없으면 아무것도 하지 않는다 — 멀쩡한 컨테이너를 재시작하면
# 채팅 연결이 끊기고 방송이 흔들린다.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/live-stream-mvp}"
COMPOSE="docker compose -f $REPO_DIR/infra/docker-compose.prod.yml --env-file $REPO_DIR/.env.production"

cd "$REPO_DIR"

# 배포 설정 자체(compose·Caddyfile·mediamtx 설정)도 따라와야 한다
git fetch --quiet origin main
git reset --quiet --hard origin/main

before=$($COMPOSE images --quiet 2>/dev/null | sort | md5sum)
$COMPOSE pull --quiet 2>/dev/null || $COMPOSE pull
after=$($COMPOSE images --quiet 2>/dev/null | sort | md5sum)

if [ "$before" = "$after" ]; then
  exit 0
fi

echo "[deploy] 새 이미지 감지 — 갈아끼운다 ($(date -Is))"
# 바뀐 서비스만 다시 만든다. 미디어 서버 설정이 그대로면
# 방송 중인 스트림은 끊기지 않는다.
$COMPOSE up -d --remove-orphans
docker image prune -f --filter "until=168h" > /dev/null 2>&1 || true
echo "[deploy] 완료"
