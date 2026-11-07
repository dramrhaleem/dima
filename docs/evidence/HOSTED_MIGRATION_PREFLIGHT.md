# Hosted database preflight — 1 November 2026

This is a source/deployment preparation review, not proof of hosted installation. No remote mutation was performed by this review.

## Deployment runner

`scripts/production-migrate.mjs` reads a private JSON connection file. Default mode only reads prerequisites and receipts. `--apply` is required to write. Native `psql` is preferred; an existing container can supply the client, with the explicit remote host and password passed through environment variables, never command arguments. Use a direct connection or **session pooler on port5432**, not transaction pooling.

Connection file shape (0600; password in a separate0600 file):

```json
{
  "projectRef": "vblsmzgbodqnlxlplnby",
  "host": "aws-1-eu-central-1.pooler.supabase.com",
  "port": 5432,
  "user": "postgres.vblsmzgbodqnlxlplnby",
  "database": "postgres",
  "passwordFile": "/home/amro/.local/state/dima-production/database-password",
  "psqlContainer": "dima-b0-db"
}
```

```sh
node scripts/production-migrate.mjs --config /home/amro/.local/state/dima-production/connection.json
node scripts/production-migrate.mjs --config /home/amro/.local/state/dima-production/connection.json --apply
```

The runner rejects an existing public application schema without recognized receipts, unknown/changed migration hashes, and gaps in applied history. Each migration and its SHA-256 receipt commit atomically in `dima_deploy.migrations`. Advisory transaction locks reject concurrent replay. Errors stay in a private file beside the config. The public JSON evidence contains only project ref, migration hashes and verification booleans/counts.

## Relevant differences from local

- Hosted Supabase provides Auth roles, `auth.users`, `auth.uid()`, Realtime schema/messages/topic. Do not run local `01-roles.sh` or local Realtime tenant initialization remotely. Preflight requires those hosted objects to exist before proceeding.
- `btree_gist` is created by the time-ledger migration. Session search path includes `extensions` so its UUID GiST operator class is discoverable. No pgcrypto bootstrap is required: current hashing uses PostgreSQL `sha256`, and UUID generation uses `gen_random_uuid`.
- Local grants are explicit. Fresh hosted initialization removes default auto-grants for tables, sequences and functions to `PUBLIC`, `anon`, `authenticated`, `service_role`, globally and in `public`, before migrations. Migration grants are authoritative. This is limited to the verified new Dima database. It avoids silently granting service-role table reads the local tests intentionally deny.
- `20261031180000_foundation_checks.sql` explicitly says development-only/remove before B7. Hosted runner records its hash with disposition `skipped-development-probe`; it does not create the probe. Other26 migrations run in order, including the2 catalog seeds in040. No test accounts or local database dump are copied.
- Migration024 installs the private Realtime broadcast policy, and the runner verifies its existence. The existing code signs room capability JWTs with **HS256** and a120-second maximum lifetime. `DIMA_REALTIME_SIGNING_SECRET` must be a signing secret actually trusted by this hosted project; an arbitrary new secret will fail. The current implementation can use the accepted legacy JWT secret. New Supabase signing keys are non-extractable; importing a controlled key is an alternative requiring corresponding signer changes. Do not revoke a legacy key the app still uses. See [Supabase JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys).
- Hosted Realtime must allow only private channels for the product setup. Current local tenant also disables Presence; the application owns room presence via database leases, not Supabase Presence. Configure the equivalent hosted setting where available, and prove one private join plus unauthorized denial on the actual service.
- Scheduler and Auth provider/SMTP setup are separate from schema migrations. No `pg_cron`, `pg_net`, Vault, cron registration, Google credentials or SMTP configuration is installed by this runner.

## Validation boundaries

Source review found no top-level transaction commands that would escape the runner's per-file transaction. Script syntax and scoped ESLint are checked separately. An actual hosted preflight/apply result is still required; the final lightweight checks cover probe absence, migration receipts, private policy, core RPC grants and public catalog count. They do not replace a short live auth/plan/timer/room smoke.

## Hosted Realtime compatibility correction

The first actual apply reached024 and rolled that file back: the local installer tried to enable RLS on `realtime.messages`, which hosted `postgres` does not own. Read-only inspection of this project confirmed RLS already enabled, owner `supabase_realtime_admin`, no postgres membership in that role, and policy-management delegation through `supautils`. Supabase documents this exact limitation and says to manage policies without `ALTER TABLE` or role-membership workarounds. [Official troubleshooting](https://supabase.com/kb/troubleshooting/realtime-must-be-owner-of-table-messages), [authorization documentation](https://supabase.com/docs/guides/realtime/authorization).

The immutable migration is retained. The hosted runner substitutes only its installer function using `supabase/deployment/hosted_realtime_policy.sql`, records disposition `applied-hosted-realtime-policy`, and stores both source/effective SQL hashes plus adapter hash. The replacement asserts platform RLS/grants, retains the same capability-only SELECT rule, adds a restrictive read rule, and denies authenticated-user reads plus all client INSERT/UPDATE/DELETE with restrictive policies. Server-side broadcasting remains permitted. It does not alter the managed table, elevate postgres, or grant broader client access. This adapter was prepared for the root operator to apply; preparation alone is not proof it has run.

## Hosted dispatcher cron

`scripts/production-cron.mjs` and `supabase/deployment/hosted_dispatcher.sql` configure the owned `dima-dispatch-every-minute` job on `* * * * *`. The fixed command calls a private database function that reads `dima_jobs_token` from Vault and sends an empty JSON POST to `https://dima.study/api/internal/jobs/dispatch`, with a45-second timeout. It stores only request IDs/timestamps and retains its own request/cron history for7days. It preserves unrelated jobs. Re-running uses existing extensions instead of replaying hosted extension event triggers.

Configured and active on1November2026. A real scheduled invocation at11:57UTC returned HTTP200 with no timeout. `B7_HOSTED_CRON.json` records the result, job settings and checks. This proves the hosted dispatcher was reached and accepted that batch; it is not a sustained-load result or proof of a nonempty job settlement.

Vault encrypts the long-lived token. As documented by Supabase, `pg_net` temporarily places the decrypted Authorization header in its managed request queue. That queue has platform-granted SQL access that project `postgres` cannot revoke; a direct database operator can read it. It is **not exposed through the Data API**: `net`, `vault` and `dima_deploy` schema requests returned406/PGRST106, including an authenticated-role probe. No public callable SQL/queue/Vault RPC was found; app roles cannot execute the private dispatcher function. Keep these schemas unexposed and do not introduce arbitrary SQL RPCs. [Supabase scheduling documentation](https://supabase.com/docs/guides/functions/schedule-functions).

Read current status without modifying the schedule:

```sh
node scripts/production-cron.mjs --config /home/amro/.local/state/dima-production/connection.json --verify
```
