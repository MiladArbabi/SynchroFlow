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
 * polling shape, bounded cross-tenant discovery through
 * list_pending_commands(), and explicit tenant context before every write.
 *
 * RLS NOTE (the entire reason tonight's session took as long as it did):
 * The runtime role never receives a permissive cross-tenant table policy.
 * The SECURITY DEFINER resolver returns bounded pending work; every write in
 * this file uses the shop_id from that result to establish tenant context.
 */

import db from '@lasyncro/backend-core/db.js';
import { listPendingCommands } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { generateDecisions } from '../domain/decision/decision.engine.js';
import { DecisionRepository } from '../domain/decision/decision.repository.js';
import type { Decision } from '../domain/decision/Decision.js';
import { executeJob } from './execution.worker.js';
import type { ExecutionJob } from '../domain/decision/Decision.js';

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
    decisionId?: string;
    isAlreadyFulfilled?: boolean;
  };
  shop_id: number;
  status: string;
};

async function markCommandError(command: CommandRow, errorMessage: string): Promise<void> {
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL app.current_tenant = '${command.shop_id}'`);
    await trx('commands')
      .where({ id: command.id })
      .update({
        status: 'error',
        error: errorMessage,
        processed_at: trx.fn.now(),
      });
  });
}

async function markCommandProcessed(command: CommandRow, shopId: number): Promise<void> {
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
    await trx('commands')
      .where({ id: command.id })
      .update({
        status: 'processed',
        processed_at: trx.fn.now(),
      });
  });
}

/**
 * EXECUTE_DECISION (THREAD A-2 cont'd, 2026-06-30)
 * --------------------------------------------------
 * Closes the gap found tonight: manualExecution.service.ts's
 * executeManualDecision() has always thrown [MANUAL_EXECUTION_DISABLED]
 * unconditionally, with zero callers anywhere — manual-mode decisions
 * queued correctly (decision_execution_queue) but nothing ever drained
 * them. Per that disabled function's own comment, this is the proper
 * Command Bus path it called for but was never built: dispatched from
 * orders.execute.controller.ts, consumed here, calling the real
 * executeJob() — same function execution.worker.ts uses for automated
 * decisions.
 */
async function processExecuteDecisionCommand(command: CommandRow): Promise<void> {
  const { shopId, decisionId } = command.payload;

  if (!shopId || !decisionId) {
    console.error('[COMMANDS_CONSUMER_INVALID_EXECUTE_PAYLOAD]', {
      id: command.id,
      payload: command.payload,
    });
    await markCommandError(command, 'Invalid EXECUTE_DECISION payload — missing required field');
    return;
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);

      const decision = await trx('decisions')
        .where({ id: decisionId, shop_id: shopId })
        .first();

      if (!decision) {
        throw new Error(`Decision not found: ${decisionId}`);
      }

      const queueRow = await trx('decision_execution_queue')
        .where({ decision_id: decisionId })
        .forUpdate()
        .first();

      if (!queueRow) {
        throw new Error(`No queue row found for decision: ${decisionId}`);
      }

      if (queueRow.status === 'success' || queueRow.status === 'in_progress') {
        console.warn('[EXECUTE_DECISION_SKIPPED_ALREADY_PROCESSED]', {
          decision_id: decisionId,
          status: queueRow.status,
        });
        return;
      }

      await trx('decision_execution_queue')
        .where({ decision_id: decisionId })
        .update({ status: 'in_progress' });

      const job: ExecutionJob = {
        decision_id: decision.id,
        entity_id: decision.entity_id,
        shop_id: decision.shop_id,
        aggregate_version: decision.aggregate_version,
        action_type: decision.recommended_action?.type,
        payload: decision.recommended_action?.payload ?? {},
        execution_mode: decision.recommended_action?.execution_mode ?? 'manual',
      };

      if (!job.action_type) {
        throw new Error(`Decision missing action_type: ${decisionId}`);
      }

      await executeJob(job, trx);

      await trx('decision_execution_queue')
        .where({ decision_id: decisionId })
        .update({
          status: 'success',
          executed_at: trx.fn.now(),
        });
    });

    console.info('[COMMANDS_CONSUMER_EXECUTE_DECISION_PROCESSED]', {
      id: command.id,
      decisionId,
    });
  } catch (err) {
    console.error('[COMMANDS_CONSUMER_EXECUTE_DECISION_FAILED]', {
      id: command.id,
      decisionId,
      error: (err as Error).message,
    });

    // Best-effort failure marking — separate transaction since the one
    // above rolled back.
    try {
      await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
        await trx('decision_execution_queue')
          .where({ decision_id: decisionId })
          .update({
            status: 'failure',
            executed_at: trx.fn.now(),
            error: (err as Error).message,
          });
      });
    } catch (markErr) {
      console.error('[COMMANDS_CONSUMER_FAILURE_MARK_FAILED]', {
        decisionId,
        error: (markErr as Error).message,
      });
    }

    await markCommandError(command, (err as Error).message);
    return;
  }

  await markCommandProcessed(command, shopId);
}

async function processCommand(command: CommandRow): Promise<void> {
  if (command.type === 'EXECUTE_DECISION') {
    await processExecuteDecisionCommand(command);
    return;
  }

  if (command.type !== 'RECONCILIATION_RUN') {
    console.warn('[COMMANDS_CONSUMER_UNKNOWN_TYPE]', {
      id: command.id,
      type: command.type,
    });

    await markCommandError(command, `Unknown command type: ${command.type}`);
    return;
  }

  const { shopId, orderId, aggregateVersion, riskSnapshot, isAlreadyFulfilled } = command.payload;

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
      // ISS-07 FIX: isAlreadyFulfilled travels in the command payload
      // (set in reconciliation.handlers.ts) — merged onto riskSnapshot
      // here since generateDecisions/mapToDecisionSignals only accept
      // a single riskSnapshot object, not a separate parameter.
      riskSnapshot: { ...riskSnapshot, is_already_fulfilled: isAlreadyFulfilled },
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
      const pending = await listPendingCommands<CommandRow>(50);

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
