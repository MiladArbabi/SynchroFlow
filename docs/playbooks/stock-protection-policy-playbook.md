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
- **STOCK-PROTECT-03** — Unified Replenishment Lifecycle / monitoring
- **STOCK-PROTECT-04** — WAITING read model
- **STOCK-PROTECT-05** — Protection Failure Diagnosis
- **OUTCOME-VALUE-01** — Verified Value Ledger
- **STOCK-PROTECT-06** — Impact UX
- **STOCK-PROTECT-07** — Multi-location Protection

## 12. Verification Evidence (2026-09-11)

| Gate | Result |
|---|---|
| Unit + architecture/static contract | 2 suites / 6 tests PASS |
| Integration (migration, mutation/history/resolution contract, concurrency) + neighbour regression (`sourcing-worklist-contract`, `sourcing-targeted-contract`, `inventory-treatment-assist-contract`, `inventory-outcome-attribution`) | 7 suites / 117 tests PASS |
| Disposable integration DB | created → migrated → runtime OK → dropped, orphan `synchroflow_test_*` count = 0 |
| Tenant isolation (RLS) | cross-tenant write to `stock_protection_policies` explicitly rejected — confirmed by the database's own row-level-security error, not by the table being absent |
| Backend TypeScript (`tsc --noEmit`) | 3 pre-existing unrelated errors (Stripe API-version literals in `apps/backend/src/api/billing/*`, untouched by this work); 0 errors in any STOCK-PROTECT-01 file |

---

*Adjacent docs: `sourcing-recommendation-playbook.md` §14 (supplier-authority
supersession), `DemandModule.md` (Demand module structure — its urgency
table and "always-null lead time" description predate this work and should
not be treated as current without re-verifying against
`demandIntelligence.service.ts`).*
