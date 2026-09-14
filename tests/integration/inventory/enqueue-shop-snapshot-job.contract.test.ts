// tests/integration/inventory/enqueue-shop-snapshot-job.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — shared enqueueShopSnapshotJob(trx, shopId)
// helper contract. PERMANENT regression contract, authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time): the production module
//   api-src/services/shop-snapshot/enqueueShopSnapshotJob
// does not exist yet — import fails with MODULE_NOT_FOUND, narrowly
// attributable to the missing Slice 4 helper, not a malformed test.

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { enqueueShopSnapshotJob } from 'api-src/services/shop-snapshot/enqueueShopSnapshotJob';

async function createFixtureShop(unique: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-enqueue-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

describe('enqueueShopSnapshotJob — shared transactional helper contract', () => {
  it('1. first enqueue creates exactly one job row', async () => {
    const shopId = await createFixtureShop('1');

    await withTenant(shopId, (trx) => enqueueShopSnapshotJob(trx, shopId));

    const rows = await withTenant(shopId, (trx) =>
      trx('shop_snapshot_jobs').where({ shop_id: shopId }).select('shop_id', 'scheduled_at'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].shop_id).toBe(shopId);
  });

  it('2. a second enqueue for the same shop keeps exactly one row', async () => {
    const shopId = await createFixtureShop('2');

    await withTenant(shopId, (trx) => enqueueShopSnapshotJob(trx, shopId));
    await withTenant(shopId, (trx) => enqueueShopSnapshotJob(trx, shopId));

    const rows = await withTenant(shopId, (trx) =>
      trx('shop_snapshot_jobs').where({ shop_id: shopId }).select('shop_id'),
    );
    expect(rows).toHaveLength(1);
  });

  it('3. scheduled_at refreshes on a repeated enqueue', async () => {
    const shopId = await createFixtureShop('3');

    await withTenant(shopId, (trx) => enqueueShopSnapshotJob(trx, shopId));
    const first = await withTenant(shopId, (trx) =>
      trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('scheduled_at'),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    await withTenant(shopId, (trx) => enqueueShopSnapshotJob(trx, shopId));
    const second = await withTenant(shopId, (trx) =>
      trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('scheduled_at'),
    );

    expect(new Date(second.scheduled_at).getTime()).toBeGreaterThan(
      new Date(first.scheduled_at).getTime(),
    );
  });

  it('4. enqueue participates in the caller transaction — visible via the same trx before commit', async () => {
    const shopId = await createFixtureShop('4');

    await withTenant(shopId, async (trx) => {
      await enqueueShopSnapshotJob(trx, shopId);
      const rows = await trx('shop_snapshot_jobs').where({ shop_id: shopId }).select('shop_id');
      expect(rows).toHaveLength(1);
    });
  });

  it('5. rolling back the caller transaction leaves no job', async () => {
    const shopId = await createFixtureShop('5');

    await withTenant(shopId, async (trx) => {
      await enqueueShopSnapshotJob(trx, shopId);
      await trx.rollback();
    }).catch(() => {
      // Expected — an explicit rollback rejects the withTenant promise chain.
    });

    const rows = await withTenant(shopId, (trx) =>
      trx('shop_snapshot_jobs').where({ shop_id: shopId }).select('shop_id'),
    );
    expect(rows).toHaveLength(0);
  });
});
