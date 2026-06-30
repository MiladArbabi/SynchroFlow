import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { projectDomainEventCore } from '../projection/projection.engine.js';
import { debugLog } from '../projection/projection.utils.js';
import { reconcileOrderFulfillment } from './reconciliation/reconciliation.handlers.js';

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

export async function startDbProjectionWorker() {
  if (running) return;
  running = true;

  console.info('[projection-db-worker] started');

  while (running) {
    try {
      /**
 * STEP 1 — READ CURSOR (NO LOCK)
 * --------------------------------
 * Lightweight read to determine next event.
 */
const cursorRow = await db('projection_cursors')
  .where({ projection_name: 'orders_projection' })
  .first<{ last_processed_event_id: number }>();

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
const maxEventRow = await db('domain_events')
  .max<{ max: number }>('id as max')
  .first();

const maxEventId = Number(maxEventRow?.max ?? 0);

if (lastProcessed > maxEventId) {
  console.error('[PROJECTION_CURSOR_CORRUPTION_FATAL]', {
    lastProcessed,
    maxEventId
  });

  throw new Error(
    `[PROJECTION_CURSOR_INVALID] cursor=${lastProcessed} max_event_id=${maxEventId}`
  );
}

/**
 * STEP 2 — FETCH NEXT EVENT (NO LOCK)
 */
const nextEvents = await db('domain_events')
  .where('id', '>', lastProcessed)
  .orderBy('id', 'asc')
  .limit(BATCH_SIZE);

if (nextEvents.length === 0) {
  /**
   * A2-BUG-01 FIX (2026-06-29): previously `continue`'d here, which
   * skipped STEP 4 (intent reconciliation) on every idle cycle — i.e.
   * every cycle once the cursor catches up, which is most cycles in
   * steady state. That made leftover/orphaned intents (e.g. from a
   * crash mid-reconciliation) permanently stuck — never retried.
   *
   * Fix: do NOT continue. Let control fall through — the STEP 3 `for`
   * loop below is naturally a no-op on an empty array, and STEP 4
   * still runs every cycle as originally intended. The end-of-loop
   * sleep (line ~443) still fires either way, so this does not
   * reintroduce the busy-loop the original comment warned about.
   */
}

/**
 * STEP 3 — PROCESS EACH EVENT IN ITS OWN TRANSACTION
 */
for (const event of nextEvents) {

    await db.transaction(async (trx) => {

        /**
         * TENANT INSERTION (CRITICAL)
         */
        await trx.raw(`SET LOCAL app.current_tenant = '${event.shop_id}'`);

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
          return;
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
            return;
          }
          return;

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
            return;
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
            trx
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

        debugLog('[DB_CURSOR_ADVANCED]', {
          to: eventId,
        });

        debugLog('[DB_PROJECTION_EXECUTED]', {
          domain_event_id: eventId,
        });
      });
    }

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
    const pendingIntents = await db('order_reconciliation_intents')
      .orderBy('created_at', 'asc');

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

    const remainingIntentsRow = await db('order_reconciliation_intents')
      .count<{ count: string }>('reconciliation_intent_id as count')
      .first();

    const remainingIntents = Number(remainingIntentsRow?.count ?? 0);

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