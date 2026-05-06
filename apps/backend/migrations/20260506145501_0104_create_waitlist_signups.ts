// apps/backend/migrations/20260506145501_0104_create_waitlist_signups.ts
// Creates waitlist_signups — system-level table, no tenant context.
// Stores all signups from landing page and checklist forms as source of truth.
// Resend email is a secondary notification only — this table is the record.
//
// RLS: waitlist_signups are pre-tenant public submissions — no shop_id exists.
// RLS is intentionally NOT enabled on this table.
// @rls-exempt: waitlist signups are anonymous pre-registration data, no tenant isolation needed

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('waitlist_signups', (t) => {
    t.increments('id').primary()
    t.string('email', 254).notNullable()
    t.string('store_url', 512).nullable()
    // source: which form submitted — 'landing_page' | 'checklist'
    t.string('source', 64).notNullable().defaultTo('landing_page')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())

    t.unique(['email'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('waitlist_signups')
}