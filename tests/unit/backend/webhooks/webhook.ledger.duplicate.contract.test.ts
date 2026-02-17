// tests/unit/backend/webhooks/webhook.ledger.duplicate.contract.test.ts

import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';
import db from '@lasyncro/backend-core/db.js';

jest.mock('api-src/db', () => jest.fn());

describe('WebhookLedgerService — duplicate transition contract', () => {
  const baseParams = {
    integration: 'shopify',
    externalEventId: 'evt_dup_1',
    eventType: 'orders/create',
    payload: { a: 1 },
    idempotencyKey: 'shopify:evt_dup_1',
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns isDuplicate=true on unique constraint violation', async () => {
    (db as unknown as jest.Mock).mockImplementation(() => ({
      insert: () => {
        const err: any = new Error('duplicate');
        err.code = '23505';
        throw err;
      },
    }));

    const result = await WebhookLedgerService.recordReceived(baseParams);

    expect(result.isDuplicate).toBe(true);
  });

  it('explicitly marks duplicate via follow-up update', async () => {
    const updateMock = jest.fn();

    (db as unknown as jest.Mock).mockImplementation(() => ({
      where: () => ({
        update: updateMock,
      }),
    }));

    await WebhookLedgerService.markDuplicate(baseParams.externalEventId);

    expect(updateMock).toHaveBeenCalledWith({
      processing_status: 'duplicate',
    });
  });
});