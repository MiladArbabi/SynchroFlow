import type { Knex } from "knex";

/**
 * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE the
 * user_milestones table was added to this file. Knex marks this
 * migration complete and will NEVER re-run it — so this file's
 * current `up()` does NOT reflect what actually existed in prod for
 * shops/tenants created before 2026-07-28.
 *
 * user_milestones was backfilled into production separately via
 * migration 0129 (20260728140000_0129_backfill_missing_batch1_tables.ts).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Any further schema change here only affects fresh/local databases
 * migrated from scratch. Use a new forward migration instead (rule 7).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();

    /**
     * Shop ownership
     * --------------
     * Required by:
     * - sync worker
     * - lifecycle evaluator
     * - onboarding readiness providers
     *
     * 1 user → 1 shop (current invariant)
     */
    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.index(['shop_id']);

    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();

    table.string('first_name');
    table.string('last_name');

    /**
     * USER ROLE
     * ---------
     * Determines view access and permitted actions.
     *
     * owner    — full sidenav, all modules, settings, batch release
     * admin    — same as owner, multi-user management
     * operator — WMS-only mobile view (pick, pack, stow)
     *
     * Drives sidenav filtering and route guards on frontend.
     * Will be superseded by action-level entitlements (WM-19).
     */
    table.enum('role', ['owner', 'admin', 'operator']).notNullable().defaultTo('owner');

    /**
     * User state tracking (baked-in baseline)
     * ----------------------------------------
     * These existed in legacy migrations and are
     * required by sync + lifecycle workers.
     */
    table.enum('preferred_mode', ['survival', 'growth', 'architect']).defaultTo('survival');
    table.enum('detected_mode', ['survival', 'growth', 'architect']).defaultTo('survival');

    table.boolean('shopify_connected').defaultTo(false);
    table.boolean('stripe_connected').defaultTo(false);

    table.string('orders_per_month_segment', 20);
    table.string('entry_channel').defaultTo('unknown');

    /**
     * SKIPPABLE PROFILE COMPLETION (App Store ghost users)
     * ------------------------------------------------------
     * Null = prompt not yet shown/acted on.
     * Timestamp = user either saved real name or explicitly skipped.
     * Set via PATCH /api/v1/users/me/profile. Gated on
     * entry_channel = 'shopify_app_store' in the frontend.
     */
    table.timestamp('profile_prompt_dismissed_at', { useTz: true }).nullable();

    /**
     * EMAIL VERIFICATION (AUTH-007)
     * ------------------------------
     * email_verified_at      — null = unverified, timestamp = verified
     * email_verification_token — crypto random hex, single-use
     * email_verification_expires_at — 30 min window per target design A5
     *
     * Verification is optional for OAuth paths (Shopify/Google).
     * Token is cleared on successful verification.
     */
    table.timestamp('email_verified_at', { useTz: true }).nullable();
    table.string('email_verification_token', 128).nullable();
    table.timestamp('email_verification_expires_at', { useTz: true }).nullable();

    /**
     * PASSWORD RESET (AUTH: forgot-password flow)
     * --------------------------------------------
     * password_reset_token      — crypto random hex, single-use
     * password_reset_expires_at — 30 min window (matches UI copy)
     * Token cleared on successful reset.
     */
    table.string('password_reset_token', 128).nullable();
    table.timestamp('password_reset_expires_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['email']);
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  await knex.raw(`
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE users FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS users_tenant_isolation_policy ON users;
    DROP POLICY IF EXISTS users_select_tenant_isolation ON users;
    DROP POLICY IF EXISTS users_update_tenant_isolation ON users;
    DROP POLICY IF EXISTS users_delete_tenant_isolation ON users;
    DROP POLICY IF EXISTS users_insert_open ON users;
  `);

  await knex.raw(`
    CREATE POLICY users_select_tenant_isolation
    ON users FOR SELECT
    USING (
      shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IS NULL
      OR current_setting('app.current_tenant', true) = ''
      OR current_setting('app.current_tenant', true) = '0'
    );
  `);
  await knex.raw(`
    CREATE POLICY users_update_tenant_isolation
    ON users FOR UPDATE
    USING (shop_id = current_setting('app.current_tenant', true)::int);
  `);
  await knex.raw(`
    CREATE POLICY users_delete_tenant_isolation
    ON users FOR DELETE
    USING (shop_id = current_setting('app.current_tenant', true)::int);
  `);
  await knex.raw(`
    CREATE POLICY users_insert_open
    ON users FOR INSERT
    WITH CHECK (true);
  `);

  // NOTE:
  // 1 user → 1 shop invariant → safe direct enforcement
  // Protects auth credentials from cross-tenant access

  // ============================
  // USER STATES (Onboarding KV)
  // ============================
  await knex.schema.createTable('user_states', (table) => {
    table.increments('id').primary();

    table.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.string('key').notNullable();
    table.text('value');

    table.timestamps(true, true);

    table.unique(['user_id', 'key']);
  });

  await knex.schema.createTable('user_milestones', (table) => {
    table.increments('id').primary();
    table.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.string('milestone').notNullable();
    table.timestamp('achieved_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'milestone']); // required for .onConflict(['user_id','milestone'])
  });
  await knex.raw(`
    ALTER TABLE user_milestones ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_milestones FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS user_milestones_tenant_isolation_policy ON user_milestones;
  `);
  await knex.raw(`
    CREATE POLICY user_milestones_tenant_isolation_policy
    ON user_milestones
    USING (
      user_id IN (
        SELECT id FROM users
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // --- RLS: Enforce tenant isolation (via users) ---
  await knex.raw(`
    ALTER TABLE user_states ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_states FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS user_states_tenant_isolation_policy ON user_states;
  `);

  await knex.raw(`
    CREATE POLICY user_states_tenant_isolation_policy
    ON user_states
    USING (
      user_id IN (
        SELECT id
        FROM users
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

   // NOTE:
  // Enforced via users → ensures state never leaks across tenants

  /**
   * OPERATOR AVAILABILITY (PP10-03)
   * --------------------------------
   * Operators self-declare available/unavailable days on mobile calendar.
   * Owner reads this to assign tasks within available windows.
   * Upsert on (shop_id, user_id, date) — one row per operator per day.
   */
  await knex.schema.createTable('operator_availability', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.date('date').notNullable();
    table.boolean('is_available').notNullable().defaultTo(true);
    table.text('notes').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['shop_id', 'user_id', 'date']);
    table.index(['shop_id', 'date']);
  });

  await knex.raw(`ALTER TABLE operator_availability ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE operator_availability FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS operator_availability_tenant_isolation ON operator_availability;`);
  await knex.raw(`
    CREATE POLICY operator_availability_tenant_isolation
    ON operator_availability
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);

  /**
   * OPERATOR TASK LOG (PP10-03 — Level 1 labor tracking)
   * -----------------------------------------------------
   * Records task duration per operator — hours logged per task.
   * started_at: when operator claims the task
   * completed_at: when operator confirms completion
   * duration_minutes: denormalised on close for fast dashboard reads
   *
   * task_type: 'pick' | 'pack' | 'stow' | 'receive'
   * entity_id: pick_batch_id | stow_task_id | receive_job_id
   */
  await knex.schema.createTable('operator_task_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.integer('operator_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('task_type', 20).notNullable();
    table.string('entity_id', 255).notNullable();
    table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.integer('duration_minutes').nullable()
      .comment('Computed on close: completed_at - started_at. Denormalised for fast reads.');
    table.index(['shop_id', 'operator_id']);
    table.index(['shop_id', 'task_type']);
  });

  /**
   * OPERATOR AUDIT LOG (AUD-01)
   * ----------------------------
   * Append-only audit trail for all operator actions.
   * One row per action — never updated, never deleted.
   */
  await knex.schema.createTable('operator_audit_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');

    /**
     * DECISION RECORD — operator_id nullability (2026-07-04, RET-AUD service-layer task)
     * -----------------------------------------------------------------------
     * Was: .notNullable() — every audited action assumed a human operator.
     *
     * Changed to nullable to support system/webhook-triggered actions
     * that have no human operator at all (e.g. a carrier RTS webhook
     * auto-creating a return_jobs row — see
     * createReturnJobFromCarrierEvent in returnJobs.service.ts).
     *
     * REJECTED ALTERNATIVE: inventing a sentinel "system user" row in
     * `users` to satisfy NOT NULL. Rejected because that manufactures a
     * fake human identity purely to satisfy a type/schema constraint —
     * it would misrepresent "the system did this" as "a specific user
     * did this," which is worse than an honest NULL.
     *
     * SCOPE, DELIBERATELY NARROW: this column-level relaxation does NOT
     * change the requirement for genuinely operator-triggered actions.
     * CreateUndeliveredReturnJobInput.operatorId (returnJobs.service.ts)
     * remains `number`, NOT `number | null` — every existing call site
     * where a real operator claims/creates a job must keep providing
     * real attribution. Only the NEW carrier-webhook path is allowed to
     * pass null, via its own separate input type with no operatorId
     * field at all — not by loosening the existing operator-facing
     * contract.
     */
    table.integer('operator_id').nullable().references('id').inTable('users').onDelete('CASCADE');

    table.string('action_type', 50).notNullable();
    table.string('entity_type', 50).notNullable();
    table.string('entity_id', 255).notNullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['shop_id', 'operator_id']);
    table.index(['shop_id', 'action_type']);
    table.index(['shop_id', 'entity_type', 'entity_id']);
    table.index(['occurred_at']);
  });

  await knex.raw(`ALTER TABLE operator_audit_log ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE operator_audit_log FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS operator_audit_log_tenant_isolation ON operator_audit_log;`);
  await knex.raw(`
    CREATE POLICY operator_audit_log_tenant_isolation
    ON operator_audit_log
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);

  await knex.raw(`ALTER TABLE operator_task_log ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE operator_task_log FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS operator_task_log_tenant_isolation ON operator_task_log;`);
  await knex.raw(`
    CREATE POLICY operator_task_log_tenant_isolation
    ON operator_task_log
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('operator_task_log');
  await knex.schema.dropTableIfExists('operator_availability');
  await knex.schema.dropTableIfExists('user_states');
  await knex.schema.dropTableIfExists('user_milestones');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('operator_audit_log');
}
