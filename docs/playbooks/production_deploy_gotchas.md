Good instinct — several of these will cost hours to re-derive otherwise. Here's what I'd capture, split by where it belongs.

1. Append to shopify_submission_playbook.md

The Reviewer Test Account section is now partly wrong — it says Scale is granted via SQL, but doesn't record which shop the reviewer actually lives on.

zsh
cd ~/Codes/projects/SynchroFlow
cat >> docs/playbooks/shopify_submission_playbook.md <<'EOF'

### Reviewer account — actual state (verified 2026-08-02)

`contact@lasyncro.com` lives on **shop_id 1 ("Shopify's Shop")** — the general
dev tenant — on **Scale** tier. This is the account Shopify reviewers log into.

`apps/backend/src/scripts/seed_reviewer.ts` creates a *different* tenant,
shop_id 8 ("LaSyncro Demo Store"), which has **0 users and is unreachable**.
The script's existing-user check is `SELECT * FROM users WHERE email = ?` with
no `shop_id` filter, so it matched the shop-1 user, skipped the insert, and
left shop 8 with a floor plan and entitlements but nobody who can log in.
The script also provisions Growth, not Scale.

**Consequence:** the reviewer seed script has never produced a usable tenant.
Any reviewer-facing data work must target shop 1. Fix the email lookup to
`WHERE email = ? AND shop_id = ?` before that script is used for anything.
EOF
2. New file — docs/playbooks/production_deploy_gotchas.md

The PROD-DEPLOY-3 lesson is the most expensive one in the sprint and isn't recorded anywhere.

zsh
cd ~/Codes/projects/SynchroFlow
cat > docs/playbooks/production_deploy_gotchas.md <<'EOF'
# Production Deploy — Gotchas

## Failed releases are silent

A failing `release_command` aborts the deploy *before* machine swap. Production
keeps serving the previous version with passing health checks and no alert.
On 2026-08-01 we found v238–v242 had all failed on Jul 29, leaving production
on the **Jul 28 build for four days** while the app was under App Store review.

**Check `flyctl releases --app synchroflow | head -5` before assuming a fix is
live.** A green `flyctl deploy` scrollback is not proof — read the last lines.

## Migration checksum drift

`runMigrationsWithChecksum.js` hashes every compiled `.js` in `dist/migrations`
and aborts if any hash differs from `migration_checksums`. Two properties make
this painful:

1. **It throws on the first mismatch**, alphabetically. Each failed deploy
   reveals exactly one drifted file, at ~2.5 min per cycle, with no indication
   of how many remain. (PROD-DEPLOY-3a: collect all mismatches, throw once.)
2. **A forward migration cannot fix drift.** Validation runs *before*
   `db.migrate.latest()`, so a new migration that would repair the checksum row
   is unreachable. Reconciliation must be a direct UPDATE on
   `migration_checksums`.

### Amending a base migration that already ran in production

Only safe when the amendment is a genuine no-op on already-migrated databases
(e.g. wrapping `up()` in a `hasTable` guard). Procedure:

1. Verify the migration's objects already exist in prod (tables, columns, FKs).
2. Diff **all** recorded checksums against a fresh local build before deploying,
   so you learn the true drift count in one pass:

psql "$PGURL" -At -F'|' -c "select name, checksum from migration_checksums order by name" > /tmp/prod-checksums.txt
cd apps/backend && npm run build
cd dist/migrations && shasum -a 256 *.js | awk '{print $2"|"$1}' | sort > /tmp/local-checksums.txt
join -t'|' /tmp/prod-checksums.txt /tmp/local-checksums.txt | awk -F'|' '$2 != $3 {print $1}'

3. UPDATE the checksum row(s) to the new hash. Deploy.

Prefer a forward migration whenever the change is not a no-op.

**PROD-DEPLOY-3b (open):** the guard hashes compiled `.js`, so a tsc version or
tsconfig change would flag all ~134 migrations as drifted with zero source
changes. Hash the `.ts` instead.

## Prod database access

flyctl proxy 5434:5432 -a synchroflow-db # terminal 1, foreground
export PGURL=$(flyctl ssh console -a synchroflow -C "printenv DATABASE_URL" 2>/dev/null
| tr -d '\r' | grep '^postgresql://'
| sed 's/synchroflow-db.flycast/localhost/' | sed 's/:5432/:5434/')
psql "$PGURL" # terminal 2

The app machine has no `psql` binary — use the proxy, not `ssh console`.

## Local does not reproduce prod

`dev:full-seed` starts with `db:reset` and produces a tenant whose zones are all
parented to `WH-1-ROOT`. Production zones are largely **unparented**. FP-201 was
invisible locally for exactly this reason. When a bug reproduces in prod but not
locally, compare the *data shape* before suspecting the code.

## Access tokens expire in 15 minutes

Long enough to start a build, not long enough to finish one. Grab the token
after the deploy completes, not before:

copy(localStorage.getItem('accessToken')) // DevTools console
