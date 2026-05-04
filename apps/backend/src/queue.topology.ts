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
        'x-dead-letter-routing-key': 'events.dead',
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
    name: 'execution.jobs.v1.dlx',
    kind: 'direct',
    options: { durable: true },
  },
  {
    type: 'queue' as const,
    name: 'execution.jobs.v1',
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'execution.jobs.v1.dlx',
      },
    },
  },
  {
    type: 'queue' as const,
    name: 'execution.jobs.v1.dlq',
    options: { durable: true },
  },

  // ── Fulfillment reconciliation ───────────────────────────────────
  // NOTE: Reconciliation consumer is disabled (runs inline in processDomainEvent).
  // Queue declared to prevent silent accumulation if ever re-enabled.
  {
    type: 'queue' as const,
    name: 'fulfillment.reconciliation',
    options: { durable: true },
  },
] as const;

/**
 * declareTopology
 * ---------------
 * Asserts all exchanges and queues in dependency order.
 * Must be called once after initQueue() completes.
 *
 * Idempotent — safe to call on reconnect.
 */
export async function declareTopology(): Promise<void> {
  if (!connection) {
    throw new Error('[TOPOLOGY] declareTopology called before initQueue()');
  }

  const channel = connection.createChannel({ json: false });

  await channel.addSetup(async (ch: any) => {
    for (const entry of TOPOLOGY) {
      if (entry.type === 'exchange') {
        await ch.assertExchange(entry.name, entry.kind, entry.options);
        console.info('[TOPOLOGY] Exchange declared:', entry.name);
      } else {
        await ch.assertQueue(entry.name, entry.options);
        console.info('[TOPOLOGY] Queue declared:', entry.name);
      }
    }
    console.info('[TOPOLOGY] All queues and exchanges declared');
  });

  // Close topology channel — it's only needed for assertions
  await (channel as any).close?.();
}