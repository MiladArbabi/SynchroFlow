import type { Knex } from 'knex';

/**
 * MIGRATION 0186 — repair_carrier_settings_schema_drift
 * ----------------------------------------------------------------------------
 * Repairs the confirmed shop_carrier_settings schema drift issue. The stable
 * single-owner marker for this repair (see MARKER below, used to locate this
 * file without depending on its migration number) identifies this issue.
 *
 * CONFIRMED PRODUCTION INCIDENT:
 *   GET /api/v1/onboarding/readiness -> 500
 *   Postgres error: column "api_token" does not exist
 *
 * Runtime/readiness code queries public.shop_carrier_settings.api_token, but
 * production still has the ORIGINAL 0113 shape:
 *
 *   public_key   text NOT NULL
 *   private_key  text NOT NULL
 *   api_token    ABSENT
 *
 * ROOT CAUSE: 20260603141001_0113_carrier_integration.ts was amended AFTER
 * production had already applied it, so fresh installs now get all three
 * columns nullable (including api_token), but Knex marks 0113 complete and
 * will never re-run it against production. The amendment therefore never
 * reached production — the same drift pattern as 0165
 * (RETURNS-SCHEMA-DRIFT-01) and 0131. 0113 is deliberately NOT touched here;
 * a NEW forward migration is mandatory.
 *
 * IDEMPOTENT BY DESIGN. Fresh databases already have the canonical shape from
 * 0113, so every step below inspects the live PostgreSQL catalog first and
 * does nothing when the canonical structure is already present. It must be
 * safe on both shapes: drifted production, and canonical fresh install — and
 * safe to run more than once on either.
 */

const TABLE = 'shop_carrier_settings';
const MARKER = 'CARRIER-SETTINGS-SCHEMA-DRIFT-01';

interface ColumnShape {
  data_type: string;
  is_nullable: string;
}

async function columnShape(knex: Knex, column: string): Promise<ColumnShape | undefined> {
  const { rows } = await knex.raw(
    `SELECT data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
    [TABLE, column],
  );
  return rows[0];
}

async function tableExists(knex: Knex): Promise<boolean> {
  const { rows } = await knex.raw(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?`,
    [TABLE],
  );
  return rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // A. FAIL-CLOSED SHAPE VALIDATION — inspect before touching anything.
  //
  // This migration only repairs the ONE confirmed drift (api_token
  // missing / public_key+private_key wrongly NOT NULL). Any other unknown
  // shape is not ours to silently coerce, drop, or recreate.
  // -------------------------------------------------------------------------
  if (!(await tableExists(knex))) {
    throw new Error(`[${MARKER}] validation failed: public.${TABLE} does not exist`);
  }

  const publicKeyBefore = await columnShape(knex, 'public_key');
  if (!publicKeyBefore) {
    throw new Error(`[${MARKER}] validation failed: ${TABLE}.public_key does not exist`);
  }
  if (publicKeyBefore.data_type !== 'text') {
    throw new Error(
      `[${MARKER}] validation failed: ${TABLE}.public_key is '${publicKeyBefore.data_type}', expected 'text'`,
    );
  }

  const privateKeyBefore = await columnShape(knex, 'private_key');
  if (!privateKeyBefore) {
    throw new Error(`[${MARKER}] validation failed: ${TABLE}.private_key does not exist`);
  }
  if (privateKeyBefore.data_type !== 'text') {
    throw new Error(
      `[${MARKER}] validation failed: ${TABLE}.private_key is '${privateKeyBefore.data_type}', expected 'text'`,
    );
  }

  const apiTokenBefore = await columnShape(knex, 'api_token');
  if (apiTokenBefore && apiTokenBefore.data_type !== 'text') {
    // api_token exists but is not the expected type — an unknown shape this
    // migration does not own. Refuse rather than coerce/drop/recreate it.
    throw new Error(
      `[${MARKER}] Refusing to proceed: ${TABLE}.api_token is '${apiTokenBefore.data_type}', ` +
        `expected 'text'. Resolve manually.`,
    );
  }

  // -------------------------------------------------------------------------
  // B. CONVERGENCE — the confirmed repair only. Nothing else on this table is
  // touched: primary key, is_active, created_at, updated_at, webhook_secret,
  // indexes, foreign keys, RLS state and the tenant isolation policy are all
  // correct in production and are left exactly as they are.
  //
  // No default on api_token, no backfill, no credential rewrite.
  // -------------------------------------------------------------------------
  await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS api_token text`);
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN public_key DROP NOT NULL`);
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN private_key DROP NOT NULL`);

  // -------------------------------------------------------------------------
  // C. FINAL VALIDATION — fail loudly rather than leave a half-repaired
  // schema silently in place.
  // -------------------------------------------------------------------------
  const expected: Array<[string, ColumnShape | undefined]> = [
    ['api_token', await columnShape(knex, 'api_token')],
    ['public_key', await columnShape(knex, 'public_key')],
    ['private_key', await columnShape(knex, 'private_key')],
  ];

  for (const [name, col] of expected) {
    if (!col) {
      throw new Error(`[${MARKER}] validation failed: ${TABLE}.${name} missing`);
    }
    if (col.data_type !== 'text') {
      throw new Error(
        `[${MARKER}] validation failed: ${TABLE}.${name} is '${col.data_type}', expected 'text'`,
      );
    }
    if (col.is_nullable !== 'YES') {
      throw new Error(
        `[${MARKER}] validation failed: ${TABLE}.${name} must be nullable, found '${col.is_nullable}'`,
      );
    }
  }
}

/**
 * D. NON-DESTRUCTIVE DOWN — deliberately a no-op.
 *
 * This is a convergence repair between two previously-existing schema
 * histories (drifted production vs. amended fresh-install canonical), not a
 * new structure this migration owns. The honest inverse is "do nothing":
 *
 *   - re-adding NOT NULL to public_key/private_key or dropping api_token
 *     would reproduce the exact production incident this migration exists to
 *     fix;
 *   - it could also destroy valid Shippo api_token configuration written
 *     after the repair, which this migration has no way to distinguish from
 *     data that "shouldn't" be there;
 *   - and this migration cannot know which of the two historical shapes any
 *     given database originally had, so there is no single correct rollback
 *     target to restore.
 *
 * A faked destructive inverse would be actively dangerous, so none is
 * written. Rolling this migration back leaves the repaired schema in place,
 * which is the intended and approved contract — matching the established
 * pattern in 0165 (RETURNS-SCHEMA-DRIFT-01).
 */
export async function down(): Promise<void> {
  // Intentionally empty — see the comment above.
}
