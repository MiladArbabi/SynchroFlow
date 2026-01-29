import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Guard: refuse to run if violations exist
  const result = await knex.raw(`
    SELECT COUNT(*)::int AS count
    FROM order_fulfillment_status
    WHERE canonical_order_id IS NULL
  `);

  const count = result.rows[0]?.count ?? 0;

  if (count > 0) {
    throw new Error(
      `Refusing to enforce NOT NULL: ${count} fulfillment rows lack canonical_order_id`
    );
  }

  // Enforce NOT NULL
  await knex.schema.alterTable('order_fulfillment_status', table => {
    table.string('canonical_order_id').notNullable().alter();
  });

  // Enforce FK
  await knex.schema.alterTable('order_fulfillment_status', table => {
    table
      .foreign('canonical_order_id', 'fk_fulfillment_canonical_order')
      .references('canonical_order_id')
      .inTable('canonical_orders')
      .onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', table => {
    table.dropForeign(
      'canonical_order_id',
      'fk_fulfillment_canonical_order'
    );
    table.string('canonical_order_id').nullable().alter();
  });
}
