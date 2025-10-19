// packages/api/__tests__/seeder.test.ts
import { seedSandboxData } from '../../../packages/api/src//db/seeder';
import db from '../../../packages/api/src//db';

beforeAll(async () => {
  await db.migrate.latest();
});

describe('Sandbox Seeder', () => {
  // Before each test, wipe the database clean to ensure a fresh start
  beforeEach(async () => {
    await db.raw('TRUNCATE shops, inventory_truth, data_mapping_rules, staged_events RESTART IDENTITY CASCADE');
  });

  // After all tests, close the database connection
  afterAll(async () => {
    await db.destroy();
  });

  it('should populate the database with a sample set of data for a given shopId', async () => {
    // 1. SETUP: Create a new shop to act as the owner of the sandbox data
    const [shop] = await db('shops').insert({
      name: "Sandbox MegaStore",
      platform: "shopify",
      contact_email: "sandbox@synchroflow.com",
      auth_secret: "sandbox-secret",
      primary_erp_type: "NetSuite",
      primary_ecomm_type: "Shopify"
    }).returning('id');
    const shopId = shop.id;

    // 2. EXECUTION: Run the seeder function
    await seedSandboxData(shopId);

    // 3. ASSERTION: Check if the database was populated
    const inventoryCount = await db('inventory_truth').where({ shop_id: shopId }).count();
    const ruleCount = await db('data_mapping_rules').where({ shop_id: shopId }).count();

    // We expect the seeder to create more than zero of each item
    expect(Number(inventoryCount[0].count)).toBeGreaterThan(0);
    expect(Number(ruleCount[0].count)).toBeGreaterThan(0);
  });
});