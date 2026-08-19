# Production Audit Gotchas

**Audience:** Engineers auditing, diagnosing, verifying, or repairing laSyncro production  
**Purpose:** Safe and repeatable access to production runtime state and tenant data without misreading RLS, using privileged credentials accidentally, auditing the wrong deployment, or turning a read-only investigation into an unintended mutation.

---

## 1. Why this playbook exists

Production auditing in laSyncro has several traps that can produce convincing but false conclusions.

Examples observed during production hardening include:

- a query returning `[]` even though the production rows existed;
- a production CLI printing `PGPASSWORD is undefined` even though the production DB connection was valid;
- `flyctl ssh console -C "cd /app && ..."` failing because `cd` is not an executable;
- a commit existing on `main` while an older Fly image was still running;
- a healthy `/health` endpoint not proving that a specific projection event had been processed;
- absence of a log line being mistaken for absence of a worker;
- local or historical candidate IDs being treated as current production truth;
- `systemQuery()` being mistaken for a PostgreSQL RLS bypass;
- a historical repair being considered complete before its domain events were consumed;
- inspecting only `inventory_truth` and treating negative stock as proof of corruption without checking the movement ledger.

This document defines the production-audit access model and the required safety rules.

---

# 2. Core production access model

Production has separate access classes.

They must not be confused.

```text
Engineer
   │
   ├── Public HTTP
   │     └── app.lasyncro.com
   │
   ├── Fly control plane
   │     ├── status
   │     ├── releases
   │     ├── logs
   │     └── SSH
   │
   ├── Runtime application machine
   │     └── restricted application DB identity
   │           sf_app
   │           NOSUPERUSER
   │           NOBYPASSRLS
   │
   └── Privileged migration access
         └── separate deployment-only path
             MIGRATION_DATABASE_URL
             Fly Postgres proxy
````

The runtime application and the migration system intentionally do **not** use the same database privilege level.

---

# 3. Runtime database credentials are deliberately restricted

Production application code uses:

```text
APP_DATABASE_URL
```

The production runtime must connect as:

```text
sf_app
NOSUPERUSER
NOBYPASSRLS
```

This is intentional.

Production application code is expected to experience the same RLS boundaries that normal requests and workers experience.

The privileged credential:

```text
DATABASE_URL
```

is reserved for migration execution.

It must not exist in the normal Fly application runtime.

The deployment workflow explicitly checks this and blocks deployment if `DATABASE_URL` is installed on the runtime application.

## Gotcha

Do not "fix" an audit that is being blocked by RLS by injecting privileged migration credentials into the runtime.

That destroys the exact security boundary the audit is supposed to exercise.

---

# 4. Preferred production-audit access path

For normal production investigation, prefer:

```text
flyctl ssh console
        ↓
running production application machine
        ↓
deployed repository/runtime
        ↓
restricted sf_app database connection
        ↓
withTenant(shopId)
```

This has several advantages:

- it uses the production application's actual DB configuration;
- it proves the deployed runtime has the code being inspected;
- it retains RLS;
- it avoids copying production DB credentials locally;
- it prevents accidental use of migration/superuser credentials;
- it exercises the same tenancy model as the application.

Use privileged database access only when the investigation explicitly requires it and the privilege boundary has been approved.

---

# 5. Never invent a production DB connection command

Do not infer a production connection from local `.env` values.

Do not assume production uses:

```text
PGHOST
PGPORT
PGUSER
PGPASSWORD
PGDATABASE
```

The production application uses:

```text
APP_DATABASE_URL
```

while local/test database configuration uses the discrete `PG*` variables.

If a direct production `psql` session is genuinely required, first establish the approved restricted connection mechanism.

Do not borrow:

```text
MIGRATION_DATABASE_URL
```

just because it already exists in CI.

That credential belongs to the privileged migration path.

---

# 6. `PGPASSWORD is undefined` is not automatically a production DB failure

Production scripts may print:

```text
WARNING: PGPASSWORD is undefined → defaulting to empty string
```

This warning is emitted by shared database configuration code.

In production the actual application connection is sourced from:

```text
APP_DATABASE_URL
```

rather than the development `PGPASSWORD` field.

Therefore:

```text
PGPASSWORD warning
≠
production database connection failure
```

Do not diagnose from the warning alone.

Verify the actual operation.

For example:

```text
query succeeds
tenant data returned
projection cursor returned
CLI produces production candidates
```

are stronger evidence than the generic warning.

A real connection failure should be established from the actual exception or failed query.

---

# 7. First rule of every production audit: prove what is actually deployed

Never assume:

```text
git HEAD
=
production
```

A commit being:

```text
on main
pushed to origin/main
green in unrelated CI
```

does not prove Fly is running it.

At the beginning of a production audit capture:

```zsh
cd /Users/miladarbabi/Codes/projects/SynchroFlow || return

print -r -- '=== LOCAL COMMIT ==='
git log -1 --oneline

print -r -- '=== FLY STATUS ==='
flyctl status -a synchroflow

print -r -- '=== FLY RELEASES ==='
flyctl releases -a synchroflow | head -20

print -r -- '=== PRODUCTION HEALTH ==='
curl -sS -i https://app.lasyncro.com/health
```

Record:

```text
local commit SHA
latest Fly release
Fly machine version
machine state
health checks
HTTP health result
```

Expected basic deployment state:

```text
latest Fly release = complete
machine = started
checks = passing
/health = HTTP 200
```

---

# 8. Health does not prove semantic correctness

A production health check proves approximately:

```text
process is alive
HTTP listener works
Fly can reach the service
```

It does **not** prove:

```text
projection caught up
specific worker succeeded
specific event was consumed
order constraint is correct
Shopify webhook subscription exists
batch release works
inventory ledger is correct
```

Use `/health` as a deployment/runtime gate, not as final business verification.

---

# 9. Verify critical deployed code inside the running machine

For important repairs, verify the running machine actually contains the expected code before invoking it.

Example:

```zsh
flyctl ssh console -a synchroflow \
  -C "grep -n repair:shopify-canonical-drift /app/apps/backend/package.json"
```

For safety gates:

```zsh
flyctl ssh console -a synchroflow \
  -C "grep -nE 'APPLY_REQUIRES_DOMAIN_EVENT_IDS|APPLY_CONFIRMATION_REQUIRED' /app/apps/backend/src/scripts/repair-shopify-rest-canonical-drift.ts"
```

This proves more than checking the local checkout.

It verifies the deployed filesystem.

---

# 10. Fly SSH `-C` does not behave like an interactive shell

This command is unsafe to assume will work:

```zsh
flyctl ssh console -a synchroflow \
  -C "cd /app && npm run some-script"
```

Observed failure:

```text
exec: "cd": executable file not found in $PATH
```

Reason:

```text
cd
```

is a shell builtin.

The `-C` command is being executed directly; shell syntax such as:

```text
cd
&&
||
pipes
redirection
environment expansion
```

requires an actual shell.

## Correct pattern

Wrap composite commands explicitly:

```zsh
flyctl ssh console -a synchroflow \
  -C "/bin/sh -lc 'cd /app && npm run some-script'"
```

Use the direct `-C` form only for simple executable commands such as:

```zsh
flyctl ssh console -a synchroflow \
  -C "grep -n pattern /app/file"
```

---

# 11. Shell quoting is a production-audit risk

Production audit commands often contain three quoting layers:

```text
local zsh
→ flyctl -C
→ /bin/sh -lc
→ node -e
```

A malformed quote can result in:

```text
quote>
```

or cause arguments to be concatenated incorrectly.

Recommended structure:

```zsh
flyctl ssh console -a synchroflow \
  -C "/bin/sh -lc 'cd /app && node --input-type=module -e \"...\"'"
```

When a command becomes very large:

- keep the JavaScript simple;
- avoid unnecessary shell interpolation;
- use literal numeric tenant IDs only after they have been verified;
- inspect output before running another command;
- never append a mutation to an already-complex verification command.

Do not paste markdown-formatted URLs into the shell.

Use:

```text
https://app.lasyncro.com/health
```

not:

```text
[https://app.lasyncro.com/health](...)
```

---

# 12. RLS is the biggest production-audit gotcha

Tenant tables are protected by PostgreSQL RLS.

A query can therefore return:

```json
[]
```

without throwing an exception.

That does **not** mean:

```text
record does not exist
```

It can mean:

```text
tenant context was not established
```

This is a critical distinction.

---

# 13. `systemQuery()` is not a PostgreSQL RLS bypass

`systemQuery()` bypasses the application-level tenant guard.

It does **not** disable PostgreSQL RLS.

This means:

```ts
await systemQuery(
  db('orders')
    .where({ lasyncro_order_id: orderId })
);
```

can legitimately return:

```json
[]
```

when running as `sf_app` without tenant context.

This exact failure mode was observed during production verification of a repaired order.

The order existed.

The query was wrong.

---

# 14. Use `withTenant()` for tenant-owned production data

For domain data use:

```ts
withTenant(shopId, async (trx) => {
  ...
})
```

Example:

```zsh
flyctl ssh console -a synchroflow \
  -C "/bin/sh -lc 'cd /app && node --input-type=module -e \"import {withTenant} from \\\"./packages/backend-core/dist/db.js\\\"; const result=await withTenant(1,async(trx)=>trx(\\\"orders\\\").limit(5)); console.log(JSON.stringify(result,null,2)); process.exit(0);\"'"
```

`withTenant()` establishes:

```text
PostgreSQL app.current_tenant
+
application AsyncLocalStorage tenant context
```

Both matter.

---

# 15. Raw `SET LOCAL` is not equivalent to `withTenant()`

This pattern:

```ts
db.transaction(async trx => {
  await trx.raw(
    "SET LOCAL app.current_tenant = '1'"
  );

  ...
});
```

can make queries made directly through that `trx` work.

But it does not establish application AsyncLocalStorage tenant context.

If a called service reaches for the global:

```ts
db(...)
```

instead of the supplied transaction, the tenant guard can report:

```text
TENANT_CONTEXT_MISSING
```

Therefore the default production-audit rule is:

```text
use withTenant()
```

not:

```text
manually recreate tenant handling
```

---

# 16. Never use plain `SET app.current_tenant` on pooled connections

Tenant context must not leak across pooled DB connections.

Use:

```text
SET LOCAL
```

or the project's `setTenantContext()` / `withTenant()` abstraction.

Plain:

```sql
SET app.current_tenant = '1';
```

can persist beyond the transaction on a reused physical connection.

That can result in one tenant's context being inherited by another operation.

For production audits:

```text
withTenant()
```

is the safest normal entry point.

---

# 17. Know which tables are tenant data and which are system data

Do not mechanically wrap every query in `systemQuery()`.

Typical tenant-owned data includes:

```text
orders
order_line_items
order_revenue_units
order_constraints
inventory_truth
inventory_movements
products
variants
customers
user_lifecycle_snapshot
ft0_state
ft2_state
system_readiness_state
```

These should normally be inspected under:

```text
withTenant(shopId)
```

System/infrastructure state can have different access semantics.

Examples include projection infrastructure queries already designed for system access.

Audit the source before assuming a table belongs to one category.

---

# 18. Never assume `shop_id = 1` globally

Many production audits in Shopify review hardening concerned:

```text
shop_id = 1
```

That does not make shop 1 a universal production constant.

Before auditing a new issue establish:

```text
target shop
external Shopify domain
internal shop_id
affected order IDs
```

Then use that explicit shop ID consistently.

Do not reuse a tenant ID merely because it appeared in an earlier incident.

---

# 19. Production HTTP and production DB answer different questions

Use the API when auditing:

```text
authentication
authorization
route behavior
response shape
user-visible workflow
Order Pool state
release behavior
```

Use the database when auditing:

```text
persisted canonical state
domain events
constraints
projection cursor
inventory truth
inventory ledger
batch membership
reconciliation decisions
```

Neither replaces the other.

A route returning `200` does not prove the DB state is correct.

A correct DB row does not prove the user-facing endpoint is working.

---

# 20. Prefer read-only audits before any production mutation

Every production command should be classified before execution.

## Clearly read-only examples

```text
flyctl status
flyctl releases
flyctl logs
curl GET /health
grep deployed source
SELECT queries
tenant-scoped inspection
projection cursor reads
audited CLI dry-run mode
```

## Mutation examples

```text
CLI --apply
POST batch/release
address correction
manual DB UPDATE/INSERT/DELETE
migration execution
webhook registration
reconciliation repair
constraint repair
inventory correction
release/order batching
```

Note:

```text
registerWebhooksForShop()
```

may not change laSyncro DB state but **does mutate Shopify external state**.

It is still a production mutation.

---

# 21. A script called "dry-run" is not automatically read-only

Before executing a production CLI in dry-run mode:

1. inspect the source;
2. identify the dry-run branch;
3. prove writes are not called;
4. verify apply requires an explicit switch;
5. preferably verify the exact deployed source inside the production machine.

Do not trust the label alone.

For the historical canonical repair, safe production execution was allowed only after its dry-run path and apply gates had been audited.

---

# 22. Always perform a fresh production dry-run

Do not use a historical audit result as the apply set.

Bad pattern:

```text
Yesterday we found events:
191,202,205,213,221,228,546

Therefore apply those today.
```

Correct pattern:

```text
historical audit
        ↓
implementation
        ↓
deployment
        ↓
fresh production dry-run
        ↓
compare current candidates
        ↓
only current production result may become apply set
```

Production state can change between audit and remediation.

---

# 23. Production candidate IDs are evidence, not permanent constants

Candidate IDs recorded in:

```text
handover
playbook
Slack
terminal output
issue notes
```

are historical evidence.

They are not instructions to mutate production later.

Before every apply operation regenerate the candidate set from current production.

If it differs:

```text
STOP
```

Audit the difference.

---

# 24. Verify the DB/projection consequences after a mutation

A successful CLI response is not closure.

Example:

```text
repair transaction committed
repair event inserted
```

does not prove:

```text
projection consumed event
constraints recalculated
Order Pool changed
inventory remained correct
```

Verification must continue downstream.

---

# 25. Domain-event repairs require projection verification

The authoritative path is:

```text
write canonical repair
        ↓
append domain event
        ↓
COMMIT
        ↓
DB projection worker
        ↓
projection handler
        ↓
constraint/reconciliation updates
        ↓
projection cursor advances
```

Do not manually call:

```text
processDomainEvent()
```

to "help" production catch up unless the architecture and issue explicitly require it.

The database projection worker is the authoritative consumer.

---

# 26. Projection cursor is an independent verification gate

If repair events end at:

```text
570
```

then a meaningful verification is:

```text
orders_projection.last_processed_event_id >= 570
```

Example system query:

```zsh
flyctl ssh console -a synchroflow \
  -C "/bin/sh -lc 'cd /app && node --input-type=module -e \"import db,{systemQuery} from \\\"./packages/backend-core/dist/db.js\\\"; const row=await systemQuery(db(\\\"projection_cursors\\\").where({projection_name: \\\"orders_projection\\\"}).first()); console.log(JSON.stringify(row,null,2)); await db.destroy();\"'"
```

Do not declare event-driven remediation complete before its events have been consumed.

---

# 27. Idempotency is a production closure gate

For an idempotent repair, rerun its read-only planner after apply.

Expected result should normally be equivalent to:

```text
candidateCount = 0
```

This independently proves the repaired records no longer satisfy the defect detector.

The sequence should be:

```text
pre-apply dry-run
→ apply
→ projection consumption
→ post-apply dry-run
```

---

# 28. Log absence is weak evidence

Example:

```zsh
flyctl logs -a synchroflow --no-tail \
  | grep projection-db-worker
```

returning nothing does not prove:

```text
projection worker did not start
```

`--no-tail` output may only contain a bounded recent log window.

Use logs to prove the presence of an observed event.

Do not normally use absence from a limited log buffer to prove an event never happened.

When stronger state exists, inspect it.

For projection:

```text
projection cursor
```

is stronger than not seeing a startup line.

---

# 29. Filtered logs can hide important context

This is useful:

```zsh
flyctl logs -a synchroflow --no-tail \
  | grep -E 'FATAL|ERROR|projection-db-worker'
```

but it is a filtered view.

If the result is ambiguous:

- inspect a wider log range;
- remove the filter;
- search for the exact timestamp;
- correlate against release time;
- correlate against machine ID.

Do not infer complete runtime history from `tail -120`.

---

# 30. Vercel success does not verify the Fly backend

Some commits can have successful Vercel checks for:

```text
web
marketing
```

while the backend is deployed separately on Fly.

Therefore:

```text
GitHub/Vercel green
```

does not prove:

```text
Fly backend deployed
```

Verify Fly independently.

# 30A. Vercel green does not prove `www.lasyncro.com` routes exist

`www.lasyncro.com` is served by `packages/landing-page`, while application-style marketing routes are served by `apps/marketing`.

Routes exposed through the marketing project must also be explicitly rewritten in:

```text
packages/landing-page/vercel.json
```

Observed failure:

```text
apps/marketing build = route exists
marketing Vercel deploy = green
www.lasyncro.com/help = 404
```

Root cause: `/help` was missing from the landing-page rewrite manifest.

For every new public marketing route, verify both:

```text
https://synchro-flow-marketing.vercel.app/<route>
https://www.lasyncro.com/<route>
```

A successful marketing deployment alone does not prove the public domain can reach the route.

---

# 31. Local build success does not prove clean deployment build success

Incremental TypeScript state can make a local build appear green while CI's clean build fails.

Observed class:

```text
local incremental build = green
CI tsc --incremental false = red
Fly deploy never builds image
```

When a production deploy unexpectedly fails after a source change:

- inspect CI build output;
- clean incremental state when appropriate;
- distinguish source/build failure from runtime failure.

Do not assume production is running a fix until the release itself is green.

---

# 32. Runtime filesystem path

The current Fly application runtime uses:

```text
/app
```

Important deployed code can therefore currently be inspected beneath:

```text
/app/apps/backend
/app/packages/backend-core
```

Do not treat this path as an eternal platform guarantee.

If the Dockerfile changes, verify:

```zsh
flyctl ssh console -a synchroflow \
  -C "ls /app"
```

before assuming file layout.

---

# 33. Do not print secrets while auditing

Avoid commands such as:

```text
env
printenv
echo $APP_DATABASE_URL
echo $DATABASE_URL
```

in production.

The goal is to verify behavior and identity, not expose credentials to terminal history or logs.

If credential presence must be checked, prefer a boolean/existence test.

Never copy a privileged migration URL into chat, issue notes, or shell history.

---

# 34. Verify runtime DB identity without exposing credentials

The expected production runtime identity is:

```text
current_user = sf_app
rolsuper = false
rolbypassrls = false
```

The codebase contains an explicit runtime identity assertion for this.

If a production query unexpectedly sees data that should be hidden by RLS, verify database identity before concluding RLS itself is defective.

Likewise, if privileged access unexpectedly appears available from normal runtime code:

```text
STOP
```

That is a security/deployment issue.

---

# 35. Empty rows require an RLS sanity check before diagnosis

If production unexpectedly returns:

```json
[]
```

ask in this order:

```text
1. Is this the correct production machine?
2. Is this the correct database runtime?
3. Is this the correct shop_id?
4. Is tenant context established?
5. Is this table protected by RLS?
6. Was systemQuery used incorrectly?
7. Only then: does the row actually not exist?
```

Do not start implementing a data repair after step 1.

---

# 36. Auditing an order means tracing the entire lifecycle

For order incidents do not inspect only:

```text
orders
```

A useful production order audit normally includes:

```text
retained Shopify event
        ↓
canonical mapper output
        ↓
orders
        ↓
order_line_items
        ↓
order_revenue_units
        ↓
fulfillment state
        ↓
order_constraints
        ↓
reconciliation state
        ↓
batch membership
        ↓
inventory_truth
        ↓
inventory_movements
        ↓
Order Pool eligibility
```

A defect can originate several stages upstream from the visible symptom.

---

# 37. Retained source is critical when auditing canonical drift

If a Shopify order appears malformed internally:

```text
missing address
missing line item
wrong quantity
wrong variant
```

first compare it against the retained source event.

Do not assume Shopify originally omitted the data.

Audit:

```text
source payload
→ mapper output
→ stored canonical row
```

This distinguishes:

```text
source-data defect
mapper defect
projection defect
later mutation
```

---

# 38. Never manually clear a constraint as the first repair

Example:

```text
customer constraint says incomplete address
```

Do not immediately execute:

```sql
UPDATE order_constraints
SET is_active = false;
```

The constraint may be correct given malformed upstream canonical data.

Correct process:

```text
inspect source
→ inspect canonical order
→ repair underlying fact if defective
→ emit normal domain signal
→ let evaluator resolve constraint
```

The projection/evaluator should own the conclusion.

---

# 39. Never repair only the address when demand is also missing

An order can simultaneously contain:

```text
false address defect
+
missing line-item demand
```

If only the address block is removed, that malformed order could become eligible even though its real demand is still absent.

For order lifecycle repairs always audit:

```text
address
AND
line demand
AND
fulfillment
AND
inventory
```

before changing eligibility.

---

# 40. Inventory truth alone is not enough

Never conclude inventory is corrupt solely because:

```text
on_hand < 0
```

or because the number looks surprising.

Compare:

```text
inventory_truth
```

against the ledger constructed from:

```text
inventory_movements
```

Relevant movement classes include:

```text
opening_balance
inbound_purchase
sale
refund_return
manual_adjustment
reconciliation_correction
damage
shrinkage
reservation_hold
reservation_release
```

The audit question is:

```text
Does inventory_truth agree with the movement ledger?
```

not:

```text
Does the number look intuitively correct?
```

Negative but ledger-consistent inventory may be a real business condition requiring a separate audit.

---

# 41. Historical repair must preserve present physical inventory unless explicitly intended otherwise

Reconstructing a historical sale today can incorrectly change current stock.

Example:

```text
historical missing sale = -3
```

If inserted alone today:

```text
current physical stock changes by -3
```

That is normally wrong for a canonical-history repair.

Historical reconstruction must explicitly define whether it is:

```text
economic/audit repair
physical inventory repair
both
```

Never assume these are the same operation.

---

# 42. Before/after inventory verification is mandatory for historical order repair

Capture affected inventory before mutation.

After repair verify both:

```text
current truth == pre-repair physical truth
```

and:

```text
current truth == post-repair movement ledger
```

A successful canonical repair that silently changes physical stock is not successful.

---

# 43. Batch membership is a repair blocker

Before modifying historical order demand verify whether the order belongs to a batch.

Historical demand reconstruction on an already-batched/picked/shipped order can interact with:

```text
reservations
inventory movements
operator work
fulfillment
```

A safe repair should normally fail closed if batch membership exists unless the repair was specifically designed for that state.

---

# 44. Revenue state is also a repair blocker

Before reconstructing missing line demand inspect:

```text
order_revenue_units
```

If revenue units already exist but disagree with the intended repair:

```text
STOP
```

Do not blindly insert more.

A repair must distinguish:

```text
missing
already clean
conflicting
```

---

# 45. Production mutation commands require explicit approval

A production audit can collect evidence without approval for every individual read.

A command that changes production state must be explicitly identified as a mutation and approved before execution.

Examples:

```text
--apply
POST release
webhook registration
inventory adjustment
constraint write
migration
address correction
batch creation
reconciliation repair
```

The approval should occur **after** the immediately preceding read-only evidence is reviewed.

---

# 46. Never combine audit and apply into one command block

Bad:

```zsh
run dry-run
&&
run apply
&&
run verification
```

If the dry-run result differs from expectations, the mutation would still be too easy to execute unintentionally.

Correct operational pattern:

```text
AUDIT COMMAND
↓
paste output
↓
review
↓
explicit approval
↓
MUTATION COMMAND
↓
paste output
↓
read-only verification
```

This is slower by design.

---

# 47. Do not run multiple unrelated production mutations together

If repairing:

```text
canonical order
```

do not simultaneously:

```text
release batch
repair inventory discrepancy
register webhooks
clear constraints
```

Separate issues provide:

```text
smaller blast radius
clear rollback reasoning
clear evidence
clear ownership of resulting state
```

---

# 48. Production repair commands must target an explicit scope

Safe production mutations should prefer:

```text
shop ID
explicit order/event IDs
confirmation token
```

over:

```text
all
latest
everything matching
```

A bulk mutation whose candidate set is computed inside the same apply transaction provides less human review than:

```text
dry-run exact set
→ approve exact set
→ apply exact set
```

---

# 49. Post-mutation verification must be independent

Do not merely trust the mutation's own result object.

Use a second verification mechanism.

Examples:

```text
repair CLI says 7 repaired
+
post-repair planner says 0 remaining
+
projection cursor reaches repair event
+
tenant-scoped DB reads show corrected state
+
inventory ledger remains consistent
```

Independent evidence catches defects in the repairer's own assumptions.

---

# 50. Re-read through the correct tenant context after every repair

After a production repair inspect:

```text
orders
line items
constraints
inventory
```

through:

```text
withTenant(shopId)
```

Do not switch to `systemQuery()` merely because the repair itself succeeded.

That can turn correct production state into false empty results.

---

# 51. A repaired blocker can reveal the next legitimate blocker

This is expected.

Example lifecycle:

```text
before:
customer/address blocked

repair correct address
        ↓

after:
customer block resolves
inventory block activates/remains
```

This is not a failed repair.

It can be proof that the constraint system is behaving correctly.

Do not define success as:

```text
order becomes Ready
```

Define success as:

```text
order state now reflects the true underlying facts
```

---

# 52. Do not force an order into the Order Pool

The Order Pool should be an outcome of:

```text
canonical facts
fulfillment state
constraints
inventory
batch state
```

not something repaired directly.

If an order is expected to become Ready:

1. repair/correct the underlying condition;
2. verify the appropriate domain event;
3. verify constraint reevaluation;
4. verify constraint resolution;
5. then observe Order Pool inclusion.

---

# 53. API CTA tests are production mutations when the CTA changes state

Selecting an order checkbox is generally observational.

Actually pressing:

```text
Release
```

is not.

Batch release can create:

```text
pick batch
pick_batch_orders
reservation_hold movements
reserved inventory
```

There is no generic safe "undo" assumption.

A Release CTA production test therefore requires explicit mutation approval.

---

# 54. Do not assume a UI CTA is defective from an upstream failure

If release fails, audit:

```text
order eligibility
line demand
constraints
inventory
batch state
release request payload
reservation allocation
```

before calling the button defective.

A correctly functioning button can expose a backend eligibility defect.

Likewise a blocked order can make the CTA correctly unavailable.

---

# 55. Shopify webhook registration is an external production mutation

Running webhook reconciliation/registration can change:

```text
Shopify app-owned webhook subscriptions
```

even if laSyncro database rows are unchanged.

Therefore classify it as:

```text
production mutation
```

and verify afterward:

```text
expected topic count
actual topic count
missing topics
unexpected topics
duplicates
callback URL
API version
```

---

# 56. Development-store/manual webhooks are not production app subscriptions

Do not mix:

```text
manual dev-store webhooks
ngrok callbacks
```

with:

```text
production app-owned webhook subscriptions
```

They have different purposes and ownership.

An audit of one must not mutate the other.

---

# 57. Production audit checklist

Before beginning:

```text
[ ] Confirm issue scope
[ ] Confirm target shop
[ ] Confirm target order/event IDs
[ ] Confirm local HEAD
[ ] Confirm Fly release
[ ] Confirm machine started
[ ] Confirm health checks passing
[ ] Confirm /health HTTP 200
```

Before reading tenant data:

```text
[ ] Use production runtime
[ ] Use restricted sf_app path
[ ] Use withTenant(shopId)
[ ] Do not print secrets
[ ] Do not use migration credentials
```

Before interpreting empty results:

```text
[ ] Confirm tenant context
[ ] Confirm RLS semantics
[ ] Confirm correct shop
[ ] Confirm correct deployment
```

Before mutation:

```text
[ ] Audit complete
[ ] Fresh production state captured
[ ] Exact candidate set identified
[ ] Candidate set contains no blockers
[ ] Blast radius understood
[ ] Mutation command reviewed
[ ] Explicit approval received
```

After mutation:

```text
[ ] Mutation result reviewed
[ ] Projection consumption verified
[ ] Post-repair dry-run performed where applicable
[ ] Canonical state independently queried
[ ] Constraints independently queried
[ ] Inventory truth verified
[ ] Inventory ledger verified
[ ] Physical inventory preservation checked where required
[ ] User-facing/API behavior checked where required
```

---

# 58. Standard Fly production audit commands

## Deployment state

```zsh
print -r -- '=== FLY STATUS ==='
flyctl status -a synchroflow

print -r -- '=== FLY RELEASES ==='
flyctl releases -a synchroflow | head -20

print -r -- '=== PRODUCTION HEALTH ==='
curl -sS -i https://app.lasyncro.com/health
```

## Simple deployed-source inspection

```zsh
flyctl ssh console -a synchroflow \
  -C "grep -n '<PATTERN>' /app/<PATH>"
```

## Composite runtime command

```zsh
flyctl ssh console -a synchroflow \
  -C "/bin/sh -lc 'cd /app && <COMMAND>'"
```

---

# 59. Standard tenant-scoped production read template

```zsh
flyctl ssh console -a synchroflow \
  -C "/bin/sh -lc 'cd /app && node --input-type=module -e \"import {withTenant} from \\\"./packages/backend-core/dist/db.js\\\";

const result=await withTenant(<SHOP_ID>,async(trx)=>{
  return trx(\\\"<TABLE>\\\")
    .where({shop_id:<SHOP_ID>})
    .select(\\\"<COLUMN>\\\");
});

console.log(JSON.stringify(result,null,2));
process.exit(0);\"'"
```

Replace:

```text
<SHOP_ID>
<TABLE>
<COLUMN>
```

only after verifying the target.

For complex audits, return one JSON object containing the related tables so the evidence remains correlated.

---

# 60. Standard production CLI dry-run pattern

First prove the deployed script exists.

Then:

```zsh
flyctl ssh console -a synchroflow \
  -C "/bin/sh -lc 'cd /app && npm run <SCRIPT> -w apps/backend -- <READ_ONLY_ARGS>'"
```

Verify from source that:

```text
<READ_ONLY_ARGS>
```

cannot enter apply mode.

Paste and review the complete result before any mutation.

---

# 61. Standard evidence block for an order audit

A production blocked-order audit should ideally capture:

```text
PRODUCTION RELEASE
SHOP ID

ORDER
  lasyncro_order_id
  external_order_id
  aggregate_version
  payment_state

SOURCE
  retained event id
  event type
  event time
  source shipping
  source line items

CANONICAL
  stored shipping
  order line items

DEMAND
  revenue units
  quantity
  fulfilled quantity
  remaining quantity

FULFILLMENT
  normalized state

CONSTRAINTS
  type
  target
  active
  started
  resolved

RECONCILIATION
  decisions
  checkpoint

BATCH
  membership

INVENTORY
  truth
  movements
  calculated ledger

ORDER POOL
  included / excluded
  reason

VERDICT
  legitimately blocked
  stale block
  false block
  insufficient evidence
```

This prevents "single-table debugging."

---

# 62. Required evidence language

Use:

```text
VERIFIED
OBSERVED
NOT OBSERVED
NOT YET VERIFIED
INFERENCE
```

appropriately.

Do not write:

```text
worker did not start
```

when the evidence is only:

```text
worker startup line was not present in the limited log output inspected
```

Do not write:

```text
order does not exist
```

when the evidence is only:

```text
an RLS-unscoped query returned []
```

Precision in audit language prevents incorrect implementation work.

---

# 63. Stop conditions

Stop the audit and do not mutate if any of the following occurs:

```text
production deployment cannot be identified
tenant/shop identity is uncertain
RLS behavior is uncertain
fresh candidate set differs from historical audit
repair candidate has batch membership
repair candidate has conflicting revenue state
inventory truth and ledger disagree
source event is missing
external/internal identity cannot be resolved
projection is behind unexpectedly
apply command scope is broader than approved
runtime appears to have privileged DB access
```

Each is a new audit question.

Do not "work around" the stop condition.

---

# 64. Production audit vs production deployment

This playbook concerns:

```text
observing and verifying production state
```

For:

```text
migration deployment
checksum handling
release-command credentials
failed migration recovery
Fly deployment sequencing
```

use:

```text
docs/playbooks/production_deploy_gotchas.md
```

The two documents intentionally describe different privilege boundaries.

---

# 65. Principle to carry forward

The production audit environment is part of the system being audited.

A query executed:

```text
against the wrong deployment
with the wrong tenant context
under the wrong database identity
through the wrong access path
```

can produce technically valid output and still lead to a completely wrong engineering conclusion.

Therefore:

```text
PROVE ACCESS
→ PROVE DEPLOYMENT
→ PROVE TENANT
→ READ
→ CORRELATE
→ CONCLUDE
→ ONLY THEN REPAIR
```

That sequence is mandatory for production bug hunting.
