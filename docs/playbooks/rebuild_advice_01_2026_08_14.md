# REBUILD-ADVICE-01 — a worker recommending a projection wipe

**Date:** 2026-08-14
**File:** `apps/backend/src/workers/margin-snapshot-integrity.worker.ts`
**Parent:** `REBUILD-UNSAFE-01` (P1, CLI guard still open)

## Problem

The margin-snapshot integrity worker detects MARGIN drift — a stale
version-sealed `order_margin_snapshot` row against live revenue, as its own
comment at :87-88 states. On every drift it printed:

    remediation: 'Run rebuild-from-events (or targeted recompute) for the
                  listed orders.'

`rebuild-from-events` is not a targeted recompute. Per its own header, the CLI
connects as `systemDb` (PGMIGRATION_USER — table owner, BYPASSRLS) precisely
because it **TRUNCATES projection tables** and rematerializes them; the runtime
app role cannot TRUNCATE owner tables (42501). Whole-projection destruction,
RLS deliberately bypassed, to correct one snapshot row.

It is also currently unsafe for a second, independent reason: pick rows written
before migration 0147 still carry `movement_type = 'sale'`, so a replay
double-subtracts every historical pick and drives `inventory_truth` below
reality (INV-SALE-DOUBLE-01 — 5 rows on shop 2, since corrected by
INV-SALE-BACKFILL-01; shop 1 had none, it has never picked).

The worker runs on a 300 000 ms interval. The advice was live and repeating.

## Fix

Advice must stay proportionate to the drift detected. Margin drift is a margin
problem. The message now names the actual targeted remedy and explicitly warns
against the rebuild:

    'Margin snapshot drift. Recompute margin only:
     npm run backfill:margin -w apps/backend -- <shopId>
     (calls computeOrderMargin per order, through the write guard).
     Do NOT run rebuild-from-events: it truncates and replays all projection
     tables, and is currently unsafe on any tenant that has picked
     (INV-SALE-DOUBLE-01 backfill outstanding).'

`backfill:margin` is the right mechanism: it invokes `computeOrderMargin` —
the same runtime service the reconciliation pipeline uses — from a standalone
transaction that sets `synchroflow.reconciliation = 'true'`, satisfying the
`SNAPSHOT_WRITE_BLOCKED` guard rather than bypassing it. Per-order isolation
means one guarded-write failure does not cascade. No truncation.

## Known imperfection

`backfill-margin-snapshots.ts` enumerates ALL orders for a shop, not just the
drifted ones. So it is proportionate in MECHANISM (per-order, guarded, no
truncation) but not in SCOPE. It remains strictly better than a projection wipe
and it is the tool that exists.

Registered: a per-order variant accepting explicit order ids would be the ideal
remedy for this worker's output.

## What this does NOT do

The CLI itself is unguarded. `npm run rebuild -w apps/backend` still truncates
and replays with no check for pre-0147 `sale` rows.

Complication for any guard: root `package.json:30` chains
`npm run rebuild -w apps/backend` inside `dev:full-seed`, so a hard refusal
would break the seed pipeline. That is why shop 1 shows a 32-unit divergence —
the seed writes truth, then the chained rebuild overwrites it from a ledger
whose `opening_balance` rows postdate the sales that consume them.

Guard design deferred to its own workshop. The backfill may make it moot.

## Downgraded during this audit

`shopify.service.ts:145` calls `rebuildInventoryProjectionForVariants` via
dynamic import — initially flagged as an automatic corruption vector. It is
labelled C-05 and fires immediately after `seedShopifyOpeningBalances` on FIRST
SYNC only, when a tenant has opening balances and nothing else. Replay is
trivially correct there. Not a hazard.

## Verified

    named remedy   worker :115 matches package.json :26
    old advice     gone; both remaining mentions are the new negated form
    tsc            clean
