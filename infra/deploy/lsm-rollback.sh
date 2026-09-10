#!/usr/bin/env bash
# 잘못 배포했을 때 이전 버전으로 되돌린다.
#
#   sudo infra/deploy/lsm-rollback.sh <커밋>    # 그 main 커밋에서 빌드된 이미지로 고정
#   sudo infra/deploy/lsm-rollback.sh --release # 고정 해제 → 최신으로 복귀
#   sudo infra/deploy/lsm-rollback.sh --status  # 지금 고정돼 있는지
#
# **.env.production의 IMAGE_TAG로 고정한다.** compose가 `lsm-app:${IMAGE_TAG:-latest}`를
# 읽으므로, 고정된 동안에는 2분마다 도는 배포 타이머도 같은 이미지를 받을 뿐이라
# 롤백을 덮어쓰지 않는다. 타이머를 끌 필요가 없다.
#
# ⚠️ 되돌리는 건 **이미지(app·chat·thumbnailer)뿐이다.** compose·Caddyfile·mediamtx
#    설정은 타이머가 계속 main을 따라간다. 설정 변경이 원인이면 PR로 `git revert`할 것.
#    DB 마이그레이션도 되돌리지 않는다 — PROGRESS.md "마이그레이션" 참고.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/live-stream-mvp}"
ENV_FILE="$REPO_DIR/.env.production"
COMPOSE="docker compose -f $REPO_DIR/infra/docker-compose.prod.yml --env-file $ENV_FILE"
IMAGES=(lsm-app lsm-chat lsm-thumbnailer)
REGISTRY="ghcr.io/${GHCR_OWNER:-youngh82}"

cd "$REPO_DIR"
git() { command git -c safe.directory="$REPO_DIR" "$@"; }

# .env.production은 600·ubuntu 소유다. sed -i는 파일을 새로 만들어 소유자가 root로
# 바뀌므로, 내용만 덮어써서 권한과 소유자를 그대로 둔다.
set_image_tag() {
  local tmp
  tmp=$(mktemp)
  grep -v '^IMAGE_TAG=' "$ENV_FILE" > "$tmp" || true
  [ -n "$1" ] && echo "IMAGE_TAG=$1" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

wait_healthy() {
  for _ in $(seq 1 30); do
    # 컨테이너가 뜨는 동안은 connection reset이 정상이라 에러 출력은 버린다
    if curl -fsS -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null &&
       curl -fsS -o /dev/null http://127.0.0.1:3001/health 2>/dev/null; then
      echo "[rollback] 헬스체크 통과 (app·chat)"
      return 0
    fi
    sleep 3
  done
  echo "[rollback] ⚠️ 90초 안에 헬스체크가 통과하지 않았다. compose ps / logs를 볼 것" >&2
  return 1
}

# IMAGE_TAG=latest는 고정이 아니다 (compose 기본값과 같다)
current_tag() { grep '^IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2 | grep -v '^latest$' || true; }

case "${1:-}" in
  ""|-h|--help)
    sed -n '2,6p' "$0"; exit 1 ;;

  --status)
    tag=$(current_tag)
    if [ -z "$tag" ]; then
      echo "고정 안 됨 — 최신(latest)을 따라간다"
    else
      echo "고정됨: $tag"
      git log --oneline -1 "$tag" 2>/dev/null || true
    fi
    exit 0 ;;

  --release)
    set_image_tag ""
    echo "[rollback] 고정 해제. 최신으로 올린다"
    "$REPO_DIR/infra/deploy/lsm-deploy.sh"
    wait_healthy ;;

  *)
    git fetch --quiet origin main
    sha=$(git rev-parse --verify "$1^{commit}")
    if ! git merge-base --is-ancestor "$sha" origin/main; then
      echo "[rollback] $1 은 main에 없는 커밋이다. 이미지는 main 커밋에서만 빌드된다" >&2
      exit 1
    fi

    # 먼저 셋 다 받아본다. 하나라도 없으면 아무것도 바꾸지 않는다 —
    # 빌드가 실패한 커밋에는 이미지가 없다. (취소된 빌드는 경우에 따라 다르다:
    # #6은 취소됐는데도 이미지가 올라가 있었다. 있으면 쓸 수 있다는 뜻이다)
    for img in "${IMAGES[@]}"; do
      if ! docker pull --quiet "$REGISTRY/$img:$sha" > /dev/null; then
        echo "[rollback] $img:$sha 이미지가 없다. 그 커밋의 빌드가 취소·실패했는지 볼 것" >&2
        exit 1
      fi
    done

    # **무엇이 사라지는지 보여주고 확인받는다.** 오래된 버전일수록 그 사이에 생긴
    # 것(헬스 경로, 에러 수집, 모니터가 기대하는 응답)이 같이 사라진다.
    # 2026-09-10 테스트에서 #6으로 돌렸다가 채팅 /health가 없어져 모니터가 8분간 Down이었다.
    echo "[rollback] 아래 커밋이 운영에서 빠진다:"
    git log --oneline "$sha..origin/main" | sed 's/^/    /'
    if [ -z "${ROLLBACK_YES:-}" ]; then
      read -r -p "계속할까? [y/N] " answer
      [ "$answer" = "y" ] || { echo "[rollback] 취소"; exit 1; }
    fi

    set_image_tag "$sha"
    echo "[rollback] $(git log --oneline -1 "$sha") 로 고정"
    # --build를 붙이지 말 것 (ISSUES U-15)
    $COMPOSE up -d --remove-orphans
    wait_healthy
    echo "[rollback] 되돌리려면: sudo $0 --release" ;;
esac
