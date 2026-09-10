#!/usr/bin/env bash
# DB를 떠서 S3에 올린다. lsm-db-backup.timer가 매일 돌린다.
#
# **왜 직접 뜨는가**: Supabase 무료 플랜은 백업을 내려받을 수 없다. 프로젝트가
# 지워지거나 잘못된 마이그레이션이 데이터를 망가뜨리면 되돌릴 수단이 없다.
#
# 대상 스키마는 public·auth·storage다. auth.users가 빠지면 복원해도 아무도 로그인할
# 수 없다. 나머지(realtime·vault·graphql 등)는 Supabase가 관리하는 내부 스키마라
# 새 프로젝트가 스스로 만든다. 복원 절차는 lsm-db-restore-test.sh에 있다.
#
# S3 인증은 EC2 IAM 역할(lsm-ec2-backup)로 한다 — 서버에 액세스 키가 없다.
# 그 역할에는 **삭제 권한이 없다.** 서버가 털려도 백업은 못 지운다.
# 오래된 백업은 버킷 수명주기 규칙(30일)이 지운다.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/live-stream-mvp}"
ENV_FILE="$REPO_DIR/.env.production"
PG_IMAGE=postgres:17-alpine   # 서버가 17이다. pg_dump는 서버보다 낮은 버전이면 거부한다
AWS_IMAGE=amazon/aws-cli:2.27.50

# 파일 전체를 source하지 않는다 — 값에 셸 특수문자가 섞여 있을 수 있다.
env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }

# 비밀번호가 `docker run` 인자로 들어가면 ps에 그대로 보인다. 환경변수로만 넘긴다.
PGURL=$(env_value DATABASE_URL)
BUCKET=$(env_value BACKUP_S3_BUCKET)
export PGURL
[ -n "$PGURL" ] && [ -n "$BUCKET" ] || {
  echo "[backup] .env.production에 DATABASE_URL과 BACKUP_S3_BUCKET이 있어야 한다" >&2
  exit 1
}

key="daily/lsm-$(date -u +%Y%m%dT%H%M%SZ).dump"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

docker run --rm --network host -e PGURL -v "$work:/out" "$PG_IMAGE" \
  pg_dump "$PGURL" --format=custom --schema=public --schema=auth --schema=storage \
  --file=/out/db.dump

# 목차를 읽어본다. 도중에 끊긴 파일은 여기서 걸린다 — 깨진 파일을 올려두고
# 백업이 있다고 믿는 게 백업이 없는 것보다 나쁘다.
docker run --rm -v "$work:/out" "$PG_IMAGE" pg_restore --list /out/db.dump > /dev/null

# --network host: 컨테이너가 인스턴스 메타데이터(IAM 역할 자격증명)에 닿으려면 필요하다
docker run --rm --network host -v "$work:/out" "$AWS_IMAGE" \
  s3 cp /out/db.dump "s3://$BUCKET/$key" --region us-east-1 --only-show-errors

echo "[backup] 완료 s3://$BUCKET/$key ($(du -h "$work/db.dump" | cut -f1))"
