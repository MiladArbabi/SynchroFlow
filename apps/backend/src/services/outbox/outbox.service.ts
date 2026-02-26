import type { Knex } from 'knex';
import crypto from 'crypto';

/**
 * Integration Outbox Service
 * ---------------------------
 * - Pure persistence
 * - No broker interaction
 * - Must be called inside transaction boundary
 */

export class OutboxService {

  async enqueue(
    input: {
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: unknown;
    },
    trx: Knex.Transaction
  ): Promise<void> {

    if (!trx) {
      throw new Error(
        '[OutboxService] Transaction is required.'
      );
    }

    if (
      input.aggregateType === 'order' &&
      typeof (input.payload as any)?.aggregateVersion !== 'number'
    ) {
      throw new Error(
        '[OUTBOX_VERSION_VIOLATION] Missing aggregateVersion'
      );
    }

    await trx('integration_outbox')
    .insert({
      id: crypto.randomUUID(),
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      event_type: input.eventType,
      aggregate_version: (input.payload as any).aggregateVersion,
      payload: input.payload,
    })
  }
}

export default new OutboxService();