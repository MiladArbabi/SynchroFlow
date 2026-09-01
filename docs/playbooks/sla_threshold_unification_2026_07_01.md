# SLA Threshold Unification & Aging-List Bugs — 2026-07-01

> Found while live-verifying the Orders modal (`entity-detail-modal-playbook.md` §2.8) using a seeded test order. None of these are modal bugs — all are pre-existing backend gaps the modal work happened to surface.

## 1. Confirmed pre-existing bug — `reconciliation.handlers.ts` risk-snapshot read had no version filter

`const riskSnapshot = await trx('order_risk_snapshot').where({ lasyncro_order_id: lasyncroOrderId }).first();` — no `.orderBy()`, no `aggregate_version` filter, against a table with a **composite PK** `(lasyncro_order_id, aggregate_version)` that legitimately holds multiple rows per order. Confirmed live: returned an arbitrary historical row (`aggregate_version: 1`, `is_inventory_blocked: true`, stale from a month-old resolved state) instead of the current one (`aggregate_version: 6`, `false`), producing a live "Go to sourcing" decision for an order with zero active constraints. **Fixed**: scoped to the exact `aggregate_version` this reconciliation pass is processing, matching the `riskSnapshotExists` guard a few lines above it, which was already correctly scoped.

## 2. Confirmed pre-existing bug — three independent, disagreeing SLA/aging thresholds

- `orderAgeProjection.ts` — hardcoded `24h`, `age_since_paid`-anchored (breach flag)
- `OrdersOperatorFacts.service.ts` — hardcoded `48h` floor, `age_since_creation`-anchored (aging-list inclusion); separately hardcoded `72h`, `order_created_at`-anchored (imminent-breach countdown)
- `OrdersModuleFT2.tsx` — hardcoded `24h`, dead weight (backend already pre-filtered before this ever ran)

`shop_operational_settings.fulfillment_sla_hours` already existed, already fully editable (Settings → General, confirmed live in the running app), already correctly read/written by `GET/PATCH /api/v1/modules/cashflow/settings` — **just never consulted by any of the three places above.**

**Fixed — unified model, one input:**
- `orderAgeProjection.ts` now reads `fulfillment_sla_hours` per shop for `SHIPPING_SLA_SECONDS`. Stays `age_since_paid`-anchored — this is the real commercial SLA contract, correctly untouched.
- `OrdersOperatorFacts.service.ts`: `SLA_SECONDS = slaHours * 3600`; `WATCH_FLOOR_SECONDS = SLA_SECONDS * 0.5`; `IMMINENT_LEAD_SECONDS = 4h` fixed lead window before the *real* breach point (`SLA_SECONDS`), replacing the standalone, disconnected 72h/`created_at` calculation.
- `OrdersModuleFT2.tsx`: dead `ageHours >= 24` check removed — `watchOrders = allAgingOrders.filter(o => !o.isShippingSlaBreached)`.

## 3. Second bug found correcting the above — Watch floor needs BOTH ages, not just paid-age

First pass re-anchored the Watch floor to `age_since_paid_seconds` only, to match the breach flag's own anchor. **This silently changed what "Watch" means** — confirmed live: a test order created 50h ago but paid only 2h ago vanished from both bands entirely (not breached, and no longer "aging" by the new paid-only definition). Correction, per explicit product decision: creation-age catches operational neglect (order sitting around regardless of payment timing); paid-age catches SLA-clock urgency. These are two distinct risks — an order should surface in Watch if **either** crosses the floor.

**Fixed:**
```ts
.andWhereRaw(
  'GREATEST(oas.age_since_creation_seconds, COALESCE(oas.age_since_paid_seconds, 0)) > ?',
  [WATCH_FLOOR_SECONDS]
)
```
The breach flag itself and the imminent-breach countdown stay strictly `age_since_paid`-anchored — only the Watch *floor* needed the OR-both-ages fix.

## 4. Confirmed pre-existing bug — aging list never filtered out fulfilled orders

Comment in `OrdersOperatorFacts.service.ts` already documented the intent ("order_fulfillment_status → filter out fulfilled orders") but the filter was never written — only a join used solely for `is_priority_flagged`. Confirmed live: fulfilled orders showed "SLA breach · Xd past" in the Watch/Critical bands. **Fixed**: added `.where(b => b.whereNull('ofs.status').orWhereNotIn('ofs.status', ['fulfilled']))`, `whereNull`-safe for the `leftJoin`.

## 5. Confirmed pre-existing bug — page headline blind to SLA-breached orders

`OrdersModuleFT2.tsx` signal line only checked `constrained > 0` (constraint-based count) — could say "All orders on track" while 8 orders sat SLA-breached in the Critical band on the same page. **Fixed**: now checks `constrained` → `criticalOrders.length` → `watchOrders.length` → all-clear, in that priority order, reusing the same arrays the bands below already render from.

## 6. Confirmed pre-existing bug — `constraintLabel()` defaulted to "SLA breach" for non-breached orders

`default: return 'SLA breach'` fired for both "operational constraint, unspecified type" and "no constraint at all, just aging" — the second case is every Watch-band order by definition. **Fixed**: function now takes `isBreached: boolean`; default returns `'Aging'` when not breached. Added an explicit `case 'operational': return 'Pick exception'` branch that was previously falling through to the same wrong default.

## 7. Tracked, not yet done

GitHub issue [#1031](https://github.com/MiladArbabi/SynchroFlow/issues/1031) — merge "Fulfillment SLA" (Settings → General) and "Carrier Pickup Time" (Settings → Carriers) into one renamed "Fulfillment" tab; add both to the onboarding checklist as fundamentals (currently new shops silently default to 24h SLA / no CPT with no setup prompt).

## 8. SLA-SEM-01 — canonical approaching-Fulfillment-SLA contract (2026-09-01)

The remaining semantic gap was the warning state immediately before a
Fulfillment SLA breach.

### Canonical contract

Fulfillment SLA breach remains:

```text
unfulfilled
AND age_since_paid >= configured fulfillment_sla_hours
```

Approaching Fulfillment SLA is now:

```text
paid
AND unfulfilled
AND not already breached
AND remaining SLA time <= MIN(4 hours, 25% of configured SLA)
```

Equivalent boundary:

```text
age_since_paid_seconds
  >= SLA_SECONDS - MIN(4h, SLA_SECONDS * 0.25)

AND age_since_paid_seconds < SLA_SECONDS
```

Examples:

| Fulfillment SLA | Approaching window | Warning begins |
|---|---:|---:|
| 1h | 15m | 45m |
| 8h | 2h | 6h |
| 24h | 4h | 20h |
| 48h | 4h | 44h |
| 72h | 4h | 68h |
| 720h | 4h | 716h |

### Semantic separation

- **Watch / Aging** is broader operational attention. It may use creation
  age and/or paid age. A Watch order is not necessarily approaching SLA.
- **Approaching Fulfillment SLA** is paid-age only and uses the canonical
  `MIN(4h, 25% SLA)` warning window.
- **Fulfillment SLA breached** is paid-age at or beyond the merchant's
  configured SLA while still unfulfilled.
- **CPT / Carrier Pickup Time** remains completely separate from this model.

### Implementation

- Canonical arithmetic lives in
  `modules/shared/src/contracts/fulfillment-sla.ts`.
- `orders_at_sla_risk` now counts distinct, latest-snapshot,
  unfulfilled, non-breached orders inside the canonical paid-age window.
- `imminentSlaBreachers` uses the same canonical population.
- Constrained-order transport now supplies paid age and configured
  Fulfillment SLA to the UI.
- The constrained-order SLA state no longer uses a hardcoded 36h
  creation-age warning.
- Orders Watch copy no longer describes all aging orders as
  "approaching SLA".
- The stale creation-time 72h SLA countdown was removed.

### Regression contracts

- `SLA-APPROACH-01` — breach remains configured paid-age SLA.
- `SLA-APPROACH-02` — approaching uses paid age only.
- `SLA-APPROACH-03` — window is `MIN(4h, 25% SLA)`.
- `SLA-APPROACH-04` — fulfilled orders never count.
- `SLA-APPROACH-05` — already-breached orders never count.
- `SLA-APPROACH-06` — only latest age-snapshot version counts.
- `SLA-APPROACH-07` — SLA-risk metric counts distinct current orders.
- `SLA-APPROACH-08` — creation-age Watch orders are not called approaching.
- `SLA-APPROACH-09` — CPT is not coupled to Fulfillment SLA proximity.

### Verification

- Canonical SLA unit contract: `8/8 PASS`.
- Frontend SLA semantics: `6/6 PASS`.
- Backend SLA metric integration: `6/6 PASS`.
- Consumer/API wiring integration: `2/2 PASS`.
- Combined backend integration: `8/8 PASS`.
- Jest ownership: `UNOWNED=0`, `MULTI_OWNED=0`.
- Shared package build: PASS.
- Order Nexus targeted typecheck: PASS.
- Stale SLA semantic scan: zero matches.
- CPT coupling scan: zero matches.
- Disposable integration DB cleanup confirmed.
- Localhost live browser verification: PASS.
