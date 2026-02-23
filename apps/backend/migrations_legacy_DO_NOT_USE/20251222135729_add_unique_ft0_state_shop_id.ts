//apps/backend/migrations/20251222135729_add_unique_ft0_state_shop_id.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ft0_state', (table) => {
    table.unique(['shop_id'], 'uq_ft0_state_shop_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ft0_state', (table) => {
    table.dropUnique(['shop_id'], 'uq_ft0_state_shop_id');
  });
}
