// tests/unit/backend/webhooks/webhook.router.ordering.contract.test.ts
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';
import * as DispatchQueue from 'api-src/api/webhooks/dispatchQueue';
import { WebhookEnvelope } from 'api-src/api/webhooks/types';

jest.mock('api-src/services/webhook-ledger.service');
jest.mock('api-src/api/webhooks/dispatchQueue');

describe('WebhookRouter — ordering contract', () => {
  const envelope: WebhookEnvelope = {
    integration: 'shopify',
    eventId: 'evt_123',
    eventType: 'test/event',
    verified: true,
    receivedAt: new Date(),
    rawPayload: { foo: 'bar' },
    shopDomain: 'test.myshopify.com',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.WEBHOOK_DISPATCH_MODE = 'queued';
  });

  it('records ledger before enqueueing (ledger-first side effect)', async () => {
    const callOrder: string[] = [];

    (WebhookLedgerService.recordReceived as jest.Mock).mockImplementation(
      async () => {
        callOrder.push('ledger.recordReceived');
        return { isDuplicate: false };
      }
    );

    (DispatchQueue.enqueueWebhookEnvelope as jest.Mock).mockImplementation(
      async () => {
        callOrder.push('dispatch.enqueue');
      }
    );

    await WebhookRouter.dispatch(envelope);

    expect(callOrder[0]).toBe('ledger.recordReceived');
    expect(callOrder).toEqual([
      'ledger.recordReceived',
      'dispatch.enqueue',
    ]);
  });

  it('does not enqueue or handle if duplicate is detected', async () => {
    (WebhookLedgerService.recordReceived as jest.Mock).mockResolvedValue({
      isDuplicate: true,
    });

    const markDuplicateSpy = jest
      .spyOn(WebhookLedgerService, 'markDuplicate')
      .mockResolvedValue();

    await WebhookRouter.dispatch(envelope);

    expect(markDuplicateSpy).toHaveBeenCalledWith('evt_123');
    expect(DispatchQueue.enqueueWebhookEnvelope).not.toHaveBeenCalled();
  });
});