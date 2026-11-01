// tests/unit/workers/shopify-recovery-inventory-sync.activation.test.ts
//
// S4-5 I4 C2 — the Shopify recovery inventory sync worker is default OFF.
// Pure unit: the backend-core db module and the per-shop sync are replaced at
// module level, so no database pool is ever constructed (no PG env needed) and
// no Shopify is reachable.
//
//   A1 only the exact string 'true' enables; missing, empty and every other
//      value stays OFF.
//   A2 disabled: start() and a cycle perform no discovery, no dispatch and no
//      database call.
//   A3 enabled: a cycle lists tenants and runs the existing per-shop sync.
//   A4 enabled: start() runs the loop; stop() ends it.

const mockRunForShop = jest.fn(async (..._args: unknown[]) => []);
const mockRaw = jest.fn();
const mockSystemQuery = jest.fn((qb: unknown) => qb);
jest.mock('api-src/services/wms/shopifyRecoveryInventorySync.service', () => ({
  runShopifyRecoveryInventorySyncForShop: (...args: unknown[]) => mockRunForShop(...args),
}));
jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: { raw: (...args: unknown[]) => mockRaw(...args) },
  systemQuery: (qb: unknown) => mockSystemQuery(qb),
}));

type WorkerModule = typeof import('api-src/workers/shopifyRecoveryInventorySync.worker');

const FLAG = 'SHOPIFY_RECOVERY_INVENTORY_SYNC_ENABLED';


async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('Shopify recovery inventory sync worker — activation', () => {
  const original = process.env[FLAG];
  const dbRaw = mockRaw;
  let worker: WorkerModule;

  beforeEach(() => {
    // Fresh module per case: lifecycle flags (running / stopRequested) never
    // leak between cases.
    jest.resetModules();
    worker = require('api-src/workers/shopifyRecoveryInventorySync.worker');
    mockRunForShop.mockClear();
    mockSystemQuery.mockClear();
    mockRaw.mockReset();
    mockRaw.mockResolvedValue({ rows: [{ shop_id: 41 }, { shop_id: 42 }] });
  });

  afterEach(async () => {
    await worker.stopShopifyRecoveryInventorySyncWorker();
    if (original === undefined) delete process.env[FLAG];
    else process.env[FLAG] = original;
  });

  it('A1 only the exact value "true" enables the worker', () => {
    expect(worker.SHOPIFY_RECOVERY_INVENTORY_SYNC_FLAG).toBe(FLAG);
    expect(worker.isShopifyRecoveryInventorySyncEnabled({})).toBe(false);
    for (const value of ['', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
      expect(worker.isShopifyRecoveryInventorySyncEnabled({ [FLAG]: value })).toBe(false);
    }
    expect(worker.isShopifyRecoveryInventorySyncEnabled({ [FLAG]: 'true' })).toBe(true);
  });

  it.each([undefined, '', 'false', 'TRUE', '1'])('A2 disabled (%p): no discovery, dispatch or database call', async (value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;

    await worker.startShopifyRecoveryInventorySyncWorker();
    await worker.runShopifyRecoveryInventorySyncCycle();
    await flush();

    expect(dbRaw).not.toHaveBeenCalled();
    expect(mockSystemQuery).not.toHaveBeenCalled();
    expect(mockRunForShop).not.toHaveBeenCalled();
  });

  it('A3 enabled: a cycle lists tenants and runs the per-shop sync for each', async () => {
    process.env[FLAG] = 'true';

    await worker.runShopifyRecoveryInventorySyncCycle();

    expect(dbRaw).toHaveBeenCalledTimes(1);
    expect(String(dbRaw.mock.calls[0][0])).toContain('list_shopify_recovery_inventory_sync_tenants()');
    expect(mockRunForShop.mock.calls.map((call) => call[0])).toEqual([41, 42]);
  });

  it('A4 enabled: start() runs the loop and stop() ends it', async () => {
    process.env[FLAG] = 'true';

    await worker.startShopifyRecoveryInventorySyncWorker();
    await flush();
    await worker.stopShopifyRecoveryInventorySyncWorker();

    expect(dbRaw).toHaveBeenCalledTimes(1);
    expect(mockRunForShop).toHaveBeenCalledTimes(2);
  });
});
