// apps/backend/src/projection/handlers/lifecycle.ft0_completed.ts

/**
 * LIFECYCLE — FT0 COMPLETED HANDLER
 * ----------------------------------
 * Mechanical extraction from projection.engine.ts.
 *
 * No behavior changes.
 * Non-deterministic crypto.randomUUID preserved.
 * Dynamic import preserved.
 */

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import { Knex } from 'knex';
import { advanceCursor } from '../projection.engine.js';

const LIFECYCLE_PROJECTION = 'lifecycle_projection';

export async function handleLifecycleFT0Completed({
  domainEvent,
  domain_event_id,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date; // passed but not used (original logic uses eventRow.event_time)
}) {

  const payload = domainEvent.event_payload as {
    orders: number;
    firstInsightDelivered: boolean;
  };

  await db.transaction(async (trx: Knex.Transaction) => {

    const cursorRow = await trx('projection_cursors')
      .where({ projection_name: LIFECYCLE_PROJECTION })
      .forUpdate()
      .first<{ last_processed_event_id: number }>();

    if (
      cursorRow?.last_processed_event_id != null &&
      domain_event_id <= cursorRow.last_processed_event_id
    ) {
      throw new Error(
        `[PROJECTION_ORDER_VIOLATION] last=${cursorRow.last_processed_event_id} got=${domain_event_id}`
      );
    }

    const eventRow = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    const shopId = domainEvent.shop_id;
    const eventTime = new Date(eventRow.event_time);

    await trx('ft0_state')
      .insert({
        shop_id: shopId,
        status: 'COMPLETED',
        completed_at: eventTime,
        completion_reason: payload,
      })
      .onConflict('shop_id')
      .ignore();

    await trx('system_readiness_state')
      .insert({
        shop_id: shopId,
        became_ready_at: eventTime,
      })
      .onConflict('shop_id')
      .ignore();

    await trx('activation_audit_events')
      .insert({
        event_id: crypto.randomUUID(),
        event_type: 'FT0_COMPLETED',
        shop_id: shopId,
        occurred_at: eventTime,
        payload,
      });

    const members = await trx('shop_memberships')
      .where({ shop_id: shopId })
      .select<{ user_id: number }[]>('user_id');

    for (const member of members) {
      const userId = member.user_id;

      const { LifecycleTransitionService } = await import(
        '../../services/lifecycle-transition.service.js'
      );

      await LifecycleTransitionService.auditIfTransitioned(
        {
          userId,
          shopId,
          currentPhase: 'FT0',
        },
        trx
      );

      await LifecycleTransitionService.auditIfTransitioned(
        {
          userId,
          shopId,
          currentPhase: 'FT1',
        },
        trx
      );
    }

    await advanceCursor(
      trx,
      LIFECYCLE_PROJECTION,
      domain_event_id,
      eventRow.event_time
    );
  });
}