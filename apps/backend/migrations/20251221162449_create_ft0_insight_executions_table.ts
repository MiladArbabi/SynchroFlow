//apps/backend/migrations/20251221162449_create_ft0_insight_executions_table.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ft0_insight_executions', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.bigInteger('shop_id').notNullable().index();

    table.timestamp('attempted_at', { useTz: true }).notNullable();

    table
      .enu('status', ['SUCCESS', 'EMPTY', 'DEGRADED', 'FAILED'], {
        useNative: true,
        enumName: 'ft0_insight_execution_status'
      })
      .notNullable();

    table.text('error_reason').nullable();

    table.text('payload_hash').notNullable();
    table.jsonb('payload').notNullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Guardrail: prevent duplicate SUCCESS per shop (Postgres partial index)
    table.index(
    ['shop_id'],
    'uniq_ft0_insight_execution_shop_success',
    {
        indexType: 'unique',
        predicate: knex.whereRaw(`status = 'SUCCESS'`)
    } as any
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ft0_insight_executions');
  await knex.raw(`DROP TYPE IF EXISTS ft0_insight_execution_status`);
}
