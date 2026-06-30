/**
 * COMMANDS CONSUMER (DECISION-ENGINE-01 / THREAD A, 2026-06-30)
 * ----------------------------------------------------------------------
 * Closes the gap identified at the start of tonight's session:
 * dispatchCommand() (command.bus.ts) has always been write-only — it
 * persists a row to `commands` but nothing ever read it back. This is
 * that missing consumer.
 *
 * Currently handles exactly one command type: RECONCILIATION_RUN.
 * Payload shape (confirmed live, 2026-06-30):
 *   { shopId: number, orderId: string, aggregateVersion: number,
 *     riskSnapshot: DecisionSignals }
 *
 * Pattern modeled directly on execution.dispatcher.worker.ts (the only
 * other "poll a table, hydrate, act" worker in this codebase) — same
 * polling shape, same systemQuery() usage for the cross-tenant SELECT
 * (commands has no shop_id known until the row is read, same chicken/egg
 * as auth-path tables), same explicit SET LOCAL app.current_tenant
 * before any tenant-scoped write.
 *
 * RLS NOTE (the entire reason tonight's session took as long as it did):
 * systemQuery() only bypasses this codebase's own app-level guard, NOT
 * real Postgres RLS (see RLS_blueprint.md §7). Safe here for the poll
 * ONLY because commands now has a split policy with a permissive SELECT
 * (added alongside this file — see 0078 migration). Every WRITE in this
 * file explicitly sets app.current_tenant first, using shopId already
 * present in the command's own payload — no cross-tenant orders/shops
 * lookup needed anywhere in this file. No .forUpdate() is used on the
 * poll, so the write policy is never implicated by the SELECT itself
 * (see order_reconciliation_intents incident — FOR UPDATE pulls in the
 * write policy even on a read).
 */

import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { generateDecisions } from '../domain/decision/decision.engine.js';
import { DecisionRepository } from '../domain/decision/decision.repository.js';
import type { Decision } from '../domain/decision/Decision.js';

const POLL_INTERVAL_MS = 1000;
let running = false;

type CommandRow = {
  id: string;
  type: string;
  payload: {
    shopId?: number;
    orderId?: string;
    aggregateVersion?: number;
    riskSnapshot?: any;
  };
  shop_id: number;
  status: string;
};

async function processCommand(command: CommandRow): Promise<void> {
  if (command.type !== 'RECONCILIATION_RUN') {
    console.warn('[COMMANDS_CONSUMER_UNKNOWN_TYPE]', {
      id: command.id,
      type: command.type,
    });

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${command.shop_id}'`);
      await trx('commands')
        .where({ id: command.id })
        .update({
          status: 'error',
          error: `Unknown command type: ${command.type}`,
          processed_at: trx.fn.now(),
        });
    });

    return;
  }

  const { shopId, orderId, aggregateVersion, riskSnapshot } = command.payload;

  if (!shopId || !orderId || aggregateVersion === undefined || !riskSnapshot) {
    console.error('[COMMANDS_CONSUMER_INVALID_PAYLOAD]', {
      id: command.id,
      payload: command.payload,
    });

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${command.shop_id}'`);
      await trx('commands')
        .where({ id: command.id })
        .update({
          status: 'error',
          error: 'Invalid RECONCILIATION_RUN payload — missing required field',
          processed_at: trx.fn.now(),
        });
    });

    return;
  }

  let decisions: Decision[];

  try {
    decisions = generateDecisions({
      orderId,
      shopId,
      aggregateVersion,
      riskSnapshot,
    });
  } catch (err) {
    console.error('[COMMANDS_CONSUMER_GENERATE_DECISIONS_FAILED]', {
      id: command.id,
      orderId,
      error: (err as Error).message,
    });

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      await trx('commands')
        .where({ id: command.id })
        .update({
          status: 'error',
          error: (err as Error).message,
          processed_at: trx.fn.now(),
        });
    });

    return;
  }

  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);

    for (const decision of decisions) {
      await DecisionRepository.create(trx, {
        ...decision,
        aggregate_version: aggregateVersion,
        shop_id: shopId,
      });
    }

    await trx('commands')
      .where({ id: command.id })
      .update({
        status: 'processed',
        processed_at: trx.fn.now(),
      });
  });

  console.info('[COMMANDS_CONSUMER_PROCESSED]', {
    id: command.id,
    orderId,
    decisionsCreated: decisions.length,
  });
}

export async function startCommandsConsumer(): Promise<void> {
  if (running) return;
  running = true;

  console.info('[commands-consumer] started');

  while (running) {
    try {
      const pending: CommandRow[] = await systemQuery(
        db('commands').where({ status: 'pending' }).limit(50)
      );

      for (const command of pending) {
        try {
          await processCommand(command);
        } catch (err) {
          console.error('[COMMANDS_CONSUMER_PROCESS_FAILED]', {
            id: command.id,
            error: (err as Error).message,
          });
        }
      }
    } catch (err) {
      console.error('[commands-consumer][LOOP_ERROR]', err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export async function stopCommandsConsumer(): Promise<void> {
  running = false;
}
