import {
  claimNotificationDeliveries,
  executeClaimedNotificationDelivery,
  type DeliveryTransport,
} from 'api-src/services/notifications/notificationDeliveryExecution.service';
import {
  startNotificationDeliveryWorker,
  stopNotificationDeliveryWorker,
} from 'api-src/workers/notification-delivery.worker';

jest.mock('api-src/services/notifications/notificationDeliveryExecution.service', () => ({
  claimNotificationDeliveries: jest.fn(),
  executeClaimedNotificationDelivery: jest.fn(),
  NOTIFICATION_DELIVERY_BATCH_SIZE: 25,
  NOTIFICATION_DELIVERY_LEASE_SECONDS: 60,
  NOTIFICATION_DELIVERY_POLL_INTERVAL_MS: 5_000,
}));

describe('GH-1147 notification delivery worker shutdown', () => {
  afterEach(async () => {
    await stopNotificationDeliveryWorker();
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('finishes delivery A after stop without claiming B or scheduling another cycle', async () => {
    jest.useFakeTimers();
    const deliveryA = { delivery_id: 'A', shop_id: 1, claim_token: 'claim-A' };
    const deliveryB = { delivery_id: 'B', shop_id: 1, claim_token: 'claim-B' };
    const claim = jest.mocked(claimNotificationDeliveries);
    const execute = jest.mocked(executeClaimedNotificationDelivery);
    claim.mockResolvedValueOnce([deliveryA]).mockResolvedValueOnce([deliveryB]).mockResolvedValue([]);

    let finishDelivery = () => {};
    const inFlight = new Promise<void>((resolve) => { finishDelivery = resolve; });
    execute.mockImplementationOnce(async () => {
      await inFlight;
      return { status: 'sent' };
    }).mockResolvedValue({ status: 'sent' });
    const transport: DeliveryTransport = async () => ({ kind: 'accepted' });

    startNotificationDeliveryWorker(transport);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(execute).toHaveBeenCalledWith({ locator: deliveryA, transport });
    expect(claim).toHaveBeenCalledWith({ limit: 1, leaseSeconds: 60 });

    let stopSettled = false;
    const stopping = stopNotificationDeliveryWorker().then(() => {
      stopSettled = true;
    });

    await Promise.resolve();
    expect(stopSettled).toBe(false);

    finishDelivery();
    await stopping;
    await jest.advanceTimersByTimeAsync(60_000);

    expect(stopSettled).toBe(true);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
