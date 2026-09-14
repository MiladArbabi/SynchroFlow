// File: apps/backend/src/api/suppliers/reorderRequests.controller.ts
//
// MOQ Accumulation System — sourcing-recommendation-playbook.md §8
// Four endpoints: GET (by_supplier grouped), POST (queue), DELETE (dismiss), convert (→ PO).
// RLS: all queries require SET LOCAL app.current_tenant.
// Supplier is locked at queue time — never re-resolved on convert (§8.1).
//
// SRC-01a — PO READINESS GATES
// qty_requested is a LEVEL (the shortfall), never a running total: re-queueing
// the same variant+supplier raises it to MAX(old, new). Enforced in the DB by
// reorder_requests_pending_unique_idx (migration 0151).
// Convert enforces three gates, mirrored to the UI as `gates` + `po_ready`:
//   G2 moq_met            — SOFT: overridable via body.override_moq, stamped on PO notes
//   G3 lead_time_set      — HARD: without it the PO has no ETA to project
//   G4 all_lines_have_sku — HARD: a line with no SKU cannot be received or scanned
// moq === null means no target set, so G2 PASSES — absence of a constraint is
// not a failed constraint. Gate rejections return 422 with a reason; 400 is
// reserved for "nothing queued".

import { Request, Response } from 'express';
import crypto from 'crypto';
import db from '@lasyncro/backend-core/db.js';
import { enqueueShopSnapshotJob } from '../../services/shop-snapshot/enqueueShopSnapshotJob.js';

/**
 * OUTCOME-INV-01 — INVENTORY INTERVENTION PROVENANCE
 * ---------------------------------------------------
 * GOVERNING INVARIANT
 *   execution success != treatment success != operational outcome
 *
 * Queueing a reorder is a real, durable, operator-initiated purchasing
 * commitment against a blocker the merchant was actually shown. It is NOT
 * supply: it moves no stock, makes nothing pickable, and therefore cannot clear
 * an oversell. What is recorded below is only that the treatment was APPLIED.
 *
 * The outcome is derived later, at READ time, from canonical order_constraints
 * (services/decision/interventionOutcome.service.ts). Nothing here resolves a
 * constraint, touches inventory_truth, changes PO status, or enqueues Decision
 * execution — and open_sourcing navigation still writes nothing at all.
 */
const INVENTORY_TREATMENT_KEY = 'inventory_reorder_intent';
const INVENTORY_ACTION_KEY = 'create_reorder_request';
const INVENTORY_SOURCE_SURFACE = 'sourcing_targeted_reorder_queue';

/**
 * The treatment vocabulary inventoryTreatmentAssist.service.ts can emit.
 *
 * ADVISORY ONLY. This records what the merchant says they were looking at when
 * they acted. It is never used for authorization, constraint lookup, ranking or
 * outcome derivation, and an unrecognised value must never fail an otherwise
 * valid purchasing write — provenance is not a gate.
 */
const KNOWN_SHOWN_TREATMENT_KEYS = [
  'wait_for_inbound',
  'continue_purchasing',
  'source_remaining',
  'find_supplier',
  'investigate_inventory',
] as const;

const normalizeShownTreatmentKey = (value: unknown): string | null =>
  typeof value === 'string' &&
  (KNOWN_SHOWN_TREATMENT_KEYS as readonly string[]).includes(value)
    ? value
    : null;

// ── GET /reorder-requests ─────────────────────────────────────────────────────
// Returns all pending requests grouped by supplier, with MOQ progress.
export async function httpListReorderRequests(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    let result: any[] = [];

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Fetch all pending requests with variant + supplier detail in one query
      result = await trx('reorder_requests as rr')
        .join('suppliers as s', 's.id', 'rr.supplier_id')
        .join('variants as v', 'v.lasyncro_variant_id', 'rr.lasyncro_variant_id')
        .where('rr.shop_id', shopId)
        .andWhere('rr.status', 'pending')
        .orderBy(['rr.supplier_id', 'rr.created_at'])
        .select(
          'rr.id', 'rr.lasyncro_variant_id', 'rr.supplier_id', 'rr.qty_requested',
          'rr.source', 'rr.created_at',
          's.name as supplier_name', 's.moq', 's.lead_time_days',
          'v.sku', 'v.title'
        );
    });

    // Group by supplier — keyed by supplier_id
    const bySupplierMap = new Map<number, any>();

    for (const row of result) {
      if (!bySupplierMap.has(row.supplier_id)) {
        bySupplierMap.set(row.supplier_id, {
          supplier_id:     row.supplier_id,
          supplier_name:   row.supplier_name,
          moq:             row.moq ? Number(row.moq) : null,
          // SRC-01a: lead time is a hard gate — a PO with no ETA cannot be
          // placed on the inbound timeline or projected into stock.
          lead_time_days:  row.lead_time_days !== null ? Number(row.lead_time_days) : null,
          total_qty:       0,
          moq_met:         false,
          all_lines_have_sku: true,
          requests:        [],
        });
      }
      const group = bySupplierMap.get(row.supplier_id);
      group.total_qty += Number(row.qty_requested);
      // SRC-01a: a line with no SKU cannot be received or scanned at the dock.
      if (!row.sku) group.all_lines_have_sku = false;
      group.requests.push({
        id:                  row.id,
        lasyncro_variant_id: row.lasyncro_variant_id,
        sku:                 row.sku,
        title:               row.title,
        qty_requested:       Number(row.qty_requested),
        source:              row.source,
        created_at:          row.created_at,
      });
    }

    // Resolve moq_met after total_qty is fully accumulated
    const bySupplier = Array.from(bySupplierMap.values()).map((group) => {
      // SRC-01a: moq === null means "no target set" — the gate PASSES rather
      // than blocking. Absence of a constraint is not a failed constraint.
      const moqMet       = group.moq === null || group.total_qty >= group.moq;
      const leadTimeSet  = group.lead_time_days !== null;
      const gates = {
        moq_met:            moqMet,
        lead_time_set:      leadTimeSet,
        all_lines_have_sku: group.all_lines_have_sku,
      };
      return {
        ...group,
        moq_met:  moqMet,
        gates,
        // po_ready drives the UI button; convert re-checks server-side.
        po_ready: moqMet && leadTimeSet && group.all_lines_have_sku,
      };
    });

    return res.json({ by_supplier: bySupplier });
  } catch (err) {
    console.error('[reorder-requests] httpListReorderRequests failed', err);
    return res.status(500).json({ error: 'Failed to fetch reorder requests' });
  }
}

// ── POST /reorder-requests ────────────────────────────────────────────────────
// Queues a new reorder request. Supplier locked at creation time.
export async function httpCreateReorderRequest(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    lasyncro_variant_id,
    supplier_id,
    qty_requested,
    source,
    // OUTCOME-INV-01 — optional attribution context. Absent means this is an
    // ordinary generic reorder and nothing below changes for it.
    originating_order_id,
    shown_treatment_key,
  } = req.body ?? {};

  if (!lasyncro_variant_id || !supplier_id || !qty_requested || !source) {
    return res.status(400).json({ error: 'lasyncro_variant_id, supplier_id, qty_requested, and source are required' });
  }
  if (!['alert', 'manual'].includes(source)) {
    return res.status(400).json({ error: 'source must be "alert" or "manual"' });
  }
  if (typeof qty_requested !== 'number' || qty_requested < 1) {
    return res.status(400).json({ error: 'qty_requested must be a positive integer' });
  }

  try {
    let row: any = null;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Verify supplier belongs to shop and is active
      const supplier = await trx('suppliers')
        .where({ id: supplier_id, shop_id: shopId, active: true })
        .first();
      if (!supplier) return; // null row signals 404 below

      // Verify variant belongs to shop
      const variant = await trx('variants')
        .where({ lasyncro_variant_id, shop_id: shopId })
        .first();
      if (!variant) return; // null row signals 404 below

      /**
       * OUTCOME-INV-01 — ATTRIBUTION TARGET.
       *
       * Resolved SERVER-SIDE from the originating order, before the purchasing
       * write, and never supplied by the client: constraint_id is mutable
       * canonical state, and accepting one from a caller would let anything
       * claim any blocker.
       *
       * Locked FOR UPDATE OF the constraint row alone so the active EPISODE
       * cannot be resolved or re-raised between attribution and the
       * intervention write. `started_at` is captured as that episode's anchor —
       * constraint_id is deterministic and REUSED across resolve/re-raise
       * cycles, so identity alone cannot tell two episodes apart.
       *
       * order_constraints has no shop_id column (RLS-only tenant isolation via
       * a join to orders — migration 0070), so orders is joined explicitly
       * rather than relying on RLS alone for this cross-order lookup — the same
       * convention receiveJob.service.ts's revalidation uses.
       */
      let attribution:
        | { constraintId: string; constraintStartedAt: Date }
        | null = null;

      if (
        typeof originating_order_id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(originating_order_id)
      ) {
        const constraintRow = await trx('order_constraints as oc')
          .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
          .where('o.shop_id', shopId)
          .andWhere('oc.lasyncro_order_id', originating_order_id)
          .andWhere('oc.constraint_type', 'inventory')
          .andWhere('oc.block_type', 'oversell')
          .andWhere('oc.target_id', lasyncro_variant_id)
          .andWhere('oc.is_active', true)
          .forUpdate('oc')
          .first('oc.constraint_id', 'oc.started_at');

        /**
         * No matching ACTIVE constraint is a perfectly ordinary outcome: buying
         * ahead of demand is legitimate. It must never manufacture an
         * intervention, and must never turn a valid purchasing write into a
         * Decision Engine failure.
         */
        const startedAt = constraintRow?.started_at == null
          ? null
          : new Date(constraintRow.started_at);
        if (constraintRow?.constraint_id && startedAt && !Number.isNaN(startedAt.getTime())) {
          attribution = {
            constraintId: constraintRow.constraint_id,
            constraintStartedAt: startedAt,
          };
        }
      }

      // SRC-01a: qty_requested is a LEVEL (shortfall), not a delta. Re-queueing
      // the same variant+supplier raises the level to the higher of the two —
      // adding would double-count the same missing units toward MOQ.
      const existing = await trx('reorder_requests')
        .where({ shop_id: shopId, lasyncro_variant_id, supplier_id, status: 'pending' })
        .forUpdate()
        .first();

      /**
       * MATERIAL CHANGE, not a successful HTTP call.
       *
       * An intervention claims a merchant did something. Re-submitting the same
       * level, or a lower one against an already-higher pending request, changes
       * no durable purchasing state — the level rule above deliberately keeps
       * the higher value. Counting those would inflate attribution with clicks.
       *
       * Material iff a new pending request was created, or an existing one's
       * persisted level genuinely increased.
       */
      let previousQtyRequested: number | null = null;
      let resultingQtyRequested = qty_requested;
      let materialChange = true;

      if (existing) {
        previousQtyRequested = Number(existing.qty_requested);
        resultingQtyRequested = Math.max(previousQtyRequested, qty_requested);
        materialChange = resultingQtyRequested > previousQtyRequested;

        const [updated] = await trx('reorder_requests')
          .where({ id: existing.id })
          .update({
            qty_requested: resultingQtyRequested,
            source,
            updated_at:    trx.fn.now(),
          })
          .returning('*');
        row = updated;
      } else {
        const [inserted] = await trx('reorder_requests')
          .insert({
            shop_id:             shopId,
            lasyncro_variant_id,
            supplier_id,
            qty_requested,
            source,
            status:              'pending',
            created_by:          userId ?? null,
          })
          .returning('*');

        row = inserted;
      }

      /**
       * DURABLE INTERVENTION — only when the purchasing mutation materially
       * succeeded AND an exact active constraint was attributable.
       *
       * Same transaction as the reorder write on purpose: an intervention whose
       * treatment rolled back is a lie, and a treatment with no recorded
       * provenance is unattributable.
       *
       * The constraint is NOT resolved here and no outcome is stored. Canonical
       * resolution stays with the inventory lifecycle (receive close / stow
       * confirm -> revalidateOrdersForReceivedVariants), which may not happen
       * for days — or ever.
       */
      if (attribution && materialChange) {
        await trx('decision_interventions').insert({
          id: crypto.randomUUID(),
          shop_id: shopId,
          entity_type: 'order',
          entity_id: originating_order_id,
          constraint_id: attribution.constraintId,
          // No decisions row is required. open_sourcing is never enqueued, and
          // decision lifecycle is not outcome truth.
          decision_id: null,
          treatment_key: INVENTORY_TREATMENT_KEY,
          action_key: INVENTORY_ACTION_KEY,
          actor_type: 'user',
          actor_user_id: userId ?? null,
          source_surface: INVENTORY_SOURCE_SURFACE,
          occurred_at: trx.fn.now(),
          metadata: JSON.stringify({
            variant_id: lasyncro_variant_id,
            supplier_id,
            reorder_request_id: row.id,
            requested_qty: qty_requested,
            previous_qty_requested: previousQtyRequested,
            resulting_qty_requested: resultingQtyRequested,
            // Episode anchor — see the attribution lookup above.
            constraint_started_at:
              attribution.constraintStartedAt instanceof Date
                ? attribution.constraintStartedAt.toISOString()
                : attribution.constraintStartedAt,
            shown_treatment_key: normalizeShownTreatmentKey(shown_treatment_key),
          }),
        });
      }

      await enqueueShopSnapshotJob(trx, shopId);
    });

    if (!row) return res.status(404).json({ error: 'Supplier or variant not found' });
    return res.status(201).json({ request: row });
  } catch (err) {
    console.error('[reorder-requests] httpCreateReorderRequest failed', err);
    return res.status(500).json({ error: 'Failed to create reorder request' });
  }
}

// ── DELETE /reorder-requests/:id ──────────────────────────────────────────────
// Dismisses a single pending request. 400 if already converted.
export async function httpDeleteReorderRequest(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  try {
    let found = false;
    let alreadyConverted = false;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const existing = await trx('reorder_requests')
        .where({ id, shop_id: shopId })
        .first();

      if (!existing) return;
      found = true;

      if (existing.status !== 'pending') {
        alreadyConverted = true;
        return;
      }

      await trx('reorder_requests')
        .where({ id, shop_id: shopId })
        .update({ status: 'dismissed', updated_at: trx.fn.now() });
      await enqueueShopSnapshotJob(trx, shopId);
    });

    if (!found) return res.status(404).json({ error: 'Request not found' });
    if (alreadyConverted) return res.status(400).json({ error: 'Only pending requests can be dismissed' });
    return res.status(204).send();
  } catch (err) {
    console.error('[reorder-requests] httpDeleteReorderRequest failed', err);
    return res.status(500).json({ error: 'Failed to dismiss reorder request' });
  }
}

// ── POST /reorder-requests/convert ───────────────────────────────────────────
// Converts all pending requests for a supplier into a single PO.
// Line items: one per unique variant, qty = sum of all pending requests for that variant.
// Marks all converted requests: status='converted', converted_po_id, converted_at.
export async function httpConvertReorderRequests(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { supplier_id, expected_delivery_date, notes, override_moq } = req.body ?? {};

  if (!supplier_id) {
    return res.status(400).json({ error: 'supplier_id is required' });
  }

  try {
    let poId: string | null = null;
    // SRC-01a: gate rejections surface as an explicit reason, never a silent
    // no-op. null means "no gate blocked"; a string is returned as 422 below.
    let gateFailure: string | null = null;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const supplier = await trx('suppliers')
        .where({ id: supplier_id, shop_id: shopId })
        .first();
      if (!supplier) {
        gateFailure = 'Supplier not found';
        return;
      }

      // Fetch all pending for this supplier
      const pending = await trx('reorder_requests as rr')
        .join('variants as v', 'v.lasyncro_variant_id', 'rr.lasyncro_variant_id')
        .where('rr.shop_id', shopId)
        .andWhere('rr.supplier_id', supplier_id)
        .andWhere('rr.status', 'pending')
        .select('rr.id', 'rr.lasyncro_variant_id', 'rr.qty_requested', 'v.sku', 'v.title');

      if (!pending.length) return; // null poId + null gateFailure signals 400 below

      // ── GATES (workshop SRC-01, Decision 2) ─────────────────────────────
      // G3 lead time and G4 SKU are hard: neither can be overridden, because a
      // PO without an ETA cannot be projected and a line without a SKU cannot
      // be received. G2 MOQ is soft: suppliers grant exceptions, so the
      // operator may override — but the override is stamped on the PO notes.
      const leadTimeDays = supplier.lead_time_days !== null ? Number(supplier.lead_time_days) : null;
      if (leadTimeDays === null) {
        gateFailure = 'Supplier has no lead time set — set a delivery time before ordering';
        return;
      }

      const missingSku = pending.filter((r: any) => !r.sku);
      if (missingSku.length) {
        gateFailure = `${missingSku.length} queued line(s) have no SKU — add a SKU before ordering`;
        return;
      }

      const totalQty = pending.reduce((sum: number, r: any) => sum + Number(r.qty_requested), 0);
      const moq      = supplier.moq !== null ? Number(supplier.moq) : null;
      const belowMoq = moq !== null && totalQty < moq;

      if (belowMoq && override_moq !== true) {
        gateFailure = `MOQ not met — ${totalQty}/${moq} units. Pass override_moq to order anyway`;
        return;
      }

      // Collapse to one line item per variant — sum qty across multiple requests
      const lineItemMap = new Map<string, { description: string; qty: number; lasyncro_variant_id: string }>();
      for (const r of pending) {
        const key = r.lasyncro_variant_id;
        if (!lineItemMap.has(key)) {
          lineItemMap.set(key, {
            lasyncro_variant_id: r.lasyncro_variant_id,
            description:         r.sku ?? r.title ?? r.lasyncro_variant_id,
            qty:                 0,
          });
        }
        lineItemMap.get(key)!.qty += Number(r.qty_requested);
      }

      //Create PO
      // SRC-01a: ETA is derived from the supplier lead time when the caller
      // does not supply one. expected_delivery_date is a DATE column.
      const derivedEta = new Date(Date.now() + leadTimeDays * 86400000)
        .toISOString()
        .slice(0, 10);

      // SRC-01a: an under-MOQ order is a decision, not an accident — record it
      // on the PO so the merchant and the supplier both see why.
      const moqNote  = belowMoq ? `Below MOQ: ${totalQty}/${moq} units (override)` : null;
      const poNotes  = [moqNote, notes].filter(Boolean).join('\n') || null;

      // Create PO
      const [po] = await trx('purchase_orders')
        .insert({
          shop_id:                shopId,
          supplier_id,
          // Cast required — status is purchase_order_status enum, not text
          status:                 trx.raw("'draft'::purchase_order_status"),
          expected_delivery_date: expected_delivery_date ?? derivedEta,
          notes:                  poNotes,
          // purchase_orders has no created_by column — omitted
        })
        .returning('id');

      poId = po.id;

      // shop_id required on line items — tenant isolation policy enforces it
      await trx('purchase_order_line_items').insert(
        Array.from(lineItemMap.values()).map((item) => ({
          po_id:               poId,
          shop_id:             shopId,
          lasyncro_variant_id: item.lasyncro_variant_id,
          description:         item.description,
          quantity_ordered:    item.qty,
          quantity_received:   0,
        }))
      );

      // Mark all pending requests as converted
      const now = new Date();
      await trx('reorder_requests')
        .whereIn('id', pending.map((r: any) => r.id))
        .update({
          status:          'converted',
          converted_po_id: poId,
          converted_at:    now,
          updated_at:      now,
        });
      await enqueueShopSnapshotJob(trx, shopId);
    });

    // SRC-01a: 422 = gate blocked (actionable), 400 = nothing queued.
    if (gateFailure) return res.status(422).json({ error: gateFailure });
    if (!poId) return res.status(400).json({ error: 'No pending requests found for this supplier' });
    return res.status(201).json({ po_id: poId });
  } catch (err) {
    console.error('[reorder-requests] httpConvertReorderRequests failed', err);
    return res.status(500).json({ error: 'Failed to convert reorder requests' });
  }
}
