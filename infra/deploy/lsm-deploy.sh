#!/usr/bin/env bash
# 새 이미지가 올라왔으면 갈아끼운다.
#
# **당겨오는(pull) 방식이다.** GitHub Actions가 서버에 SSH로 들어오게 하려면
# 러너의 IP가 매번 바뀌므로 방화벽을 열어둬야 한다. 그 구멍을 만들지 않기 위해
# 서버가 스스로 확인한다. 들어오는 연결이 하나도 늘지 않는다.
#
# 바뀐 게 없으면 아무것도 하지 않는다 — 멀쩡한 컨테이너를 재시작하면
# 채팅 연결이 끊기고 방송이 흔들린다. 그 판단은 `up -d`가 한다 (아래).
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/live-stream-mvp}"
COMPOSE="docker compose -f $REPO_DIR/infra/docker-compose.prod.yml --env-file $REPO_DIR/.env.production"

cd "$REPO_DIR"

# 배포 설정 자체(compose·Caddyfile·mediamtx 설정)도 따라와야 한다.
# systemd가 root로 돌리는데 저장소 소유자는 ubuntu라, 예외 없이는 git이
# "dubious ownership"으로 거부한다. 서버 전역 설정 대신 여기서만 연다.
git -c safe.directory="$REPO_DIR" fetch --quiet origin main
before=$(git -c safe.directory="$REPO_DIR" rev-parse HEAD)
git -c safe.directory="$REPO_DIR" reset --quiet --hard origin/main

$COMPOSE pull --quiet 2>/dev/null || $COMPOSE pull

# **비교하지 않고 매번 부른다.** `up -d`는 이미지나 설정이 바뀐 서비스만 다시
# 만들고 나머지는 건드리지 않는다. 예전에는 `compose images`의 전후를 비교했는데,
# 그건 *실행 중인 컨테이너*의 이미지라 pull 후에도 같아서 한 번도 교체되지 않았다.
# 이 방식은 .env.production이나 compose만 바뀐 경우도 반영된다.
# ⚠️ --build를 붙이지 말 것. 서버가 OOM으로 죽는다 (ISSUES U-15).
out=$($COMPOSE up -d --remove-orphans 2>&1)
if grep -qE 'Recreat|Creat|Starting' <<<"$out"; then
  echo "[deploy] 교체됨 ($(date -Is))"
  echo "$out" | grep -E 'Recreat|Creat|Start'
  docker image prune -f --filter "until=168h" > /dev/null 2>&1 || true
fi

# **파일로 붙인(bind mount) 설정은 `up -d`가 못 알아챈다.** compose 입장에서는
# 컨테이너 정의가 그대로라 아무것도 안 한다. 게다가 git은 파일을 새 inode로 바꿔
# 쓰므로, 돌고 있는 컨테이너는 계속 옛 파일을 본다. 바뀐 서비스만 다시 만든다.
# (미디어 서버를 다시 만들면 진행 중인 방송이 몇 초 끊긴다 — 설정이 바뀔 때만이다)
changed=$(git -c safe.directory="$REPO_DIR" diff --name-only "$before" HEAD -- \
  infra/mediamtx.prod.yml infra/Caddyfile infra/Dockerfile.mediamtx)
recreate=()
grep -qx 'infra/mediamtx.prod.yml' <<<"$changed" && recreate+=(mediamtx)
grep -qx 'infra/Caddyfile' <<<"$changed" && recreate+=(caddy)
if [ ${#recreate[@]} -gt 0 ]; then
  echo "[deploy] 설정 파일 변경 → 다시 만든다: ${recreate[*]} ($(date -Is))"
  $COMPOSE up -d --no-build --force-recreate "${recreate[@]}"
fi
# 미디어 서버 이미지는 서버에서 빌드한다. 타이머가 자동으로 빌드하게 두지 않는다 (U-15).
grep -qx 'infra/Dockerfile.mediamtx' <<<"$changed" &&
  echo "[deploy] ⚠️ Dockerfile.mediamtx가 바뀌었다. 수동으로: $COMPOSE build mediamtx && up -d mediamtx"
exit 0
