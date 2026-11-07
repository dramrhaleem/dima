# Dima B0 local backend

This is a deliberately small **local development subset**: official Supabase Auth (GoTrue), PostgreSQL, and PostgREST, with a loopback Node HTTP router. It is not a production deployment, not the complete Supabase CLI stack, and does not validate Realtime, Storage, Google OAuth, SMTP, or hosted Supabase configuration.

## Start, verify, stop

From the Dima repository root (Node 22 + Docker Engine/Compose):

```bash
node scripts/local-backend/start.mjs
node tests/backend/verify.mjs
node scripts/local-backend/stop.mjs
```

Start is repeatable and retains data; stop halts only Dima B0 services and preserves the database. No reset/delete command is supplied. The setup creates `dima-b0-db`, `dima-b0-auth`, `dima-b0-rest`, a Compose network, and a dedicated `dima-b0-postgres-data` volume. Existing containers/volume with those names but foreign Compose ownership cause setup to refuse.

Required ports bind only `127.0.0.1`: gateway 54321, PostgreSQL 54322, Auth 54323, REST 54324. No external accounts or credentials are used. The test makes synthetic `@example.test` accounts through real Auth; autoconfirm is **local only**. The gateway validates the local anonymous API key and allows only explicit local browser origins. It is not designed for public hosting.

Generated runtime files live in `~/.local/state/dima-b0` (0700), credentials 0600. `DIMA_BACKEND_ROOT` can override this only to a filesystem supporting private POSIX permissions. The mounted Data2 drive is NTFS/fuseblk and could not satisfy PostgreSQL ownership; the dedicated Docker volume therefore lives on the Linux filesystem. Keep at least several hundred MB free for Docker/image/database overhead and monitor growth.

- `client.env`: `SUPABASE_URL` and the generated local `SUPABASE_ANON_KEY`.
- `docker.env`: database password and JWT signing secret. Never load into web/mobile bundles.
- `test-accounts.json`: synthetic test-only email/password/accessToken/userId pairs, for local integration tests. Never commit or print.
- `backend-verification.json`: sanitized results and timestamp.
- `gateway.pid` / `gateway.log`: local process state; no request tokens are logged by the gateway.

Use the client environment to connect `@supabase/supabase-js` normally. Its URL is `http://127.0.0.1:54321`; standard `/auth/v1` and `/rest/v1` requests are forwarded. The web API must verify the user token and pass the caller JWT to database operations; it must not use a privileged key. `client.env` deliberately contains **no service-role key**.

## Schema and proof boundary

`supabase/migrations/20261031180000_foundation_checks.sql` creates the B0-only table `public.foundation_checks`: UUID id, owner_id referencing Auth users, a 1–120-character label, and server created_at. PostgreSQL RLS enables owner SELECT and INSERT only. Anonymous access, forged ownership, UPDATE, and DELETE are not granted. This table is infrastructure proof, not course progress; do not deploy it to production and remove the probe before B7.

Bootstrap SQL adds the minimal local roles/auth schema and an `auth.uid()` function reading PostgREST JWT claims. GoTrue runs its own real Auth migrations. The application migration is applied transactionally once and recorded in the private `dima_local.migrations` table. `supabase/seed.sql` intentionally stores no fixed users or passwords. Subsequent business changes require new migrations; do not modify an applied migration in place.

The B0 test verifies actual signup/login, user-token validation, owner write/read, cross-account isolation, forged-owner rejection, anonymous rejection, DB length validation, unavailable-update rejection, duplicate ID rejection, and local origin rejection. It retains its synthetic fixture so repeated runs also exercise password login and persistence. Re-running creates one new owner-only proof row. No user/project data is touched.

## Pinned components and source

Images are pinned by tag and digest in `compose.yaml`: PostgreSQL 17 Alpine (already installed), GoTrue v2.197.0, PostgREST v14.18. Auth/REST versions and environment shape were checked against the maintained [official Supabase Docker configuration](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml) on 2026-10-31. This custom minimal subset trades full local feature parity for a smaller B0 footprint. Revisit the full CLI stack or a separate development Supabase project before building Realtime/storage features.
