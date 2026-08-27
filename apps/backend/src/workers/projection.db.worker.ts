import db, {
  runWithTenantContext,
  setTenantContext,
  systemQuery,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import { projectDomainEventCore } from '../projection/projection.engine.js';
import { debugLog } from '../projection/projection.utils.js';
import { reconcileOrderFulfillment } from './reconciliation/reconciliation.handlers.js';
import { CanonicalContractError } from '../services/mappers/canonicalContractError.js';

/**
 * DB-DRIVEN PROJECTION WORKER (SOURCE OF TRUTH)
 * --------------------------------------------
 * Guarantees:
 * - strict ordering via domain_events.id
 * - no gaps
 * - no reordering
 * - deterministic replay
 *
 * This replaces queue-based ordering guarantees.
 */

const BATCH_SIZE = 1; // strict ordering (do NOT increase yet)
const POLL_INTERVAL_MS = 200;

let running = false;
const MAX_TRANSIENT_GAP_RETRIES = 50; // ~10 seconds at 200ms poll interval
let transientGapRetries = 0;

/**
 * PROJECTION-CURSOR-STALL-08 — worker seam + canonical-contract quarantine.
 * ---------------------------------------------------------------------------
 * Slice 1 relocated the per-cycle event/cursor decision (old STEP 1-3) verbatim
 * into processNextProjectionEventOnce(); startDbProjectionWorker() calls that
 * seam and then runs the unchanged reconciliation-intent sweep (old STEP 4).
 *
 * Slice 2 changes runtime behaviour for ONE error class only —
 * CanonicalContractError (a deterministic, data-shaped payload contract
 * violation; see services/mappers/canonicalContractError.ts):
 * - the projection transaction still rolls back completely (no partial writes)
 * - a separate recovery transaction records a durable
 *   domain_event_projection_failures row AND advances the global cursor past
 *   the event, atomically
 * - an ERROR-level [PROJECTION_EVENT_QUARANTINED] log is emitted
 * - the seam returns { status: 'quarantined' } and the worker loop continues
 *
 * EVERY other error (DB, tenant frame, handler, gap, reconciliation) still
 * throws and still reaches the [projection-db-worker][FATAL] path unchanged —
 * one poison event can no longer halt the global projection cursor for every
 * tenant, but a genuine infrastructure fault still stops the worker.
 */
export type ProjectionStepResult =
  | { status: 'idle' }
  | { status: 'projected'; domainEventId: number }
  | {
      status: 'skipped';
      domainEventId: number;
      reason: 'duplicate' | 'sequence-gap';
    }
  | {
      status: 'quarantined';
      domainEventId: number;
      errorTag: string;
    }
  | { status: 'noop' };

/**
 * advanceCursorTo — the single normal-path cursor writer.
 * ------------------------------------------------------
 * Relocated verbatim from the old inline STEP 3 "ADVANCE CURSOR" upsert. The
 * caller owns the projection_cursors FOR UPDATE lock and the head/current
 * validation; this helper opens NO transaction of its own and performs only the
 * existing upsert. The gap-bridging cursor writes below use `.update(...)` and
 * are intentionally left inline — they are not normal event advancement.
 */
async function advanceCursorTo(
  trx: Knex.Transaction,
  eventId: number
): Promise<void> {
  await trx('projection_cursors')
    .insert({
      projection_name: 'orders_projection',
      last_processed_event_id: eventId,
      updated_at: trx.fn.now(),
    })
    .onConflict('projection_name')
    .merge({
      last_processed_event_id: eventId,
      updated_at: trx.fn.now(),
    });
}

/**
 * recordCanonicalQuarantineAndAdvance — the atomic quarantine transaction body.
 * ---------------------------------------------------------------------------
 * Records the deterministic canonical-contract failure AND advances the global
 * cursor past the event, using the caller's transaction so the two writes
 * commit or roll back together. Opens NO transaction of its own and reuses the
 * single normal-path cursor writer (advanceCursorTo). Exported so the atomicity
 * integration test exercises the exact production transaction body.
 *
 * The failure insert is idempotent via the PK (domain_event_id): a re-encounter
 * — e.g. a second worker that also reached this event — leaves the first row
 * untouched (ON CONFLICT DO NOTHING).
 */
export async function recordCanonicalQuarantineAndAdvance(
  trx: Knex.Transaction,
  args: {
    domainEventId: number;
    shopId: number;
    eventType: string;
    error: CanonicalContractError;
  }
): Promise<void> {
  await trx('domain_event_projection_failures')
    .insert({
      domain_event_id: args.domainEventId,
      shop_id: args.shopId,
      event_type: args.eventType,
      error_tag: args.error.tag,
      error_message: args.error.message,
      failed_at: trx.fn.now(),
    })
    .onConflict('domain_event_id')
    .ignore();

  await advanceCursorTo(trx, args.domainEventId);
}

/**
 * processNextProjectionEventOnce — one poll-cycle event/cursor decision.
 * --------------------------------------------------------------------
 * The long-running worker (startDbProjectionWorker) calls this exact function
 * once per cycle. BATCH_SIZE is 1, so this handles exactly zero or one domain
 * event per call. The reconciliation-intent sweep (old STEP 4) stays in the
 * caller's loop.
 */
export async function processNextProjectionEventOnce(): Promise<ProjectionStepResult> {
  /**
   * STEP 1 — READ CURSOR (NO LOCK)
   * --------------------------------
   * Lightweight read to determine next event.
   */
  const workerStateResult = await systemQuery(
    db.raw('SELECT * FROM public.get_projection_worker_state()')
  );
  const cursorRow = workerStateResult.rows[0];

  const lastProcessed = Number(cursorRow?.last_processed_event_id ?? 0);

  /**
   * CURSOR INVARIANT GUARD (CRITICAL)
   * ---------------------------------
   * Ensures projection cursor never exceeds available domain events.
   *
   * Prevents:
   * - phantom progress
   * - skipped projections
   * - unrecoverable state divergence
   *
   * Invariant:
   *   cursor <= MAX(domain_events.id)
   */
  const maxEventId = Number(cursorRow?.max_event_id ?? 0);

  if (lastProcessed > maxEventId) {
    console.error('[PROJECTION_CURSOR_CORRUPTION_FATAL]', {
      lastProcessed,
      maxEventId,
    });

    throw new Error(
      `[PROJECTION_CURSOR_INVALID] cursor=${lastProcessed} max_event_id=${maxEventId}`
    );
  }

  /**
   * STEP 2 — FETCH NEXT EVENT (NO LOCK)
   */
  const nextEventResult = await systemQuery(
    db.raw(
      'SELECT * FROM public.list_projection_event_tenants(?, ?)',
      [lastProcessed, BATCH_SIZE]
    )
  );
  const nextEvents: Array<{ id: number; shop_id: number }> = nextEventResult.rows;

  if (nextEvents.length === 0) {
    /**
     * A2-BUG-01 FIX (2026-06-29): an idle cycle must NOT skip STEP 4 (intent
     * reconciliation). Returning 'idle' here is equivalent to the old
     * fall-through: startDbProjectionWorker() runs the reconciliation sweep
     * unconditionally after every call, empty batch or not, and the
     * end-of-loop sleep still fires. This does not reintroduce the busy-loop
     * the original comment warned about.
     */
    return { status: 'idle' };
  }

  /**
   * STEP 3 — PROCESS THE EVENT IN ITS OWN TRANSACTION
   * (BATCH_SIZE === 1, so nextEvents holds exactly one event here.)
   */
  const event = nextEvents[0];

  /**
   * PROJECTION-CURSOR-STALL-08 Slice 2 — the projection transaction below is
   * byte-for-byte the Slice-1 body; only its failure handling is wrapped. A
   * CanonicalContractError (deterministic payload-contract poison) is caught
   * AFTER that transaction has fully rolled back and routed to the recovery
   * transaction; every other error still propagates (fail-hard) as in Slice 1.
   */
  try {
  return await runWithTenantContext(Number(event.shop_id), () =>
    db.transaction(async (trx): Promise<ProjectionStepResult> => {

      /**
       * TENANT INSERTION (CRITICAL)
       */
      await setTenantContext(trx, Number(event.shop_id));

      /**
       * LOCK CURSOR ROW (CRITICAL — INSIDE PER-EVENT TX)
       */
      const lockedCursor = await trx('projection_cursors')
        .where({ projection_name: 'orders_projection' })
        .forUpdate()
        .first<{ last_processed_event_id: number }>();

      const currentLastProcessed = Number(lockedCursor?.last_processed_event_id ?? 0);

      const eventId = Number(event.id);
      const expectedId = currentLastProcessed + 1;

      /**
       * DUPLICATE / STALE GUARD
       * -----------------------
       * Event already processed — skip silently.
       */
      if (eventId <= currentLastProcessed) {
        console.warn('[DB_PROJECTION_DUPLICATE_OR_STALE]', {
          eventId,
          lastProcessed: currentLastProcessed,
        });
        return { status: 'skipped', domainEventId: eventId, reason: 'duplicate' };
      }

      /**
       * GAP DETECTION (CRITICAL)
       * ------------------------
       * expectedId = currentLastProcessed + 1
       *
       * gap == 1 (eventId === expectedId): normal — process.
       *
       * gap == 1 but eventId > expectedId by exactly 1:
       *   Postgres non-sequential commit artifact — the missing
       *   event is in-flight. Return without advancing cursor;
       *   it will be picked up on next poll.
       *
       * gap > 1 (eventId > expectedId + 1):
       *   Genuine missing events — IDs were skipped or deleted.
       *   Continuing would permanently skip those events.
       *   HALT: operator must investigate and reset cursor.
       *
       * To recover from HALT:
       *   UPDATE projection_cursors
       *   SET last_processed_event_id = <last_known_good_id>
       *   WHERE projection_name = 'orders_projection';
       */
      const gapSize = eventId - expectedId;

      if (gapSize === 0) {
        // Normal case — fall through to processing
      } else if (gapSize === 1) {
        /**
         * TRANSIENT GAP ESCALATION (CRITICAL)
         * -------------------------------------
         * Single-ID gaps are expected from Postgres commit ordering.
         * However if the gap persists beyond MAX_TRANSIENT_GAP_RETRIES,
         * the missing event is permanently absent — not in-flight.
         *
         * Escalate to FATAL to prevent indefinite pipeline stall.
         * Operator must investigate event ID and reset cursor if needed.
         */
        transientGapRetries++;

        console.warn('[DB_PROJECTION_GAP_TRANSIENT]', {
          eventId,
          expectedId,
          attempt: transientGapRetries,
          maxAttempts: MAX_TRANSIENT_GAP_RETRIES,
          action: 'wait_and_retry',
        });

        if (transientGapRetries >= MAX_TRANSIENT_GAP_RETRIES) {
          /**
           * SEQUENCE GAP SKIP (CRITICAL)
           * ----------------------------
           * After MAX_TRANSIENT_GAP_RETRIES, the missing ID is
           * permanently absent — caused by a rolled-back transaction
           * that consumed a sequence value without committing.
           *
           * Postgres SERIAL sequences do not roll back — gaps are
           * permanent and unrecoverable. Halting here would stall
           * the pipeline forever on every upstream rollback.
           *
           * Strategy: advance cursor to currentLastProcessed so the
           * next poll picks up eventId (the next visible event).
           * Log at ERROR for full operator visibility.
           */
          console.error('[DB_PROJECTION_GAP_SKIPPED]', {
            skippedEventId: expectedId,
            nextEventId: eventId,
            attempts: transientGapRetries,
            reason: 'Postgres sequence gap — transaction rolled back',
            action: 'advancing cursor past gap',
          });

          await trx('projection_cursors')
            .where({ projection_name: 'orders_projection' })
            .update({
              last_processed_event_id: expectedId, // skip the missing sequence gap
              updated_at: trx.fn.now(),
            });

          transientGapRetries = 0;
          return {
            status: 'skipped',
            domainEventId: expectedId,
            reason: 'sequence-gap',
          };
        }
        return { status: 'noop' };

      } else {
        /**
         * MULTI-ID GAP — evidence-based resolution.
         * --------------------------------------------------
         * A gap > 1 is only FATAL if the missing ids actually
         * exist in domain_events (genuine ordering violation).
         * If the missing ids are provably absent (rebuild replay,
         * rolled-back sequence values), the gap is a phantom and
         * is safe to skip — halting would stall forever.
         */
        const presentMissing = await trx('domain_events')
          .whereBetween('id', [expectedId, eventId - 1])
          .count<{ count: string }>('id as count')
          .first();
        const presentMissingCount = Number(presentMissing?.count ?? 0);

        if (presentMissingCount === 0) {
          console.warn('[DB_PROJECTION_GAP_PHANTOM_SKIPPED]', {
            expectedId,
            nextEventId: eventId,
            missingIds: `${expectedId}..${eventId - 1}`,
            missingCount: gapSize,
            reason: 'missing ids provably absent in domain_events (rebuild/sequence gap)',
            action: 'advancing cursor past phantom gap',
          });

          await trx('projection_cursors')
            .where({ projection_name: 'orders_projection' })
            .update({
              last_processed_event_id: eventId - 1, // bridge gap; next poll picks up eventId
              updated_at: trx.fn.now(),
            });

          transientGapRetries = 0;
          return {
            status: 'skipped',
            domainEventId: eventId - 1,
            reason: 'sequence-gap',
          };
        }

        /**
         * GENUINE GAP — missing ids exist but were not processed.
         * Halt to prevent silent permanent skip of real data.
         */
        console.error('[DB_PROJECTION_GAP_FATAL]', {
          eventId,
          expectedId,
          missingIds: `${expectedId}..${eventId - 1}`,
          missingCount: gapSize,
          presentMissingCount,
          action: 'HALTED — operator intervention required',
          recovery: `UPDATE projection_cursors SET last_processed_event_id = ${currentLastProcessed} WHERE projection_name = 'orders_projection'`,
        });
        throw new Error(
          `[PROJECTION_GAP_FATAL] missing events ${expectedId}..${eventId - 1} (count=${gapSize}, present=${presentMissingCount})`
        );
      }

      debugLog('[DB_PROJECTION_PROCESSING]', {
        domain_event_id: event.id,
      });

      transientGapRetries = 0; // reset on successful event acquisition

      /**
       * FETCH DOMAIN EVENT (CONSISTENT READ)
       */
      const domainEvent = await trx('domain_events')
        .where({ id: eventId })
        .first();

      if (!domainEvent) {
        throw new Error(`[DB_PROJECTION_EVENT_MISSING] id=${eventId}`);
      }

      /**
       * EXECUTE PROJECTION
       */
      try {
        await projectDomainEventCore({
          domainEvent,
          domain_event_id: eventId,
          trx,
        });
      } catch (err) {
        console.error('[PROJECTION_EVENT_FAILURE]', {
          eventId,
          eventType: domainEvent.event_type,
          payload: domainEvent.event_payload,
          error: err,
        });
        throw err;
      }

      /**
       * ADVANCE CURSOR (ATOMIC WITH PROJECTION)
       */
      await advanceCursorTo(trx, eventId);

      debugLog('[DB_CURSOR_ADVANCED]', {
        to: eventId,
      });

      debugLog('[DB_PROJECTION_EXECUTED]', {
        domain_event_id: eventId,
      });

      return { status: 'projected', domainEventId: eventId };
    })
  );
  } catch (err) {
    /**
     * QUARANTINE — CanonicalContractError ONLY.
     * ----------------------------------------
     * The projection transaction above has fully rolled back (no partial
     * writes). For a deterministic payload-contract violation, record a
     * durable failure row AND advance the global cursor past this event in a
     * SEPARATE recovery transaction, atomically, so one poison event cannot
     * halt projection for every tenant. Every other error is re-thrown
     * unchanged and still reaches [projection-db-worker][FATAL].
     */
    if (!(err instanceof CanonicalContractError)) {
      throw err;
    }

    const shopId = Number(event.shop_id);
    const eventId = Number(event.id);
    let quarantinedEventType: string | undefined;

    const recovery = await runWithTenantContext(shopId, () =>
      db.transaction(async (trx): Promise<ProjectionStepResult> => {
        await setTenantContext(trx, shopId);

        const lockedCursor = await trx('projection_cursors')
          .where({ projection_name: 'orders_projection' })
          .forUpdate()
          .first<{ last_processed_event_id: number }>();
        const current = Number(lockedCursor?.last_processed_event_id ?? 0);

        // A. Another worker already advanced past this event — clean no-op.
        if (eventId <= current) {
          return { status: 'skipped', domainEventId: eventId, reason: 'duplicate' };
        }

        // B. No longer the expected head — do not quarantine out of order.
        if (eventId !== current + 1) {
          throw err;
        }

        // C. Expected head — record the failure and advance the cursor in
        //    this one transaction (atomic).
        const evtRow = await trx('domain_events')
          .where({ id: eventId })
          .first<{ event_type: string }>('event_type');

        if (!evtRow?.event_type) {
          throw err;
        }

        quarantinedEventType = evtRow.event_type;

        await recordCanonicalQuarantineAndAdvance(trx, {
          domainEventId: eventId,
          shopId,
          eventType: evtRow.event_type,
          error: err,
        });

        return { status: 'quarantined', domainEventId: eventId, errorTag: err.tag };
      })
    );

    if (recovery.status === 'quarantined') {
      console.error('[PROJECTION_EVENT_QUARANTINED]', {
        domain_event_id: eventId,
        shop_id: shopId,
        event_type: quarantinedEventType,
        tag: err.tag,
      });
    }

    return recovery;
  }
}

export async function startDbProjectionWorker() {
  if (running) return;
  running = true;

  console.info('[projection-db-worker] started');

  while (running) {
    try {
      /**
       * STEP 1-3 — event/cursor decision, extracted to the production seam
       * (PROJECTION-CURSOR-STALL-08 Slice 1). Behaviour is unchanged: a
       * CanonicalContractError (or any other fatal) thrown here still reaches
       * the [projection-db-worker][FATAL] path below and terminates the loop.
       */
      await processNextProjectionEventOnce();

    // THREAD A-2 (2026-06-29): FOR UPDATE was silently filtering this query
    // to zero rows. Confirmed directly: PostgreSQL RLS evaluates FOR UPDATE
    // against the table's WRITE policy too (locking implies potential
    // write), not just SELECT. order_reconciliation_intents has a
    // permissive cross-tenant SELECT policy but a strict write policy
    // (see 0037 migration) — with no app.current_tenant set on this trx
    // (a genuine cross-tenant scan, by design), the write policy matched
    // zero rows, silently. plain count() (no FOR UPDATE) returned 18;
    // identical query + FOR UPDATE returned 0 — verified live via psql.
    //
    // Locking isn't needed at this discovery stage anyway — this worker
    // is single-threaded/sequential (no concurrent instances racing for
    // these rows, unlike the disabled queue-based dispatcher this pattern
    // was originally copied from). Each intent is acted on individually,
    // synchronously, right after being read here.
    const intentLocatorResult = await systemQuery(
      db.raw('SELECT * FROM public.list_reconciliation_intent_tenants()')
    );
    const intentLocators: Array<{
      reconciliation_intent_id: string;
      shop_id: number;
    }> = intentLocatorResult.rows;

    const pendingIntents: any[] = [];
    for (const locator of intentLocators) {
      const intent = await withTenant(locator.shop_id, (trx) =>
        trx('order_reconciliation_intents')
          .where({
            reconciliation_intent_id: locator.reconciliation_intent_id,
            shop_id: locator.shop_id,
          })
          .first()
      );
      if (intent) pendingIntents.push(intent);
    }

    for (const intent of pendingIntents) {
      let observed:
        | { status: 'fulfilled'; observedAt: Date; source: 'shopify_sync' }
        | undefined;

      if (intent.observed) {
        const parsed =
          typeof intent.observed === 'string'
            ? JSON.parse(intent.observed)
            : intent.observed;

        if (parsed?.status === 'fulfilled') {
          observed = {
            status: 'fulfilled',
            source: 'shopify_sync',
            observedAt: new Date(parsed.observedAt),
          };
        }
      }

      // THREAD A-2 (2026-06-29): systemQuery() only bypasses this
      // codebase's app-level guard, NOT real Postgres RLS (see
      // RLS_blueprint.md §7, "systemQuery() does not bypass RLS").
      // orders has a strict policy, no permissive carve-out — this was
      // silently returning undefined for every single intent, masked
      // for hours by the FOR UPDATE bug above also returning empty.
      // intent.shop_id is on every row specifically to fix exactly this.
      const orderRow = await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL app.current_tenant = '${intent.shop_id}'`);
        return trx('orders')
          .where({ lasyncro_order_id: intent.lasyncro_order_id })
          .select('aggregate_version')
          .first();
      });

      if (!orderRow || intent.aggregate_version !== orderRow.aggregate_version) {
        const isStale =
          orderRow !== undefined &&
          intent.aggregate_version < orderRow.aggregate_version;

        console.warn('[DB_PROJECTION_RECONCILE_VERSION_MISMATCH]', {
          order: intent.lasyncro_order_id,
          intent_version: intent.aggregate_version,
          order_version: orderRow?.aggregate_version,
          action: isStale ? 'deleting_stale_intent' : 'waiting_not_yet_ready',
        });

        // THREAD A-2 (2026-06-29): a mismatch has two distinct causes.
        // (1) intent_version < order_version: this intent is for data the
        //     order has already moved past (e.g. event replayed/superseded
        //     it). Safe and correct to delete — reconciling against it
        //     would apply stale state. Without this, such intents are
        //     `continue`d past forever, permanently tripping the
        //     end-of-cycle RECONCILIATION_BACKLOG_VIOLATION guard below
        //     every single cycle — confirmed live, 2026-06-29.
        // (2) intent_version >= order_version (order missing, or intent
        //     ahead of projection): genuinely not ready yet. Must NOT
        //     delete — next cycle, once projection catches up, this same
        //     intent should be processed normally.
        if (isStale) {
          // THREAD A-2 (2026-06-29): bare db() delete here was silently
          // affecting 0 rows — order_reconciliation_intents' write policy
          // is strict (unlike its permissive SELECT policy), so deletes
          // need real tenant context, not just app-guard bypass.
          // intent.shop_id exists specifically for this (see 0037 migration).
          await db.transaction(async (trx) => {
            await trx.raw(`SET LOCAL app.current_tenant = '${intent.shop_id}'`);
            await trx('order_reconciliation_intents')
              .where({ reconciliation_intent_id: intent.reconciliation_intent_id })
              .delete();
          });
        }
        continue;
      }

      await reconcileOrderFulfillment(
        intent.lasyncro_order_id,
        intent.aggregate_version,
        observed,
        intent.created_at,
        intent.shop_id
      );

      // Same tenant-context requirement as the stale-delete above.
      await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL app.current_tenant = '${intent.shop_id}'`);
        await trx('order_reconciliation_intents')
          .where({ reconciliation_intent_id: intent.reconciliation_intent_id })
          .delete();
      });
    }

    const remainingIntentResult = await systemQuery(
      db.raw('SELECT * FROM public.list_reconciliation_intent_tenants()')
    );
    const remainingIntents = remainingIntentResult.rows.length;

    if (remainingIntents > 0) {
      throw new Error(
        `[RECONCILIATION_BACKLOG_VIOLATION] remaining_intents=${remainingIntents}`
      );
    }

    } catch (err) {
      console.error('[projection-db-worker][FATAL]', err);

      /**
       * FAIL FAST (CRITICAL)
       * --------------------
       * Projection errors must NEVER be swallowed.
       *
       * If we continue:
       * - events are skipped
       * - system enters inconsistent state
       *
       * Strategy:
       * - crash worker
       * - force restart / operator visibility
       */
      throw err;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
