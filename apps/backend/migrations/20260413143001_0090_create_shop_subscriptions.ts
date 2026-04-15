// apps/backend/migrations/20260413120000_0090_create_shop_subscriptions.ts
//
// shop_subscriptions (MON-02)
// ---------------------------
// One row per shop. Source of billing truth.
// Tier constants live in packages/backend-core/src/config/tiers.ts.
//
// Writers:
//   - Stripe webhook handler (subscription lifecycle events)
//   - Auth controller (trial assignment on registration, MON-07)
//   - Admin tooling only
//
// Readers:
//   - JWT issuance (tier claim, MON-03)
//   - require-entitlement middleware (MON-03)
//   - Seat limit enforcement (MON-04)
//   - Order cap enforcement (MON-05)
//
// CHANGE POLICY:
//   Schema changes here must be reflected in:
//     1. billing.controller.ts (checkout/portal)
//     2. stripe webhook handlers
//     3. token.service.ts (JWT tier claim)

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shop_subscriptions');
  if (exists) return;

  await knex.schema.createTable('shop_subscriptions', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // --- Tier ---
    // Must match Tier type in tiers.ts: 'starter' | 'core' | 'growth' | 'scale'
    table
      .string('tier')
      .notNullable()
      .defaultTo('starter');

    // --- Billing interval ---
    table
      .string('billing_interval')
      .notNullable()
      .defaultTo('monthly'); // 'monthly' | 'annual'

    // --- Stripe identifiers ---
    // Null until shop completes Stripe checkout
    table.string('stripe_customer_id').nullable();
    table.string('stripe_subscription_id').nullable();

    // --- Subscription status ---
    // Mirrors Stripe: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'
    table
      .string('status')
      .notNullable()
      .defaultTo('trialing');

    // --- Trial window (MON-07) ---
    // Populated on registration. Null after trial converts or expires.
    table.timestamp('trial_ends_at').nullable();

    // --- Subscription lifecycle timestamps ---
    table.timestamp('current_period_start').nullable();
    table.timestamp('current_period_end').nullable();
    table.timestamp('canceled_at').nullable();

    // --- Extra seats (MON-04) ---
    // Purchasable seat add-ons above tier base limit.
    // Effective seat limit = TIER_CONFIG[tier].seatLimit + extra_seats.
    // Incremented via Stripe quantity-based price object.
    // Never negative — enforced by check constraint below.
    table.integer('extra_seats').notNullable().defaultTo(0);

    table
      .timestamp('created_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // --- Indexes ---
  await knex.schema.alterTable('shop_subscriptions', (table) => {
    table.index('stripe_customer_id', 'idx_shop_subscriptions_stripe_customer_id');
    table.index('stripe_subscription_id', 'idx_shop_subscriptions_stripe_subscription_id');
    table.index('tier', 'idx_shop_subscriptions_tier');
    table.index('status', 'idx_shop_subscriptions_status');
    table.index('trial_ends_at', 'idx_shop_subscriptions_trial_ends_at');
  });

  // --- RLS: tenant isolation ---
  // Billing data is high-sensitivity. Cross-tenant leakage = privilege escalation.
  await knex.raw(`
    ALTER TABLE shop_subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_subscriptions FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shop_subscriptions_tenant_isolation_policy ON shop_subscriptions;
  `);

  await knex.raw(`
    CREATE POLICY shop_subscriptions_tenant_isolation_policy
    ON shop_subscriptions
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // --- Tier check constraint ---
  await knex.raw(`
    ALTER TABLE shop_subscriptions
    ADD CONSTRAINT shop_subscriptions_tier_valid
    CHECK (tier IN ('starter', 'core', 'growth', 'scale'));
  `);

  // --- Billing interval check constraint ---
  await knex.raw(`
    ALTER TABLE shop_subscriptions
    ADD CONSTRAINT shop_subscriptions_billing_interval_valid
    CHECK (billing_interval IN ('monthly', 'annual'));
  `);

  // --- Status check constraint ---
  await knex.raw(`
    ALTER TABLE shop_subscriptions
    ADD CONSTRAINT shop_subscriptions_status_valid
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid'));
  `);

  // --- Extra seats constraint ---
  await knex.raw(`
    ALTER TABLE shop_subscriptions
    ADD CONSTRAINT shop_subscriptions_extra_seats_nonnegative
    CHECK (extra_seats >= 0);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_subscriptions');
}