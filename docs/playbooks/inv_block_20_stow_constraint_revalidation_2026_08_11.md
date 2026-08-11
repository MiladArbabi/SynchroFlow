# INV-BLOCK-20 — Constraint revalidation on stow confirm

**Date:** 2026-08-11 · **Files:** `services/wms/receiveJob.service.ts`,
`api/wms/wms.controller.ts`

## Symptom
Order `800003` stayed blocked ("Not enough stock to fulfill") after 10 units
of its exact variant were received and stowed into pick bin A-1. No operator
action could clear it.

## Root cause — two compounding defects
1. **DF-04 fires at the wrong moment.** `revalidateOrdersForReceivedVariants`
   ran only in `closeReceiveJob`, where stock lands at ROOT. With active pick
   bins present, the canonical predicate (`pickableLocation.ts`, INV-BLOCK-19)
   excludes ROOT — so revalidation ran at the one moment it can never succeed.
2. **The stow cascade's intent insert is permanently deduped.**
   `wms.controller.ts:1833` inserts `order_reconciliation_intents` with
   `.onConflict(['lasyncro_order_id','aggregate_version']).ignore()`.
   `aggregate_version` is an *order* aggregate version; stow is a warehouse
   event and never advances it. Once an order's intent at a given version is
   consumed and deleted (dispatcher `:388`), every later stow silently
   `.ignore()`s. The order becomes permanently unreachable by stock-arrival
   reconciliation.

The `[STOW_CASCADE_ORDERS_QUEUED]` log reports `constrainedOrders.length` —
the *query* result — not rows inserted, so a swallowed insert logged success.

## Fix
Export `revalidateOrdersForReceivedVariants` and call it synchronously in the
stow cascade. Same evaluate → persist pair, one definition, two triggers. The
projection-writer GUC is already set at `httpConfirmStow`'s transaction top.
The intent insert is left in place — the change is additive and revertible.

## Verification
`[DF04_NO_AFFECTED_ORDERS]` fired inside a stow confirm — a log line that
previously existed only in the receive-close path. Wiring proven; resolution
of a live block remains open as INV-BLOCK-20-FU-01, which needs an order
blocked on a variant about to become pickable.

## Not fixed here
The dedupe key itself. Widening it needs a migration and is dead until the
reconciliation consumer is re-enabled (MQ-RECON-01). Belongs with that issue.
