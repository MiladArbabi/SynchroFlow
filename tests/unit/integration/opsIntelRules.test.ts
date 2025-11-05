//tests/unit/integration/opsIntelRules.test.ts
// This test runs against the *actual* test database seeded by 'npm run test'
import knex from 'api-db';
import {
  staleOrderRule,
  // lowInventoryRule, // We'll add these later
  // refundAnomalyRule,
} from 'api-src/services/opsIntel/rules'; // This import will fail

describe('OpsIntelEngine: Business Rules', () => {

  // Make sure to clean up any test data if we add it
  afterAll(async () => {
    // We don't need to destroy knex, jest.global-teardown.js does
  });

  describe('staleOrderRule', () => {
    beforeAll(async () => {
      // Let's create a known stale order that the rule *should* find
      // Our seed file creates orders with ID 1001, 1002, etc.
      await knex('orders').insert({
        id: 9999, // A unique ID
        shop_id: 1, // From seed
        customer_id: 1, // From seed
        fulfillment_status: 'pending',
        order_number: 'KORE-TEST-9999',
        total_price: 100.00,
        // Make it 5 days old
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });
    });

    afterAll(async () => {
      // Clean up our test order
      await knex('orders').where({ id: 9999 }).del();
    });

    it('should find a stale order older than 24 hours', async () => {
      const insight = await staleOrderRule.execute();

      // We expect it to find the order we just created
      expect(insight).toBeDefined();
      expect(insight).not.toBeNull();
      expect(insight?.type).toBe('alert');
      expect(insight?.title).toBe('Stale Order Detected');
      // Check that it's about the specific order
      expect(insight?.message).toContain('Order #9999');
      // Check that the payload is correct
      expect(insight?.actionPayload[0].actionId).toBe('nav-order-detail');
      expect(insight?.actionPayload[0].context.orderId).toBe(9999);
    });
  });

  // We'll add tests for the other 2 rules here later
});