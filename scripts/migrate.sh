#!/usr/bin/env bash
# 운영 DB 마이그레이션. 절차와 순서 규칙은 supabase/migrations/README.md.
#
#   scripts/migrate.sh status            # 적용된 것 / 대기 중인 것
#   scripts/migrate.sh apply             # 대기 중인 것을 순서대로 (백업 먼저, y/N 확인)
#   scripts/migrate.sh baseline <번호>   # 그 번호까지 "이미 적용됨"으로 기록만 (최초 1회)
#
# **어디까지 적용됐는지는 DB가 기억한다** (ops.schema_migrations). 예전에는 로컬
# 문서에만 적혀 있어서, 같은 파일을 두 번 돌리거나 하나를 빠뜨려도 알 수 없었다.
#
# 파일 하나 = 트랜잭션 하나. 기록(INSERT)도 같은 트랜잭션에 들어가므로 "적용됐는데
# 기록이 없다"거나 "반쯤 적용됐다"는 상태가 생기지 않는다. 트랜잭션 안에서 못 쓰는
# 문장(ALTER TYPE ... ADD VALUE 등)이 있는 파일만 첫 줄에 `-- migrate:no-transaction`.
#
# 환경변수: MIGRATE_DB_URL(기본: .env.local의 DATABASE_URL),
#          SKIP_BACKUP=1(서버 백업 생략 — 운영에서는 쓰지 말 것), MIGRATE_YES=1(확인 생략)
set -euo pipefail

cd "$(dirname "$0")/.."
DIR=supabase/migrations
SSH_KEY="${LSM_SSH_KEY:-$HOME/.ssh/lsm-key-use1.pem}"
SSH_HOST="${LSM_SSH_HOST:-ubuntu@livestream-mvp.duckdns.org}"

DB_URL="${MIGRATE_DB_URL:-$(grep -m1 '^DATABASE_URL=' .env.local 2>/dev/null | cut -d= -f2- || true)}"
[ -n "$DB_URL" ] || { echo "DATABASE_URL을 찾을 수 없다 (.env.local 또는 MIGRATE_DB_URL)" >&2; exit 1; }

q() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# public에 두면 Supabase가 REST API로 자동 노출한다. 별도 스키마에 둔다.
ensure_table() {
  q -c "
    create schema if not exists ops;
    revoke all on schema ops from public;
    create table if not exists ops.schema_migrations (
      version    text primary key,           -- 파일명 앞 번호 ('012')
      filename   text not null,
      applied_at timestamptz not null default now()
    );" 2>&1 | grep -v 'already exists, skipping' || true
}

version_of() { basename "$1" | cut -d_ -f1; }
applied()    { q -tA -c "select version from ops.schema_migrations order by 1"; }
pending() {
  local done; done=$(applied)
  for f in "$DIR"/[0-9]*.sql; do
    grep -qx "$(version_of "$f")" <<< "$done" || echo "$f"
  done
}

cmd="${1:-status}"
ensure_table

case "$cmd" in
  status)
    echo "적용됨:"
    q -tA -F'  ' -c "select version, filename, to_char(applied_at, 'YYYY-MM-DD HH24:MI') from ops.schema_migrations order by 1" | sed 's/^/  /'
    todo=$(pending)
    echo "대기 중:"; [ -n "$todo" ] && sed 's#^.*/#  #' <<< "$todo" || echo "  (없음)" ;;

  baseline)
    upto="${2:?baseline에는 번호가 필요하다 (예: 011)}"
    for f in "$DIR"/[0-9]*.sql; do
      v=$(version_of "$f")
      [[ "$v" > "$upto" ]] && continue
      q -c "insert into ops.schema_migrations (version, filename) values ('$v', '$(basename "$f")') on conflict do nothing"
    done
    echo "$upto 까지 적용됨으로 기록했다 (실행은 하지 않았다)" ;;

  apply)
    todo=$(pending)
    [ -n "$todo" ] || { echo "대기 중인 마이그레이션이 없다"; exit 0; }
    echo "적용할 파일:"; sed 's#^.*/#  #' <<< "$todo"
    if [ -z "${MIGRATE_YES:-}" ]; then
      read -r -p "운영 DB에 적용할까? [y/N] " answer
      [ "$answer" = "y" ] || { echo "취소"; exit 1; }
    fi

    # 되돌릴 지점을 먼저 만든다. DB에는 롤백 스크립트가 없다 — 백업이 유일한 되돌림이다.
    if [ -z "${SKIP_BACKUP:-}" ]; then
      echo "서버에서 백업을 뜬다..."
      ssh -i "$SSH_KEY" "$SSH_HOST" 'sudo systemctl start lsm-db-backup.service &&
        sudo journalctl -u lsm-db-backup.service -n 5 --no-pager -o cat | grep "\[backup\]" | tail -1'
    fi

    for f in $todo; do
      v=$(version_of "$f"); name=$(basename "$f")
      record="insert into ops.schema_migrations (version, filename) values ('$v', '$name')"
      if head -1 "$f" | grep -q 'migrate:no-transaction'; then
        echo "→ $name (트랜잭션 없이 — 실패하면 일부만 적용될 수 있다)"
        q -f "$f"
        q -c "$record"
      else
        echo "→ $name"
        # -f와 -c가 한 트랜잭션으로 묶인다. 중간에 실패하면 파일 전체와 기록이 함께 취소된다
        q --single-transaction -f "$f" -c "$record"
      fi
    done
    echo "완료" ;;

  *) sed -n '2,6p' "$0"; exit 1 ;;
esac
