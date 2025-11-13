// In packages/api/migrations/20251113154031_add_user_state_tracking.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Check and add columns to users table only if they don't exist
  const hasPreferredMode = await knex.schema.hasColumn('users', 'preferred_mode');
  if (!hasPreferredMode) {
    await knex.schema.alterTable('users', (table) => {
      table.enum('preferred_mode', ['survival', 'growth', 'architect']).defaultTo('survival');
    });
  }

  const hasDetectedMode = await knex.schema.hasColumn('users', 'detected_mode');
  if (!hasDetectedMode) {
    await knex.schema.alterTable('users', (table) => {
      table.enum('detected_mode', ['survival', 'growth', 'architect']).defaultTo('survival');
    });
  }

  const hasShopifyConnected = await knex.schema.hasColumn('users', 'shopify_connected');
  if (!hasShopifyConnected) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('shopify_connected').defaultTo(false);
    });
  }

  const hasStripeConnected = await knex.schema.hasColumn('users', 'stripe_connected');
  if (!hasStripeConnected) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('stripe_connected').defaultTo(false);
    });
  }

  const hasFirstInsightDelivered = await knex.schema.hasColumn('users', 'first_insight_delivered');
  if (!hasFirstInsightDelivered) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('first_insight_delivered').defaultTo(false);
    });
  }

  // Create user_milestones table only if it doesn't exist
  const hasMilestonesTable = await knex.schema.hasTable('user_milestones');
  if (!hasMilestonesTable) {
    await knex.schema.createTable('user_milestones', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('milestone').notNullable();
      table.timestamp('achieved_at').defaultTo(knex.fn.now());
      
      table.unique(['user_id', 'milestone']);
      table.index(['user_id']);
      table.index(['milestone']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Only drop columns if they exist
  const hasPreferredMode = await knex.schema.hasColumn('users', 'preferred_mode');
  if (hasPreferredMode) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('preferred_mode');
    });
  }

  const hasDetectedMode = await knex.schema.hasColumn('users', 'detected_mode');
  if (hasDetectedMode) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('detected_mode');
    });
  }

  const hasShopifyConnected = await knex.schema.hasColumn('users', 'shopify_connected');
  if (hasShopifyConnected) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('shopify_connected');
    });
  }

  const hasStripeConnected = await knex.schema.hasColumn('users', 'stripe_connected');
  if (hasStripeConnected) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('stripe_connected');
    });
  }

  const hasFirstInsightDelivered = await knex.schema.hasColumn('users', 'first_insight_delivered');
  if (hasFirstInsightDelivered) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('first_insight_delivered');
    });
  }

  // Drop user_milestones table only if it exists
  const hasMilestonesTable = await knex.schema.hasTable('user_milestones');
  if (hasMilestonesTable) {
    await knex.schema.dropTable('user_milestones');
  }
}