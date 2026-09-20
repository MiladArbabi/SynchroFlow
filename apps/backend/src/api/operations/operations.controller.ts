// apps/backend/src/api/operations/operations.controller.ts
//
// OPS-CONSOLE-WAITING-01 — canonical shop-wide WAITING read.
//
// GET /api/v1/operations/waiting
// -------------------------------
// WAITING means: the merchant/operator already acted (a durable
// decision_interventions row exists), and canonical domain truth
// (order_constraints, via interventionOutcome.service.ts's shared episode
// derivation) says the result is still pending_verification for that EXACT
// constraint episode.
//
// V1 treatments ONLY: address_correction, inventory_reorder_intent — see
// WAITING_V1_TREATMENTS in interventionOutcome.service.ts, the single
// source of truth this endpoint and the NOW anti-join both read from.
//
// CORRECTION PASS (OPS-CONSOLE-WAITING-01 corrections 1 & 2): this endpoint
// no longer filters/deduplicates independently. readCurrentWaitingV1Records()
// is the ONE shared seam — treatment allowlist, pending_verification, exact
// treatment/constraint pairing, and one-row-per-current-episode collapse all
// live there, shared verbatim with alerts.aggregator.ts's NOW exclusion.
//
// Copy (presentation.title/subtitle/actionLabel) is NOT ratified — backend-
// supplied, non-empty, and free to change. routing.route IS ratified and
// locked exactly to the two V1 destinations below.
//
// Auth matches the sibling GET /api/v1/decisions route's own precedent
// (authenticateToken only) — same read-only, tenant-scoped shape.

import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';
import {
  readCurrentHistoryV1Records,
  readCurrentWaitingV1Records,
  WAITING_V1_TREATMENTS,
} from '../../services/decision/interventionOutcome.service.js';

export interface WaitingItem {
  interventionId: string;
  treatment: string;
  lasyncroOrderId: string;
  externalOrderId: string | null;
  constraintId: string;
  constraintType: string | null;
  blockType: string | null;
  occurredAt: string;
  outcome: 'pending_verification';
  presentation: {
    title: string;
    subtitle: string;
    actionLabel: string;
  };
  routing: {
    route: string;
  };
}

/**
 * LOCKED routing per the ratified V1 contract. Copy is deliberately plain —
 * not ratified, free to change without breaking the contract.
 */
const WAITING_PRESENTATION: Record<
  (typeof WAITING_V1_TREATMENTS)[number],
  { title: string; subtitle: string; actionLabel: string; route: string }
> = {
  address_correction: {
    title: 'Address correction submitted',
    subtitle: 'Waiting on canonical verification that the address block cleared.',
    actionLabel: 'Review address',
    route: '/overview?resolution=address',
  },
  inventory_reorder_intent: {
    title: 'Reorder requested',
    subtitle: 'Waiting on stock to arrive and the order to clear.',
    actionLabel: 'Review reorder',
    route: '/orders/flow?constraint=inventory',
  },
};

export const httpGetWaiting = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    // Already: allowlisted treatment, pending_verification, valid
    // treatment/constraint pairing, exactly one row per current episode
    // (latest intervention wins) — nothing left for this endpoint to filter
    // or deduplicate. See readCurrentWaitingV1Records() for the full seam.
    const pending = await readCurrentWaitingV1Records({ shopId });

    const orderIds = Array.from(new Set(pending.map((record) => record.lasyncroOrderId)));
    const externalOrderRows: { lasyncro_order_id: string; external_order_id: string }[] =
      orderIds.length === 0
        ? []
        : await withTenant(shopId, (trx) =>
            trx('external_order_identity_map')
              .where('shop_id', shopId)
              .whereIn('lasyncro_order_id', orderIds)
              .select('lasyncro_order_id', 'external_order_id')
          );
    const externalOrderIdByOrder = new Map(
      externalOrderRows.map((row) => [row.lasyncro_order_id, row.external_order_id])
    );

    const items: WaitingItem[] = pending.map((record) => {
      const treatment = record.treatment as (typeof WAITING_V1_TREATMENTS)[number];
      const copy = WAITING_PRESENTATION[treatment];

      return {
        interventionId: record.interventionId,
        treatment: record.treatment,
        lasyncroOrderId: record.lasyncroOrderId,
        externalOrderId: externalOrderIdByOrder.get(record.lasyncroOrderId) ?? null,
        constraintId: record.constraintId as string,
        constraintType: record.constraintType,
        blockType: record.blockType,
        occurredAt: record.occurredAt.toISOString(),
        outcome: 'pending_verification',
        presentation: {
          title: copy.title,
          subtitle: copy.subtitle,
          actionLabel: copy.actionLabel,
        },
        routing: {
          route: copy.route,
        },
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[OPERATIONS_WAITING_LIST_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to list waiting items: ${message}` });
  }
};

// GET /api/v1/operations/history
// -------------------------------
// OPS-CONSOLE-HISTORY-01 — canonical shop-wide HISTORY V1 read.
//
// HISTORY means: the EXACT eligible operational episode canonically
// resolved — order_constraints.resolved_at is set and readCurrentHistoryV1Records()
// (interventionOutcome.service.ts) derived outcome.status ===
// 'verified_resolved' for it. Same V1 treatment/constraint pairing
// restriction as WAITING (address_correction<->customer/incomplete_address,
// inventory_reorder_intent<->inventory/oversell). Explicitly NOT sourced
// from resolved alerts, decisions.status, or execution success — see
// interventionOutcome.service.ts's governing invariant.
//
// One row per resolved constraint episode (readCurrentHistoryV1Records()
// already collapses repeated interventions against the same episode to its
// winner), newest constraintResolvedAt first, 30-day retention.
//
// Copy is NOT ratified — backend-supplied, non-empty, free to change.
//
// HISTORY-ORDER-ENTITY-01 — routing.kind is 'order_entity', not a route
// string. HISTORY's canonical destination is the merchant's own order — the
// Order Entity Modal inside Ops Console, not a page. This is a DIFFERENT
// destination shape from WAITING's routing.route (WAITING still points the
// merchant at a page for an ACTIVE episode they may still need to act on;
// HISTORY's episode already resolved, so there is nothing left to act on —
// only the order to look at). routing.lasyncroOrderId IS ratified — the
// frontend consumes it verbatim (opsConsoleModel.ts's buildHistoryRows) to
// open the existing OrderDetailModalBody, never a route.
export interface HistoryItem {
  interventionId: string;
  treatment: string;
  lasyncroOrderId: string;
  externalOrderId: string | null;
  constraintId: string;
  constraintType: string | null;
  blockType: string | null;
  occurredAt: string;
  resolvedAt: string;
  outcome: 'verified_resolved';
  presentation: {
    title: string;
    subtitle: string;
    actionLabel: string;
  };
  routing: {
    kind: 'order_entity';
    lasyncroOrderId: string;
  };
}

/**
 * Copy is deliberately distinct from WAITING_PRESENTATION's wording (past
 * tense, resolution-framed). No `route` field here — HISTORY-ORDER-ENTITY-01
 * routes to the order entity modal, not a page (see HistoryItem's routing
 * doc above); actionLabel stays "View order" for both treatments.
 */
const HISTORY_PRESENTATION: Record<
  (typeof WAITING_V1_TREATMENTS)[number],
  { title: string; subtitle: string; actionLabel: string }
> = {
  address_correction: {
    title: 'Address correction verified',
    subtitle: 'Canonical verification confirmed the address block cleared.',
    actionLabel: 'View order',
  },
  inventory_reorder_intent: {
    title: 'Reorder resolved',
    subtitle: 'Stock arrived and the order cleared canonically.',
    actionLabel: 'View order',
  },
};

export const httpGetHistory = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    // Already: allowlisted treatment, verified_resolved, valid
    // treatment/constraint pairing, exactly one row per resolved episode
    // (latest intervention wins), 30-day retention, newest-resolved-first —
    // nothing left for this endpoint to filter, deduplicate or sort. See
    // readCurrentHistoryV1Records() for the full seam.
    const resolved = await readCurrentHistoryV1Records({ shopId });

    const orderIds = Array.from(new Set(resolved.map((record) => record.lasyncroOrderId)));
    const externalOrderRows: { lasyncro_order_id: string; external_order_id: string }[] =
      orderIds.length === 0
        ? []
        : await withTenant(shopId, (trx) =>
            trx('external_order_identity_map')
              .where('shop_id', shopId)
              .whereIn('lasyncro_order_id', orderIds)
              .select('lasyncro_order_id', 'external_order_id')
          );
    const externalOrderIdByOrder = new Map(
      externalOrderRows.map((row) => [row.lasyncro_order_id, row.external_order_id])
    );

    const items: HistoryItem[] = resolved.map((record) => {
      const treatment = record.treatment as (typeof WAITING_V1_TREATMENTS)[number];
      const copy = HISTORY_PRESENTATION[treatment];

      return {
        interventionId: record.interventionId,
        treatment: record.treatment,
        lasyncroOrderId: record.lasyncroOrderId,
        externalOrderId: externalOrderIdByOrder.get(record.lasyncroOrderId) ?? null,
        constraintId: record.constraintId as string,
        constraintType: record.constraintType,
        blockType: record.blockType,
        occurredAt: record.occurredAt.toISOString(),
        resolvedAt: (record.outcome.constraintResolvedAt as Date).toISOString(),
        outcome: 'verified_resolved',
        presentation: {
          title: copy.title,
          subtitle: copy.subtitle,
          actionLabel: copy.actionLabel,
        },
        routing: {
          kind: 'order_entity',
          lasyncroOrderId: record.lasyncroOrderId,
        },
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[OPERATIONS_HISTORY_LIST_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to list history items: ${message}` });
  }
};
