# LaSyncro — Demand Velocity & Proactive Reorder Playbook

> **Created:** 2026-06-30. **Status:** Gap confirmed, not designed. Tracked in GH issue (DF-01/02/03).

## 1. The Gap

`stockout_risk` (real, wired tonight — see `sourcing-recommendation-playbook.md` §6) is **reactive**: it only fires once `resolve_inventory_block.handler.ts` runs against an order that's *already* blocked. There is no earlier warning. An SMB operator using only this signal will always be surprised at the point of actual blockage, not before it.

`reorder_warning` exists as a label in both alert-routing maps (`TopnavbarContent.tsx`, `AlertsPage.tsx`) but **nothing in the backend has ever created this alert type** — confirmed via repo-wide search, 2026-06-30. It's a route waiting for a feature.

## 2. The Intent (stated directly, 2026-06-30)

> SMB operators should be able to avoid reaching stockout entirely, given sales velocity and other crucial factors — and should only ever see a *stockout_risk* alert because an earlier warning was already shown and ignored, never as the first and only signal they get.

## 3. Original Scope (from a prior, untracked session — MVP Roadmap discussion)

Three pieces, sequential dependency:
- **DF-01 — Demand velocity computation.** Units/day per variant, rolling window, from `order_revenue_units` (table exists, this exact use is unbuilt).
- **DF-02 — Days-of-stock-remaining signal.** DF-01's velocity joined against `inventory_truth.available_quantity`.
- **DF-03 — Ranked reorder signal.** SKUs approaching stockout, surfaced *before* the order-blocking stage — this is the actual `reorder_warning` alert, finally given a real producer.

## 4. Open Design Questions (none resolved yet)

- Rolling window length for velocity — fixed (7d/14d) or seasonality-aware? Unscoped.
- Days-of-stock threshold for "warn" vs. purely informational — unscoped.
- Per-variant alert vs. batched/digest — real alert-fatigue risk for an SMB with many SKUs if every variant fires independently; unscoped.
- Relationship to Sourcing (§6 of the sourcing playbook): should `reorder_warning` feed the exact same ranked-supplier flow as `stockout_risk`, just triggered earlier with more lead time? Strong intuition yes, not locked.

## 5. Dependency Chain
order_revenue_units + inventory_truth
→ DF-01 (velocity) — not yet built
→ DF-02 (days-of-stock) — not yet built
→ DF-03 (ranked reorder_warning alert) — not yet built
→ routes to /suppliers-portal/sourcing (already fixed, 2026-06-30)
→ same Sourcing recommendation flow as stockout_risk

Separately, on the resolution side (not the warning side):
receive_jobs.close
→ DF-04 (targeted order_constraints revalidation) — ✅ built, 2026-07-01
→ orders with active inventory constraints on received variants auto-unblock
→ (not yet built) surfacing "N orders unblocked by this receive" back to the operator

## 6. CONFIRMED GAP (2026-07-01) — Receiving stock does not close the loop on blocked orders

**Found while investigating the Orders modal's "Acknowledge Stock Issue" resolved-state bug. Full chain traced and confirmed via code, not inferred.**

The chain:
1. `receiveJob.service.ts` correctly updates `inventory_truth` (`on_hand_quantity`, `available_quantity`, `sellable_quantity`) the moment a receive job accepts line items. **Confirmed real, not a gap** — corrects an earlier stale claim in `OrdersModule.md` §8 (see that file's correction, same date).
2. `receiveJob.service.ts` writes **zero** rows to `domain_events` — confirmed via direct grep, empty result.
3. The real constraint evaluator (`evaluateOrderConstraints`, in `constraintEngine.ts`) only runs **inline inside `processDomainEvent`** — confirmed via `queue.topology.ts`'s own comment: *"Reconciliation consumer is disabled (runs inline in processDomainEvent)."*
4. `worker-entry.ts` confirms no independent scheduled/cron path exists either — the async reconciliation dispatcher is explicitly disabled (`[RECONCILIATION_DISPATCHER_DISABLED]`), with reconciliation stated as inline-only, triggered strictly by the order-event pipeline.

**Conclusion:** receiving stock never triggers constraint re-evaluation for orders that were waiting on it. `order_constraints.is_active` stays `true` on a previously-blocked order indefinitely, even after the stock physically arrives — until either an unrelated order-side domain event happens to touch that same order, or an operator manually re-opens the order and re-triggers `resolve_inventory_block.handler.ts`, which re-checks `inventory_truth` live and bypasses the constraint model entirely (this is why that handler queries stock directly instead of trusting `order_constraints` — it has to, it's the only mechanism that closes the loop today).

**Product impact:** the system cannot proactively tell an operator "the stock you were waiting on arrived, go re-check that order." The operator must remember which orders were blocked and manually re-click them speculatively. This sits upstream of DF-03 (§3) — even once proactive *pre*-stockout warnings exist, *post*-stockout resolution still silently depends on operator memory.

**DF-04 — ✅ built, 2026-07-01.**
Implemented as a narrower direct call, not a `domain_events` write — the second option considered above, chosen because it reuses the existing evaluate → persist contract exactly as `projection.engine.ts` already does, with no new constraint-writing logic.

**Mechanism, as shipped:**
- New function `revalidateOrdersForReceivedVariants(trx, shopId, receivedVariantIds)` in `receiveJob.service.ts`, called at the end of `closeReceiveJob`, same transaction as the receive close.
- Scope is intentionally narrow: queries `order_constraints` (joined to `orders` for tenant scoping — `order_constraints` has no `shop_id` column, confirmed via migration `0070_create_order_constraints.ts`) for orders with an **active** `constraint_type = 'inventory'` row whose `target_id` matches one of the variants just received in this job. Not a shop-wide sweep.
- For each affected order: reads `orders.aggregate_version` (same read pattern as `projection.engine.ts`'s domain-event path), then calls `evaluateOrderConstraints` → `projectOrderConstraints` — the identical evaluate/persist pair the normal pipeline uses, just triggered from a second entry point.
- Per-order try/catch — one failing revalidation logs (`[DF04_REVALIDATION_FAILED]`) and is skipped, never rolls back or blocks the receive job close itself.
Missing `aggregate_version` is logged (`[DF04_MISSING_AGGREGATE_VERSION]`) and skipped, same invariant `projection.engine.ts` enforces, rather than throwing and aborting the whole close.

**CONFIRMED BROKEN AT SHIP, FIXED 2026-07-01 (same day, live-verified).** The mechanism above was designed and applied but never actually executed successfully until tonight. Live end-to-end test (real OAuth-installed dev store, real oversold Shopify variant, real PO → receive job → close cycle) surfaced the actual failure:

- `projectOrderConstraints` writes to `order_constraints`, a table guarded by trigger `enforce_projection_writer_order_constraints`, which rejects any write not flagged as coming from the projection engine.
- `revalidateOrdersForReceivedVariants` called `projectOrderConstraints` directly from `receiveJob.service.ts` — outside the projection engine's own transaction context — so every call was silently rejected: `[PROJECTION_WRITE_VIOLATION] table=order_constraints must be written only by projection.engine`.
- Logged as `[DF04_REVALIDATION_FAILED]` per the existing per-order try/catch (working as designed — the receive job close itself never failed or rolled back), but the constraint was never actually revalidated. The "reuses the existing evaluate → persist contract... no new write path" reasoning at ship time was correct about *which function* to call, but missed that the write-guard trigger still applies regardless of caller.

**Fix:** `await trx.raw('SET LOCAL "synchroflow.projection" = \\'true\\'')` immediately before the `projectOrderConstraints` call — same GUC bypass pattern already used by `rebuildInventoryProjectionForVariants` for the identical class of problem (a legitimate projection write occurring outside the engine's own transaction). One-line fix in `receiveJob.service.ts`.

**Verified live, twice:** first run reproduced the failure (`DF04_REVALIDATION_FAILED`, constraint stayed `is_active=true` with stale `started_at`); second run after the patch showed `[DF04_ORDER_REVALIDATED]` with no failure, and the constraint row's `started_at` genuinely refreshed — confirming `projectOrderConstraints` executed for real this time. The order remained `is_active=true` post-fix, which is correct: received units enter `stow_tasks` (pending putaway) and do not immediately update `inventory_truth.available_quantity`, so the evaluator correctly found the order still genuinely unfulfillable. DF-04 now does exactly its job — re-check, don't assume — the remaining "still blocked" state is honest, not a bug.

**What this does NOT do, by design:**"""

if old not in content:
    print("ERROR: exact text not found, aborting — no changes written")
else:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("PATCHED: demand-velocity-reorder-playbook.md §6 — bug + fix + live verification logged")

**What this does NOT do, by design:** does not unblock anything on PO status change (`ordered`/`confirmed`/`in_production`/`shipped`) — only on receive job close, since that's the only point where physically-counted stock is confirmed and `inventory_truth` is actually updated. See `entity-detail-modal-playbook.md` §2.8 for the related, separately-scoped "inbound relief" signal (surfacing "still short, but N units inbound via PO #X" without falsely resolving the block) — not yet built as of this writing.

**Relationship to Sourcing (§6 of sourcing-recommendation-playbook.md):** once DF-04 closes this loop, the natural next step is surfacing "N orders were unblocked by this receive" back to the operator — likely the same notification surface as `stockout_risk`/`reorder_warning`, just the resolution side instead of the warning side.
