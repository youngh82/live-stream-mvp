#!/usr/bin/env bash
# 최신 백업을 빈 Postgres에 복원해보고, 테이블마다 행 수를 운영 DB와 비교한다.
#
#   sudo infra/deploy/lsm-db-restore-test.sh
#
# **복원해본 적 없는 백업은 백업이 아니다.** 매일 올라가는 파일이 실제로 되살아나는지는
# 이걸 돌려야만 안다. 운영 DB는 읽기만 하고, 복원은 버리는 컨테이너에서 한다.
#
# 운영과 행 수가 조금 다를 수 있다 — 백업 이후에 쌓인 행(feed_events 등)이다.
# 차이는 보여만 주고 판단은 사람이 한다.
#
# 새 Supabase 프로젝트로 실제 복구할 때도 앞부분(역할·확장 준비)은 같다.
# 다만 그쪽은 역할과 확장이 이미 있으므로 pg_restore만 하면 된다.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/live-stream-mvp}"
ENV_FILE="$REPO_DIR/.env.production"
PG_IMAGE=postgres:17-alpine
AWS_IMAGE=amazon/aws-cli:2.27.50
NAME=lsm-restore-test

env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }
PGURL=$(env_value DATABASE_URL)
BUCKET=$(env_value BACKUP_S3_BUCKET)
export PGURL

work=$(mktemp -d)
cleanup() { docker rm -f "$NAME" > /dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

aws() { docker run --rm --network host -v "$work:/out" "$AWS_IMAGE" "$@" --region us-east-1; }
latest=$(aws s3 ls "s3://$BUCKET/daily/" | sort | tail -1 | awk '{print $4}')
[ -n "$latest" ] || { echo "[restore-test] 백업이 하나도 없다" >&2; exit 1; }
echo "[restore-test] $latest"
aws s3 cp "s3://$BUCKET/daily/$latest" /out/db.dump --only-show-errors

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test -v "$work:/out" "$PG_IMAGE" > /dev/null
until docker exec "$NAME" pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
sleep 2

# 빈 Postgres에는 Supabase의 역할과 확장이 없다. 없으면 GRANT·RLS 정책·검색 인덱스가
# 복원 중에 실패한다. pg_trgm은 운영에서 public 스키마에 설치돼 있다.
docker exec "$NAME" psql -U postgres -q -v ON_ERROR_STOP=1 -c "
  do \$\$ declare r text; begin
    foreach r in array array['anon','authenticated','service_role','authenticator',
      'supabase_admin','supabase_auth_admin','supabase_storage_admin','dashboard_user','pgbouncer']
    loop
      if not exists (select from pg_roles where rolname = r) then
        execute format('create role %I nologin', r);
      end if;
    end loop;
  end \$\$;
  create schema if not exists extensions;
  create extension if not exists pg_trgm schema public;
  create extension if not exists pgcrypto schema extensions;
  create extension if not exists \"uuid-ossp\" schema extensions;"

# 'schema "public" already exists' 한 줄은 정상이다. 그 외 에러가 있으면 보여준다.
errors=$(docker exec "$NAME" pg_restore -U postgres -d postgres --no-owner /out/db.dump 2>&1 \
  | grep 'error:' | grep -v 'schema "public" already exists' || true)
if [ -n "$errors" ]; then
  echo "[restore-test] ⚠️ 복원 중 에러:"; echo "$errors"
fi

tables=$(docker run --rm --network host -e PGURL "$PG_IMAGE" psql "$PGURL" -tA -c \
  "select table_schema||'.'||table_name from information_schema.tables
   where table_schema in ('public','auth') and table_type='BASE TABLE' order by 1")
sql=$(for t in $tables; do printf "select '%s', count(*) from %s union all " "$t" "$t"; done)
sql="${sql% union all }"

prod=$(docker run --rm --network host -e PGURL "$PG_IMAGE" psql "$PGURL" -tA -F' ' -c "$sql" | sort)
restored=$(docker exec "$NAME" psql -U postgres -tA -F' ' -c "$sql" | sort)

if [ "$prod" = "$restored" ]; then
  echo "[restore-test] ✅ $(wc -l <<< "$prod")개 테이블 행 수가 운영과 전부 같다"
else
  echo "[restore-test] 운영과 다른 테이블 (왼쪽 운영, 오른쪽 복원):"
  diff <(echo "$prod") <(echo "$restored") | grep -E '^[<>]' || true
fi
[ -z "$errors" ]
