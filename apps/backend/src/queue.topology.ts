// apps/backend/src/queue.topology.ts
//
// CANONICAL QUEUE TOPOLOGY (I-09)
// --------------------------------
// Single authoritative declaration of all RabbitMQ queues and exchanges.
//
// INVARIANT:
// All queues must be declared HERE before any producer or consumer
// attaches. This prevents:
// - Silent message loss (RabbitMQ drops messages to undeclared queues)
// - Race conditions between producer and consumer startup
// - Topology drift across workers
//
// CHANGE POLICY:
// Adding a new queue → add it here FIRST, then wire producer/consumer.
// Never assert a queue exclusively inside a worker or service.

import { connection } from './queue.js';

/**
 * QUEUE REGISTRY
 * --------------
 * All queues with their topology parameters.
 *
 * durable: true  → survives RabbitMQ restart
 * deadLetterExchange: routes failed messages to DLX for inspection
 */
const TOPOLOGY = [
  // ── Core event pipeline ──────────────────────────────────────────
  {
    type: 'exchange' as const,
    name: 'events.dlx',
    kind: 'direct',
    options: { durable: true },
  },
  {
    type: 'queue' as const,
    name: 'events',
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'events.dlx',
        'x-dead-letter-routing-key': 'dead',
        'x-single-active-consumer': true,
      },
    },
  },
  {
    type: 'queue' as const,
    name: 'events.dead',
    options: { durable: true },
  },

  // ── Sync pipeline ────────────────────────────────────────────────
  {
    type: 'queue' as const,
    name: 'sync_jobs',
    options: { durable: true },
  },

  // ── Webhook dispatch ─────────────────────────────────────────────
  {
    type: 'queue' as const,
    name: 'webhook.dispatch.v1',
    options: { durable: true },
  },

  // ── Product ingestion ─────────────────────────────────────────────
  {
    type: 'queue' as const,
    name: 'product_ingestion',
    options: { durable: true },
  },

  // ── Specter session ingestion ────────────────────────────────────
  {
    type: 'queue' as const,
    name: 'specter_events',
    options: { durable: true },
  },

  // ── Execution pipeline (with DLX) ───────────────────────────────
  {
    type: 'exchange' as const,
    name: 'execution.dlx',
    kind: 'direct',
    options: { durable: true },
  },
  {
    type: 'queue' as const,
    name: 'execution.jobs.v1',
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'execution.dlx',
        'x-dead-letter-routing-key': 'execution.jobs.v1.dlq',
      },
    },
  },
  {
    type: 'queue' as const,
    name: 'execution.jobs.v1.dlq',
    options: {
      durable: true,
      arguments: {
        'x-message-ttl': 5000,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'execution.jobs.v1',
      },
    },
  },

  // ── Fulfillment reconciliation ───────────────────────────────────
  // NOTE: Reconciliation consumer is disabled (runs inline in processDomainEvent).
  // Queue declared to prevent silent accumulation if ever re-enabled.
  // Args MUST mirror reconciliation.consumer.ts:31 and the live durable queue
  // (x-dead-letter-exchange=fulfillment.reconciliation.dlx). Omitting them
  // triggers 406 PRECONDITION_FAILED on declare and crashes the worker.
  {
    type: 'queue' as const,
    name: 'fulfillment.reconciliation',
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'fulfillment.reconciliation.dlx',
        'x-dead-letter-routing-key': 'dead',
      },
    },
  },
] as const;

/**
 * declareTopology
 * ---------------
 * Asserts all exchanges and queues in dependency order.
 * Resilient to arg-mismatch (406 PRECONDITION_FAILED): instead of
 * crash-looping the process, a mismatched queue is logged, deleted if
 * empty, and recreated with the canonical args. A non-empty mismatch is
 * logged as CRITICAL and skipped so the app still boots and serves HTTP.
 */
export async function declareTopology(): Promise<void> {
  if (!connection) {
    throw new Error('[TOPOLOGY] declareTopology called before initQueue()');
  }

  const channel = connection.createChannel({ json: false });

  // GUARD (a): never let a channel error become an unhandled 'error' event.
  channel.on('error', (err: any) => {
    console.error('[TOPOLOGY] channel error (handled, non-fatal):', err?.message || err);
  });

  await channel.addSetup(async (ch: any) => {
    for (const entry of TOPOLOGY) {
      try {
        if (entry.type === 'exchange') {
          await ch.assertExchange(entry.name, entry.kind, entry.options);
          console.info('[TOPOLOGY] Exchange declared:', entry.name);
        } else {
          await assertQueueResilient(ch, entry.name, entry.options);
          console.info('[TOPOLOGY] Queue declared:', entry.name);
        }
      } catch (err: any) {
        // GUARD (c): one failed entry must not abort the whole topology / boot.
        console.error(
          `[TOPOLOGY][DECLARE_FAILED] ${entry.type} "${entry.name}" skipped (non-fatal):`,
          err?.message || err
        );
      }
    }
    console.info('[TOPOLOGY] Topology pass complete');
  });

  await (channel as any).close?.();
}

/**
 * assertQueueResilient
 * --------------------
 * GUARD (b): assertQueue, but a 406 arg-mismatch self-heals instead of crashing.
 *
 * On 406:
 *  - if the existing queue is EMPTY → delete + recreate with canonical args.
 *  - if it has messages → DO NOT destroy data; log CRITICAL and skip.
 *
 * NOTE: a 406 kills the channel, so we open a throwaway channel for the
 * inspect/delete/recreate dance to avoid poisoning the topology channel.
 */
async function assertQueueResilient(
  ch: any,
  name: string,
  options: any
): Promise<void> {
  try {
    await ch.assertQueue(name, options);
  } catch (err: any) {
    const is406 =
      err?.code === 406 ||
      /PRECONDITION[-_]FAILED/i.test(err?.message || '');
    if (!is406) throw err;

    console.error(
      `[TOPOLOGY][ARG_MISMATCH] queue "${name}" exists with different args than canonical topology.`
    );

    // The 406 closed `ch`; use a fresh, isolated channel for recovery.
    const recovery = (connection as any).createChannel({ json: false });
    recovery.on('error', (e: any) =>
      console.error('[TOPOLOGY][recovery] channel error (handled):', e?.message || e)
    );

    try {
      await recovery.addSetup(async (rch: any) => {
        // checkQueue is passive — tells us depth without re-declaring args.
        const info = await rch.checkQueue(name);
        const depth = info?.messageCount ?? 0;

        if (depth > 0) {
          // GUARD: never silently destroy real messages.
          console.error(
            `[TOPOLOGY][ARG_MISMATCH_CRITICAL] queue "${name}" has ${depth} message(s); ` +
            `refusing to delete. Boot continues but this queue is NOT reconciled. ` +
            `Drain/shovel it, then redeploy.`
          );
          return; // skip — app still boots
        }

        // Empty → safe to delete and recreate with canonical args.
        await rch.deleteQueue(name);
        await rch.assertQueue(name, options);
        console.warn(
          `[TOPOLOGY][SELF_HEALED] queue "${name}" was empty; recreated with canonical args.`
        );
      });
    } finally {
      await recovery.close?.();
    }
  }
}