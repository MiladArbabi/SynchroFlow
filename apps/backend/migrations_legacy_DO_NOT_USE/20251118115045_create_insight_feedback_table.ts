//apps/backend/migrations/20251118115045_create_insight_feedback_table.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('insight_feedback', (table) => {
    table.uuid('id')
      .primary()
    
    // Insight identification
    table.string('insight_id').notNullable();
    table.enu('trigger_type', ['coach', 'action', 'automation', 'orchestration']).notNullable();
    
    // Feedback data
    table.enu('feedback_action', ['accepted', 'dismissed', 'ignored']).notNullable();
    table.enu('feedback_reason', ['not_relevant', 'incorrect', 'already_done']).nullable();
    table.text('feedback_context').nullable();
    
    // User context
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.integer('shop_id').references('id').inTable('shops').onDelete('CASCADE');
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes for common queries
    table.index(['insight_id']);
    table.index(['user_id']);
    table.index(['shop_id']);
    table.index(['trigger_type']);
    table.index(['created_at']);
  });

  // Add updated_at trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  await knex.raw(`
    CREATE TRIGGER update_insight_feedback_updated_at 
    BEFORE UPDATE ON insight_feedback 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_insight_feedback_updated_at ON insight_feedback');
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column');
  await knex.schema.dropTable('insight_feedback');
}