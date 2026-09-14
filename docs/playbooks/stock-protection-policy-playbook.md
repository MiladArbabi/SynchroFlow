# LaSyncro — Stock Protection Policy Playbook (STOCK-PROTECT-01)

> **Status:** ✅ Implemented, live and verified — 2026-09-11.

This is the canonical reference for the Stock Protection Policy foundation.
It exists to stop future work from reintroducing the fragmented planning
assumptions it replaced: a hardcoded 5/7-day default with no merchant
override, a supplier lead time that silently followed whichever PO was most
recent, and a location-blind inventory sum that counted receive/returns/pack/
ship/kitting/problem/quarantine stock as sellable.

## 1. What It Is

**Grain: shop + variant.** One current policy row per shop+variant.

**Merchant-authoritative fields** — the ONLY things a policy stores as
current authority:
- `safety_days`
- `review_cycle_days`
- `planning_supplier_id`
- `version`
- approval provenance (`source`, `approved_by_actor_type`,
  `approved_by_actor_id`, `approved_at`)

**Derived intelligence is never policy authority** and is never written to
the current-policy row: velocity, current inventory quantity, buffer units,
reorder point, urgency, estimated stockout date, suggested reorder quantity.
All of these are computed fresh, every read, by
`demandIntelligence.service.ts` — they are outputs of the policy, never
inputs stored alongside it.

## 2. No-Policy Fallback

A shop+variant with no approved policy row is not "unconfigured" — it has an
effective policy of `safety_days=5`, `review_cycle_days=7`,
`source=system_default`. This is the same behaviour that was previously
hardcoded as `SYSTEM_SAFETY_DAYS`/`SYSTEM_PURCHASING_CYCLE_DAYS` constants in
`demandIntelligence.service.ts`; it now has exactly one source of truth:
`resolveEffectivePolicy(null)` in
`apps/backend/src/services/inventory/stockProtectionPolicyResolution.ts`.

## 3. Approval Scope

An approved policy overrides the default **only for its own shop+variant.**
Approving a policy for one variant has no effect on any other variant's
effective policy, approved or not.

## 4. Supplier Authority

- If an approved policy sets an explicit `planning_supplier_id`, that
  supplier is authoritative for planning lead time. A newer purchase order
  placed with a different supplier does **not** silently reassign it.
- If no approved policy exists, or an approved policy has no explicit
  supplier anchor, planning falls back to the legacy behaviour: the supplier
  on the variant's most recently created purchase order.
- If the anchored supplier becomes invalid or inactive, planning fails
  **visibly** — the existing `planning_data_required` state (already used
  elsewhere in Demand for "lead time not configured") — rather than silently
  substituting a different supplier or guessing.

## 5. Planning Availability

Available inventory for planning is now fulfillment-consistent, not
location-blind. It reuses the single canonical predicate,
`pickableLocationCondition()` in
`apps/backend/src/services/inventory/pickableLocation.ts` — the same
predicate `batchReservation.service.ts` and the inventory constraint
evaluator already use for pick allocation. Receive, returns, pack, ship,
kitting, problem, and quarantine stock are real stock but not sellable-from,
and are excluded from the planning sum exactly as they are from pick
allocation.

V1 still aggregates all eligible pickable locations across the shop as one
network-wide available quantity. Per-warehouse policy is explicitly
deferred — see §9/§10 (STOCK-PROTECT-07).

## 6. Persistence & History

Migration `0171_create_stock_protection_policy.ts`:

- **`stock_protection_policies`** — current authoritative state only. One
  row per shop+variant (`UNIQUE(shop_id, lasyncro_variant_id)`), forced
  tenant RLS.
- **`stock_protection_policy_transitions`** — append-only history. Forced
  tenant RLS; `UPDATE`/`DELETE` rejected at the database level for every
  role (mirrors the `shop_subscription_transitions` / `decision_interventions`
  precedent).

Every material create/change writes the current row and exactly one
transition row in the same transaction. History captures:
- the complete before/after authoritative state (`from_*` / `to_*` for
  version, safety_days, review_cycle_days, planning_supplier_id)
- `source`, `reason`, `actor_type`, `actor_id`
- a `recommendation_snapshot` (JSONB) of what LaSyncro recommended at that
  exact moment

A resubmission that would not change authoritative state writes **no**
transition and does not bump `version`.

**The recommendation snapshot is evidence only.** It is written to history
for audit/context and is never read back as future planning input —
`resolveEffectivePolicy` never queries the transitions table at all.

## 7. Concurrency

Modifying an existing policy requires `expected_version` (optimistic
concurrency). A stale writer — one whose `expected_version` no longer
matches the current row — is rejected with a conflict; it produces no
current-state change and no history row. No lost updates, no duplicate
history, no partial current/history write.

## 8. Demand Planning Integration

`computeVariantPlanning` in `demandIntelligence.service.ts` remains the
**single canonical planning formula.** STOCK-PROTECT-01 changed its inputs
(effective safety days, effective review-cycle days, effective/anchored
supplier lead time, pickable-only availability) — it did not, and must not,
introduce a second reorder-sizing engine. Sourcing continues to consume this
same canonical signal (see `sourcing-recommendation-playbook.md` §14).

Demand recomputation is read-only with respect to policy: every GET can
change the derived buffer/reorder-point/suggested-quantity/urgency numbers
it returns, but it never updates, versions, or appends history to
`stock_protection_policies`.

## 9. API Surface

Under the existing `demand.forecasting` capability gate
(`apps/backend/src/api/demand/demand.routes.ts`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/modules/demand/stock-protection-policy/:variantId` | Effective policy (approved or system default) |
| PUT | `/api/v1/modules/demand/stock-protection-policy/:variantId` | Approve/create or change a policy; `expectedVersion` required to modify an existing one, stale value → `409` |

Both delegate entirely to `stockProtectionPolicy.service.ts`; the controller
owns no business logic.

## 10. What STOCK-PROTECT-01 Does NOT Solve (deferred)

- Evidence-driven buffer diagnosis
- Proactive lifecycle consolidation
- Scheduled monitoring
- `low_stock_reorder` / `stockout_risk` alert consolidation
- Stockout learning/recalibration
- Value Ledger
- Per-warehouse protection
- Approval UI (frontend)

## 11. Next Slices

- **STOCK-PROTECT-02** — Buffer Diagnosis
- **STOCK-PROTECT-03** — Unified Replenishment Lifecycle / monitoring — Slices 1–5 complete; Slice 6 implemented and locally verified; production cutover certification pending
- **STOCK-PROTECT-04** — WAITING read model
- **STOCK-PROTECT-05** — Protection Failure Diagnosis
- **OUTCOME-VALUE-01** — Verified Value Ledger
- **STOCK-PROTECT-06** — Impact UX
- **STOCK-PROTECT-07** — Multi-location Protection

**STOCK-PROTECT-02 is now implemented** — see
`stock-protection-buffer-diagnosis-playbook.md` for full detail. The
boundary between the two slices is exact: STOCK-PROTECT-01 (this document)
is the approved merchant policy — the only authority planning actually
consumes. STOCK-PROTECT-02 is a read-only recommendation/diagnosis layer
that reads evidence and proposes a `safety_days` value, but never writes to
`stock_protection_policies` or `stock_protection_policy_transitions`. A
recommendation becomes policy **only** when a merchant explicitly approves
it through the existing `PUT` route below — it never becomes policy
silently.

## 12. Verification Evidence (2026-09-11)

| Gate | Result |
|---|---|
| Unit + architecture/static contract | 2 suites / 6 tests PASS |
| Integration (migration, mutation/history/resolution contract, concurrency) + neighbour regression (`sourcing-worklist-contract`, `sourcing-targeted-contract`, `inventory-treatment-assist-contract`, `inventory-outcome-attribution`) | 7 suites / 117 tests PASS |
| Disposable integration DB | created → migrated → runtime OK → dropped, orphan `synchroflow_test_*` count = 0 |
| Tenant isolation (RLS) | cross-tenant write to `stock_protection_policies` explicitly rejected — confirmed by the database's own row-level-security error, not by the table being absent |
| Backend TypeScript (`tsc --noEmit`) | 3 pre-existing unrelated errors (Stripe API-version literals in `apps/backend/src/api/billing/*`, untouched by this work); 0 errors in any STOCK-PROTECT-01 file |

---

## 13. STOCK-PROTECT-03 — Unified Replenishment Lifecycle / Monitoring

**Status (2026-09-14): Slices 1–5 complete; Slice 6 implemented and locally verified.**
Production cutover remains pending commit/push, CI/deploy, and risk-based
production certification.

### Objective

STOCK-PROTECT-03 turns fragmented replenishment evidence into one canonical
merchant treatment per variant.

The product contract is:

```text
approved Stock Protection policy
+ canonical inventory
+ demand / planning evidence
+ open demand
+ reorder activity
+ purchase-order / inbound state
        ↓
Stock Protection evaluation
        ↓
one canonical treatment
        ↓
Ops Console / alert projections / resolution surfaces
        ↓
merchant action
        ↓
canonical re-evaluation
        ↓
resolved only when underlying truth clears
```

The supported merchant treatments are:

```ts
type StockProtectionTreatment =
  | 'none'
  | 'reorder_now'
  | 'finish_reorder'
  | 'receive_inbound'
  | 'complete_setup';
```

The frontend must consume the backend-derived treatment/action. It must not
reconstruct Stock Protection policy from raw inventory, PO, reorder, or demand
fields.

This follows the Decision Engine contract:

```text
Signal
→ Problem
→ Decision
→ Resolution Session
→ Intervention
→ Canonical Verification
→ Outcome
```

### Canonical monitoring contract

Planning and action evidence are evaluated together.

Action evidence is interpreted as:

- pending reorder request or draft PO → replenishment intent exists;
- ordered / confirmed / in-production PO → committed replenishment exists;
- shipped / partially-received PO → receiving-boundary evidence exists;
- received / cancelled / dismissed records are not active replenishment evidence.

The treatment precedence is canonical:

1. planning data required → `complete_setup`;
2. healthy / no velocity → `none`;
3. receiving-boundary PO → `receive_inbound`;
4. sufficient committed replenishment → `none`;
5. pending reorder request or draft PO → `finish_reorder`;
6. otherwise → `reorder_now`.

The canonical alert identity is:

```text
alert_type  = stock_protection
source      = stock_protection
entity_type = variant
entity_id   = <variantId>
alert_key   = stock_protection:<variantId>
```

The canonical synchronizer persists the treatment verbatim on the alert row.

No separate replenishment lifecycle table was introduced.

### Slice 4 — refresh and reconciliation architecture

Stock Protection refresh uses the existing `shop_snapshot_jobs` queue and
existing shop-snapshot dispatcher. There is no second queue and no second
planning/alert dispatcher.

Consequential mutations enqueue `shop_snapshot_jobs` inside the transaction
that owns the mutation. Covered mutation families include:

- receive-job close;
- batch release and cancellation;
- confirmed pick;
- Stock Protection policy update;
- supplier mutations;
- reorder-request create / dismiss / convert;
- purchase-order create / patch / status / legacy receive;
- inventory recount commit;
- Problem Center inventory discard/write-off;
- stow when the operation is a real physical inventory credit.

Existing order-entity projection coverage remains authoritative for order
cancellation unwind and fulfilled-order physical removal.

A Shopify refund webhook does **not** enqueue Stock Protection merely because
the refund event arrived. Physical replenishment truth changes when returned
inventory is actually credited through the warehouse flow.

### Periodic reconciliation

A 15-minute reconciliation worker exists only as a missed-event safety net.

It:

1. discovers active/trialing subscription tenants through
   `list_stock_protection_reconciliation_tenants()`;
2. resolves commercial eligibility through the canonical commercial-policy
   layer;
3. enqueues eligible shops into `shop_snapshot_jobs`;
4. performs no planning writes and no alert writes itself.

The worker owns one idempotent long-lived loop. Repeated `start()` calls do not
create concurrent cycles.

The shop-snapshot dispatcher also owns explicit lifecycle state and its stop
path waits for an in-flight poll before reporting stopped.

### Slice 5 — dark decision verification

Slice 5 is **complete / pass**.

Production dark verification was read-only. No canonical alert persistence
occurred during Slice 5.

Shops checked:

- shop 1;
- shop 8;
- shop 15.

Canonical evaluator results:

| Shop | Evaluated variants | `reorder_now` | `complete_setup` | `none` |
|---|---:|---:|---:|---:|
| 1 | 27 | 1 | 11 | 15 |
| 8 | 0 | 0 | 0 | 0 |
| 15 | 110 | 15 | 7 | 88 |

Decision/evidence cross-check:

- 137 evaluated variants total;
- zero treatment-rule mismatches;
- no real-production pending reorder, draft PO, committed PO, or
  receiving-boundary evidence among evaluated variants;
- `finish_reorder` and `receive_inbound` therefore were not exercised by real
  production data in dark verification, but remain covered by automated
  contracts.

Legacy population reconciliation:

| Shop | Legacy low-stock rows | Canonical overlap | Not evaluated | Suspicious missed eligibility |
|---|---:|---|---|---:|
| 1 | 8 | `reorder_now` / critical: 1; `none` / no_velocity: 1; `none` / healthy: 1 | 5 total: 3 non-physical, 2 active physical but dormant | 0 |
| 15 | 167 | `reorder_now` / critical: 15 | 152 total: 102 product not active, 49 active physical but dormant, 1 non-physical | 0 |

Conclusion:

- the large legacy → canonical population reduction is intentional noise
  removal, not lost replenishment coverage;
- Slice 5 passed;
- this evidence authorized the Slice 6 cutover implementation.

### Slice 6 — atomic canonical alert cutover

Slice 6 implementation is **complete locally** and automated verification is
**complete locally**. It is not yet claimed live in production.

Production cutover remains pending:

1. exact commit preflight;
2. commit/push;
3. CI/deploy;
4. risk-based production certification.

Canonical alert authority:

- `apps/backend/src/services/alerts/stockProtectionAlertSynchronizer.ts`;
- delegates treatment decisions exclusively to
  `evaluateStockProtectionForShop()`;
- writes canonical identity:
  - `alert_type = stock_protection`;
  - `source = stock_protection`;
  - `entity_type = variant`;
  - `entity_id = <variantId>`;
  - `alert_key = stock_protection:<variantId>`;
- persists `treatment` verbatim.

Approved active treatments:

- `reorder_now`;
- `finish_reorder`;
- `receive_inbound`;
- `complete_setup`.

`none` produces an inactive/resolved canonical row.

Severity mapping:

- `critical` → `critical`;
- `warning` → `warning`;
- `planning_data_required` → `warning`.

Reconciliation behavior:

- full-shop synchronization reconciles stale canonical Stock Protection rows;
- scoped synchronization changes only supplied variants;
- `[]` scope is a strict no-op;
- full-shop synchronization resolves historical active replenishment rows:
  - `low_stock_reorder`;
  - `stockout_risk`;
  - `reorder_warning`;
- historical rows are preserved and are not deleted;
- unrelated order-block / foreign-owned alerts remain untouched.

Legacy producer cutover:

- `aggregateAlertsForShop` no longer calls `aggregateStockReorderAlerts`;
- `computeDemandIntelligence` no longer calls `emitStockoutAlerts`;
- `resolve_inventory_block.handler.ts` no longer calls `emitStockoutAlerts`;
- `resolve_inventory_block` now performs scoped canonical Stock Protection
  synchronization.

Legacy functions may still physically exist as dead definitions for later
cleanup. The Slice 6 contract is that they have no live production callers.

Alert ownership correction:

- `aggregateAlertsForShop` orphan reconciliation is restricted to its owned
  sources:
  - `snapshot`;
  - `constraint`;
- source ownership audit confirmed all `snapshot` / `constraint` producers in
  `apps/backend/src` are confined to `alerts.aggregator.ts`;
- absence from aggregator output therefore cannot deactivate decision-owned or
  Stock Protection alerts.

### Explicit boundaries

STOCK-PROTECT-03 does **not**:

- make Demand GET endpoints mutate alerts;
- silently adopt Buffer Diagnosis recommendations as policy;
- create a second lifecycle persistence model;
- reduce executable paid-order inventory by safety stock;
- make Stock Protection the authority for batch release;
- infer frontend treatments independently of backend truth;
- run canonical and legacy replenishment alert systems concurrently.

`inventory_truth` plus reservation locking remains warehouse execution
authority.

### Remaining rollout

The remaining sequence after Slice 6 local verification is:

1. exact commit preflight;
2. commit/push;
3. CI/deploy;
4. risk-based production certification;
5. later dead-code / compatibility cleanup of retired legacy producers and
   routing where safe.

Slice 5 dark verification is complete. Slice 6 atomic canonical alert cutover
is implemented and locally verified. Production cutover has **not** been
claimed live yet.

### Slice 4 verification evidence — 2026-09-14

| Gate | Result |
|---|---|
| Dispatcher + reconciliation lifecycle + architecture/enqueue contracts | 4 suites / 44 tests PASS |
| Dedicated DB-backed Slice 4 matrix | 8 suites / 28 tests PASS |
| Recount neighbour regression | 2 suites / 25 tests PASS |
| Existing Stock Protection policy/planning/evidence/transport neighbours | 7 suites / 88 tests PASS |
| Disposable DB lifecycle | created → migrated → runtime OK → dropped cleanly |
| Diff hygiene | `git diff --check` PASS on Slice 4 surface |

One broader WMS neighbour suite (`pick-exception-allocation-1049`) was blocked
before reaching Slice 4 behaviour because its fresh-install fixture remained on
`starter` while `warehouse.operations` now requires `core`. That was classified
as unrelated commercial-fixture drift and was not changed as part of
STOCK-PROTECT-03.

### Slice 5–6 verification evidence — 2026-09-14

| Verification layer / run | Result |
|---|---|
| Slice 6 targeted architecture contract | 1 suite / 4 tests PASS |
| Slice 6 canonical synchronization integration | 1 suite / 4 tests PASS |
| Slice 6 disposable DB lifecycle | created → migrated → runtime OK → dropped cleanly |
| Closest Stock Protection neighbours after implementation: transport + monitoring evidence | 2 suites / 35 tests PASS |
| Closest Stock Protection neighbours after implementation: treatment + alert action resolver | 2 suites / 54 tests PASS |
| Consequential DB neighbour regression: shop snapshot dispatcher, Stock Protection eligibility, sourcing worklist, inventory decision contract | 4 suites / 69 tests PASS |
| Consequential DB neighbour disposable lifecycle | created → migrated → runtime OK → dropped cleanly |
| Non-DB neighbour regression: contract | 3 suites / 24 tests PASS |
| Non-DB neighbour regression: backend legacy/unit | 3 suites / 94 tests PASS |
| Backend TypeScript | `apps/backend` `tsc --noEmit` PASS |
| Slice 6 diff hygiene | `git diff --check` PASS |


*Adjacent docs: `stock-protection-buffer-diagnosis-playbook.md`
(STOCK-PROTECT-02 — the read-only recommendation layer built on this
foundation), `sourcing-recommendation-playbook.md` §14 (supplier-authority
supersession), `DemandModule.md` (Demand module structure — its urgency
table and "always-null lead time" description predate this work and should
not be treated as current without re-verifying against
`demandIntelligence.service.ts`).*
