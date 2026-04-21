// apps/backend/migrations/20260415143001_0092_create_morning_brief_snapshots.ts
//
// morning_brief_snapshots (OVR-01)
// --------------------------------
// Pre-computed morning brief per shop.
// One active row per shop at any time — replaced on each recompute.
//
// Writers:
//   - Nightly brief job (runs at 5am per shop timezone, OVR-02)
//   - On-demand refresh endpoint (15-minute cooldown enforced in service layer)
//
// Readers:
//   - GET /api/v1/modules/overview/morning-brief
//   - Push notification dispatcher (OVR-03)
//
// Signal schema (signals JSONB column):
//   Array of MorningBriefSignal — max 5, sorted P1→P5.
//   Each signal: { id, priority, title, detail, module, deepLink, count }
//
// Trust gating:
//   Brief is only computed when trust_eligible = true.
//   If trust state degrades after computation, brief is served stale
//   with a trust_warning flag set to true.
//
// CHANGE POLICY:
//   Schema changes here must be reflected in:
//     1. overviewMorningBrief.resolver.ts
//     2. morning-brief nightly job
//     3. Push notification dispatcher
//     4. Frontend MorningBrief component

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('morning_brief_snapshots');
  if (exists) return;

  await knex.schema.createTable('morning_brief_snapshots', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .unique() // One active brief per shop
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // --- Signal payload ---
    // JSONB array of MorningBriefSignal (max 5).
    // Schema: [{ id, priority, title, detail, module, deepLink, count }]
    // Empty array = quiet day (no urgent issues).
    table.jsonb('signals').notNullable().defaultTo('[]');

    /**
     * GREETING + SUMMARY (OVR-01)
     * ----------------------------
     * greeting: personalized salutation computed at brief generation time.
     *   e.g. "Good morning, Milad" — uses shop timezone for time-of-day accuracy.
     * summary_line: one-sentence business context sentence.
     *   e.g. "3 urgent issues need your attention" or "All clear — operations on track."
     * Both null when trust not eligible or brief not yet computed.
     */
    table.string('greeting', 255).nullable();
    table.string('summary_line', 500).nullable();

    // --- Metadata ---
    table.boolean('has_urgent_issues').notNullable().defaultTo(false);

    // --- Trust state at computation time ---
    // If trust degrades after computation, frontend shows trust_warning.
    table.boolean('trust_eligible').notNullable().defaultTo(false);
    table.boolean('trust_warning').notNullable().defaultTo(false);

    // --- Refresh control ---
    // generated_at: when brief was last computed
    // next_refresh_at: earliest time on-demand refresh is allowed (15min cooldown)
    table.timestamp('generated_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('next_refresh_at').notNullable().defaultTo(knex.fn.now());

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
  await knex.schema.alterTable('morning_brief_snapshots', (table) => {
    table.index('generated_at', 'idx_morning_brief_snapshots_generated_at');
    table.index('next_refresh_at', 'idx_morning_brief_snapshots_next_refresh_at');
    table.index('has_urgent_issues', 'idx_morning_brief_snapshots_urgent');
  });

  // --- RLS: tenant isolation ---
  await knex.raw(`
    ALTER TABLE morning_brief_snapshots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE morning_brief_snapshots FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS morning_brief_snapshots_tenant_isolation_policy ON morning_brief_snapshots;
  `);

  await knex.raw(`
    CREATE POLICY morning_brief_snapshots_tenant_isolation_policy
    ON morning_brief_snapshots
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('morning_brief_snapshots');
}