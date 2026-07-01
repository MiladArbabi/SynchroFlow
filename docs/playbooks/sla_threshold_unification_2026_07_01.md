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
