/**
 * Command Bus — Single Entry Point for All System Actions
 *
 * Guarantees:
 * - NO DECISION WITHOUT COMMAND
 * - Idempotency (to be enforced via DB layer)
 * - Single authority for intent creation
 * - Replay safety (deterministic command handling)
 */

import db from '@lasyncro/backend-core/db.js';
import { randomUUID } from 'crypto';

type Command = {
  type: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
};

export async function dispatchCommand(command: Command): Promise<void> {
  if (!command?.type) {
    throw new Error('COMMAND_INVALID: Missing command type');
  }

  if (!command.idempotencyKey) {
    throw new Error('COMMAND_INVALID: Missing idempotencyKey');
  }

  if (!command.payload || typeof command.payload !== 'object') {
    throw new Error('COMMAND_INVALID: Missing payload');
  }

  const { shopId } = command.payload as { shopId?: number };

  if (!shopId) {
    throw new Error('COMMAND_INVALID: Missing shopId in payload');
  }

  console.info('[COMMAND_RECEIVED]', {
    type: command.type,
    idempotencyKey: command.idempotencyKey,
  });

  /**
   * PERSIST COMMAND (IDEMPOTENT)
   * ---------------------------
   * ON CONFLICT → prevents duplicate processing
   */
  const inserted = await db('commands')
    .insert({
      id: randomUUID(),
      type: command.type,
      payload: command.payload,
      idempotency_key: command.idempotencyKey,
      shop_id: shopId,
      status: 'pending',
      created_at: db.fn.now(),
    })
    .onConflict('idempotency_key')
    .ignore()
    .returning('id');

  if (!inserted.length) {
    console.warn('[COMMAND_SUPERSEDED]', {
      idempotencyKey: command.idempotencyKey,
    });
    return;
  }

  console.info('[COMMAND_PERSISTED]', {
    id: inserted[0].id,
    type: command.type,
  });
}