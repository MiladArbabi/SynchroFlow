import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('customers', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('external_customer_id').nullable();
    table.string('email').nullable();
    table.string('first_name').nullable();
    table.string('last_name').nullable();

    table.timestamp('created_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['email']);
    table.unique(['shop_id', 'external_customer_id'], 'customers_shop_external_customer_unique');
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  await knex.raw(`
    ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customers FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS customers_tenant_isolation_policy ON customers;
  `);

  await knex.raw(`
    CREATE POLICY customers_tenant_isolation_policy
    ON customers
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // NOTE:
  // Direct tenant column → simplest and safest enforcement
  // Protects PII (email, identity) from cross-tenant access
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('customers');
}
