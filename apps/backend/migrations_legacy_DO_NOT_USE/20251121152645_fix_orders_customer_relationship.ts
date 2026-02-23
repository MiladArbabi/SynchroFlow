// apps/backend/migrations/20251121152645_fix_orders_customer_relationship.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: First, let's safely handle the foreign key constraint
  // We'll use raw SQL to find and drop the constraint
  const constraints = await knex.raw(`
    SELECT conname 
    FROM pg_constraint 
    WHERE conrelid = 'orders'::regclass 
    AND contype = 'f' 
    AND conname LIKE '%customer%'
  `);
  
  if (constraints.rows.length > 0) {
    const constraintName = constraints.rows[0].conname;
    await knex.raw(`ALTER TABLE orders DROP CONSTRAINT ${constraintName}`);
  }

  // Step 2: Make customer_id nullable
  await knex.schema.alterTable('orders', (table) => {
    table.integer('customer_id').unsigned().nullable().alter();
  });

  // Step 3: Add platform_customer_id for external customer references
  await knex.schema.alterTable('orders', (table) => {
    table.string('platform_customer_id');
  });

  // Step 4: Create index for platform_customer_id
  await knex.schema.alterTable('orders', (table) => {
    table.index(['platform_customer_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', (table) => {
    table.dropIndex(['platform_customer_id']);
    table.dropColumn('platform_customer_id');
    
    // Note: We can't easily restore the foreign key constraint without data cleanup
    table.integer('customer_id').unsigned().notNullable().alter();
  });
}