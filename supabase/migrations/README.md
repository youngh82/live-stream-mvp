# Migrations

Applied to production by hand with `scripts/migrate.sh`. The database records what it has
run in `ops.schema_migrations`, so the answer to "is 012 applied?" lives in the database,
not in someone's notes.

```bash
scripts/migrate.sh status   # applied / pending
scripts/migrate.sh apply    # backs up first, asks y/N, applies pending files in order
```

## The one rule: database first, and old code must still work

Merging to `main` deploys new code within about five minutes (`infra/deploy/lsm-deploy.sh`).
The rollback script (`infra/deploy/lsm-rollback.sh`) reverts **images only** — never the
schema. So at every moment, the running code — and the code you might roll back to — has
to work against the current schema.

| Change | Order |
|---|---|
| Add a table / nullable column / function | apply the migration → merge the code that uses it |
| Add a `NOT NULL` column | add it nullable (or with a default) → deploy code that writes it → backfill → set `NOT NULL` |
| Drop or rename a column | deploy code that stops using it → *then* the migration that drops it |
| Change a function's signature | add the new one → switch the code → drop the old one later |

Renames are a drop plus an add: old code breaks the moment the old name disappears.

## Writing a migration

- Name it `NNN_short_description.sql`, the next number after the highest one here.
- Each file runs in **one transaction**, together with the row that records it. If any
  statement fails, nothing from that file is applied and it stays pending.
- A few statements refuse to run in a transaction (`ALTER TYPE … ADD VALUE`,
  `CREATE INDEX CONCURRENTLY`). Put those in their own file whose first line is
  `-- migrate:no-transaction`, and keep that file to just those statements — it can
  fail halfway.
- New tables in `public` are exposed through the Supabase API. Enable RLS in the same
  migration.
- After schema, RLS or grant changes, run `pnpm verify:security`; after anything touching
  points, donations or payouts, run `pnpm verify:payout`.

## If a migration goes wrong

`apply` triggers a fresh backup on the server before it touches anything. There is no
automatic undo — write a new migration that reverses the change, or restore that backup
(see `infra/deploy/lsm-db-restore-test.sh` for how a restore is done).
