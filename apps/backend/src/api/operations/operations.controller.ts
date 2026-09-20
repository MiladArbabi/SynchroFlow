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
