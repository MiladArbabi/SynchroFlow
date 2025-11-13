// tests/unit/api/database-verification.test.ts
import db from "api-src/db";

describe('Database Migrations and Seeds', () => {
  beforeAll(async () => {
    // Ensure database is connected
    await db.raw('SELECT 1');
  });

  describe('Migrations Verification', () => {
    it('should have run all migrations without errors', async () => {
      const hasMigrationsTable = await db.schema.hasTable('knex_migrations');
      expect(hasMigrationsTable).toBe(true);
      
      const migrations = await db('knex_migrations').select('*');
      expect(migrations.length).toBeGreaterThan(0);
      console.log(`Found ${migrations.length} completed migrations`);
    });

    it('should have all expected tables created', async () => {
      const expectedTables = [
        'shops', 'users', 'orders', 'shopify_products', 
        'inventory_truth', 'financial_transactions', 'integrations'
      ];
      
      for (const table of expectedTables) {
        const exists = await db.schema.hasTable(table);
        expect(exists).toBe(true);
      }
    });

    it('should have shopify-related tables for e-commerce functionality', async () => {
      const shopifyTables = ['shopify_products', 'shopify_payouts', 'shopify_fulfillments'];
      
      for (const table of shopifyTables) {
        const exists = await db.schema.hasTable(table);
        expect(exists).toBe(true);
      }
    });
  });

  describe('Seed Data Verification', () => {
    it('should have seed data for shops', async () => {
      const shops = await db('shops').select('*');
      expect(shops.length).toBeGreaterThan(0);
      
      // Verify shop has required fields
      const shop = shops[0];
      expect(shop).toHaveProperty('id');
      expect(shop).toHaveProperty('name');
      expect(shop).toHaveProperty('platform');
    });

    it('should have seed data for users', async () => {
      const users = await db('users').select('*');
      expect(users.length).toBeGreaterThan(0);
      
      const user = users[0];
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('shop_id');
    });

    it('should have order fulfillment statuses seeded', async () => {
      const statuses = await db('order_fulfillment_status').select('*');
      expect(statuses.length).toBeGreaterThan(0);
    });
  });

  describe('Schema Integrity', () => {
    it('should have proper foreign key relationships', async () => {
      // Test that users have valid shop references
      const users = await db('users').select('*');
      const shopIds = users.map(u => u.shop_id);
      
      const shops = await db('shops').whereIn('id', shopIds).select('id');
      expect(shops.length).toBe(shopIds.length);
    });

    it('should have consistent data types', async () => {
      // Verify numeric fields are properly typed
      const shops = await db('shops').select('id');
      expect(typeof shops[0].id).toBe('number');
    });

    it('should have user state tracking columns', async () => {
      const userColumns = await db('users').columnInfo();
      expect(userColumns).toHaveProperty('preferred_mode');
      expect(userColumns).toHaveProperty('detected_mode');
      expect(userColumns).toHaveProperty('shopify_connected');
      expect(userColumns).toHaveProperty('stripe_connected');
      expect(userColumns).toHaveProperty('first_insight_delivered');
    });

    it('should have user_milestones table', async () => {
      const exists = await db.schema.hasTable('user_milestones');
      expect(exists).toBe(true);
      
      const milestoneColumns = await db('user_milestones').columnInfo();
      expect(milestoneColumns).toHaveProperty('user_id');
      expect(milestoneColumns).toHaveProperty('milestone');
      expect(milestoneColumns).toHaveProperty('achieved_at');
    });
  });
});