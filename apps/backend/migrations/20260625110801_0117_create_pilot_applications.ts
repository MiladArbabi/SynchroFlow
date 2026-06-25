// apps/backend/migrations/20260625120000_0117_create_pilot_applications.ts
// AUD-1023: Creates pilot_applications — system-level table, no tenant context.
// Stores every /pilot application as source of truth. Resend notification
// (email.service.ts: sendPilotApplicationNotification) is secondary/non-blocking,
// mirroring the waitlist_signups pattern (migration 0104).
//
// RLS: pilot applications are pre-tenant submissions from prospective merchants —
// no shop_id exists yet. RLS is intentionally NOT enabled on this table.
// @rls-exempt: pilot applications are anonymous pre-registration data, no tenant isolation needed

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pilot_applications', (t) => {
    t.increments('id').primary()
    t.string('name', 254).notNullable()
    t.string('email', 254).notNullable()
    t.string('company', 254).notNullable()
    t.string('store_url', 512).notNullable()
    t.string('country', 128).notNullable()
    t.string('orders_per_day', 64).notNullable()
    t.string('sku_count', 64).notNullable()
    t.string('fulfillment', 32).notNullable() // 'in-house' | '3pl' | 'both'
    t.text('biggest_issue').notNullable()
    t.string('uses_stocky', 8).notNullable() // 'yes' | 'no'
    t.string('current_tools', 512).notNullable()
    t.string('open_to_paid_pilot', 16).notNullable() // 'yes' | 'depends' | 'no'
    t.string('contact_method', 16).notNullable() // 'email' | 'phone'
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())

    t.unique(['email'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pilot_applications')
}