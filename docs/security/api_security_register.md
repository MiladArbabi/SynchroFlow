# API Security Register — SynchroFlow

Durable records for consequential **API / authentication / tenant-isolation**
security defects.

Scope note: defects whose root cause and fix live in PostgreSQL Row Level
Security belong in [RLS_blueprint.md](./RLS_blueprint.md). This register covers
the layer above it — route mounting, authentication middleware, and how request
input is allowed to select a tenant. An endpoint that never reaches Postgres has
no RLS to fall back on, which is exactly the class of defect recorded here.

Each entry states the defect, the runtime proof, the resolution, the permanent
regression contracts, and what production certification still requires. Entries
are not marked CLOSED until production checks pass.

---

## SEC-SPECTER-FT2-UNAUTH-01 — retired unauthenticated tenant-selectable Specter FT2 endpoint

**Status:** IMPLEMENTED + LOCALLY VERIFIED — **NOT YET PRODUCTION CERTIFIED**

Discovered during the DEPRECATED-FEATURE-RETIREMENT-01 audit and split out as a
separate security issue, so it could be triaged on security timelines rather
than retirement timelines.

### Defect

Production mounted:

```
GET /api/v1/specter/ft2
```

with **no `authenticateToken`** and **no entitlement/tier middleware**
(`apps/backend/src/api/specter/specter.routes.ts`, mounted at
`bootstrap/express.ts` under `/api/v1/specter`). Its sibling routes `/state` and
`/config` all carried `authenticateToken + requireTier('growth')`; `/ft2` alone
did not.

The handler accepted a client-controlled header as the tenant identifier:

```ts
// specter.ft2.controller.ts
const shopId =
  Number(req.headers['x-test-shop-id']) ||   // attacker-controlled, checked FIRST
  Number((req as any).shopId);                // never populated — no middleware ran
```

`x-test-shop-id` had no `NODE_ENV` guard and was stripped by no middleware. It
was the only occurrence of that header in production source.

**RED runtime proof** (real Express app, supertest):

| request | response |
|---|---|
| unauthenticated, no header | `400` |
| unauthenticated, `x-test-shop-id: 1` | **`200`** |
| unauthenticated, `x-test-shop-id: 999999` | **`200`** |
| authenticated, no tenant header | `400` |

An unauthenticated caller could therefore select an arbitrary tenant and receive
that tenant's Specter FT2-derived exposure. Shop `999999` — a tenant no caller
could own — returned `200`.

**Impact, bounded honestly:**

- Specter telemetry is documented in-source as anonymous and derived, not
  customer PII (`specterFacts.service.ts`: "Specter ingests anonymous sessions
  only", "No customer entity store exists", "No identity joins are possible").
- The response is derived facts and absence signals; an empty store yields an
  absence snapshot.
- Tenant selection was nevertheless **fully attacker-controlled**, with no
  authentication and no compensating control — the path never touches Postgres,
  so RLS offered nothing.
- Treated as a real tenant-isolation / authentication defect, not a
  documentation issue.

### Approved resolution

Deprecated functionality is **not** secured or preserved. The endpoint is
retired completely:

```
GET /api/v1/specter/ft2  ->  404
```

for unauthenticated callers, callers supplying `x-test-shop-id`, arbitrary
tenant ids, and authenticated callers alike.

`404` is the contract, deliberately **not** `401`/`403`: a gated-but-present
route would mean the probe still exists.

Implementation:

- removed the `/ft2` registration from `specter.routes.ts`
- removed the router's `httpGetSpecterFt2` dependency
- deleted the orphaned `specter.ft2.controller.ts` (its only export, with zero
  remaining production callers — proven by tracked-source search before deletion)
- deleted the obsolete unit test that certified the vulnerable `200` response
  (`tests/unit/backend/specter/specter-ft2.controller.test.ts`)

The authenticated Specter `/state` and `/config` routes remain **untouched**,
pending `DEPRECATED-FEATURE-RETIREMENT-01`. No broader Specter retirement was
performed here.

### Permanent regression protection

| layer | file |
|---|---|
| API | `tests/integration/security/specter-ft2-unauthenticated.test.ts` |
| Architecture | `tests/contract/specter-ft2-endpoint-retired.contract.test.ts` |

Together they prove:

- `/ft2` is **absent, not merely gated** — 404 asserted for all four caller shapes
- no executable production `x-test-shop-id` tenant-selection path remains
- the mounted Specter router is still present, so the still-live `/state` and
  `/config` keep working
- scanner controls prevent vacuous static passes: the AST analyzer is verified
  against a synthetic router that DOES register `/ft2` (must detect it) and one
  where the registration and symbol appear only in comments (must not), and a
  CONTROL asserts `/state` + `/config` survive so the contract cannot be
  satisfied by deleting Specter wholesale

### RED -> GREEN evidence

**RED**

- API: the 4 required retirement assertions failed; actual `400 / 200 / 200 / 400`
- Architecture: the 3 required assertions failed (live `/ft2` registration, live
  `httpGetSpecterFt2` import + handler reference, live `x-test-shop-id` selector)
- the direct exploit cases with caller-selected tenants returned `200`

**Target GREEN**

- API: **5 / 5**
- Architecture: **6 / 6**

**Automated verify**

- API: 5 / 5
- Architecture: 6 / 6
- backend TypeScript: **0 errors**
- executable `req.headers['x-test-shop-id']` production search: **0 occurrences**
- `git diff --check`: clean

### Unresolved unrelated evidence

Two surviving deprecated-Specter suites currently fail 12 / 12:

- `tests/unit/backend/specter/specter-ft2.provider.test.ts`
- `tests/unit/backend/specter/specterFtep.service.test.ts`

**Adjudication: PRE-EXISTING / OUT OF SCOPE.**

Proof: the implementation, service and test surfaces those suites cover have
**zero diff** against HEAD for this security slice, while every direct security
contract and backend TSC are green. This slice changed only the route
registration, the deleted controller, and the deleted obsolete controller test —
none of which those suites exercise.

Do **not** repair those suites under `SEC-SPECTER-FT2-UNAUTH-01`. They belong to
`DEPRECATED-FEATURE-RETIREMENT-01` / existing Specter test debt.

### Production certification required after deploy

Verify against production:

```
GET https://synchroflow.fly.dev/api/v1/specter/ft2
```

must return **404**:

- without credentials
- with `x-test-shop-id: 1`
- with `x-test-shop-id: 999999`

Also verify:

```
GET https://synchroflow.fly.dev/api/v1/specter/state
```

remains protected — **401** unauthenticated.

**Do not mark CLOSED / PRODUCTION CERTIFIED until those checks pass.**
