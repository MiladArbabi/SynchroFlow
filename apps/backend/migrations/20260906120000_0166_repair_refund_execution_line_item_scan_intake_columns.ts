import type { Knex } from 'knex';

/**
 * MIGRATION 0166 — repair_refund_execution_line_item_scan_intake_columns
 * ----------------------------------------------------------------------------
 * RETURNS-SCHEMA-DRIFT-02
 *
 * The SECOND confirmed production drift on `refund_execution_line_items`. The
 * first drift repair (migration 0165) restored the five missing line-level
 * decision columns; this repairs the remaining nullability/default/column drift:
 *
 * NOTE: this file deliberately does NOT spell out the FIRST issue's marker
 * token. Each marker is a stable, single-owner locator — the regression suites
 * find their repair migration by scanning migration sources for it, so quoting
 * another issue's marker here would make THIS file look like that issue's
 * repair and break its locator. Refer to 0165 by number, never by its marker.
 *
 *   column                        canonical 0008              production
 *   ----------------------------  --------------------------  ------------------
 *   lasyncro_refund_execution_id  uuid NULL                   uuid NOT NULL
 *   refunded_amount               numeric(14,2) NULL          numeric(14,2) NOT NULL
 *   created_at                    timestamptz NOT NULL        timestamptz NULL,
 *                                 DEFAULT now()               no default
 *   source                        varchar(50) NOT NULL        ABSENT
 *                                 DEFAULT 'refund_webhook'
 *
 * SAME ROOT CAUSE as -01: `0008` ran in production (batch 1, 2026-06-18) and was
 * later amended in source. Knex had it recorded as complete and never re-ran it,
 * so the amendments reached fresh installs and dev only. `0008` and `0165` are
 * deliberately NOT edited — 0008's DRIFT WARNING is authoritative, and amending
 * an already-applied migration cannot reach production.
 *
 * WHY IT MATTERS: this is the SCAN-INTAKE shape. `createManualReturnLine()`
 * writes a line for a return job that has no refund yet, so
 * `lasyncro_refund_execution_id` and `refunded_amount` are NULL by design, and
 * `source` distinguishes 'scan_intake_manual' from 'refund_webhook'. On the
 * production shape that insert cannot succeed at all.
 *
 * DELIBERATELY UNTOUCHED (production already has these correct): the primary
 * key, all three FKs, the execution/revenue-unit unique constraint, every index
 * (including `return_job_id` from 0165), RLS enable + FORCE state, and
 * `refund_execution_line_items_tenant_isolation_policy`. Nothing below drops or
 * recreates a constraint, index or column — only nullability, defaults, and the
 * addition of the missing `source` column.
 *
 * FAIL-CLOSED THROUGHOUT. This migration refuses to coerce types, recreate
 * columns, invent timestamps, or fabricate historical provenance. Where the live
 * shape is not what the repair was designed for, it throws and its transaction
 * aborts, leaving the database untouched for a human to adjudicate.
 */

const TABLE = 'refund_execution_line_items';

interface ColumnShape {
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  character_maximum_length: number | null;
}

async function columnShape(knex: Knex, column: string): Promise<ColumnShape | undefined> {
  const { rows } = await knex.raw(
    `SELECT data_type, udt_name, is_nullable, column_default,
            numeric_precision, numeric_scale, character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
    [TABLE, column],
  );
  return rows[0];
}

function fail(message: string): never {
  throw new Error(`[0166 RETURNS-SCHEMA-DRIFT-02] ${message}`);
}

export async function up(knex: Knex): Promise<void> {
  const rowCount = Number(
    (await knex.raw(`SELECT count(*)::int AS n FROM ${TABLE}`)).rows[0].n,
  );

  // -------------------------------------------------------------------------
  // 5. TYPE VALIDATION BEFORE ANY ALTER.
  //
  // Nullability and defaults are safe to converge; TYPES are not. If the live
  // type is not what canonical 0008 declares, this migration refuses rather
  // than coercing or recreating the column — a USING-cast or drop/recreate on a
  // production table is exactly the kind of unreviewed change that caused the
  // drift being repaired here.
  // -------------------------------------------------------------------------
  const execId = await columnShape(knex, 'lasyncro_refund_execution_id');
  if (!execId) fail(`${TABLE}.lasyncro_refund_execution_id is missing — not a shape this repair understands.`);
  if (execId.udt_name !== 'uuid') {
    fail(
      `${TABLE}.lasyncro_refund_execution_id is '${execId.udt_name}', expected 'uuid'. ` +
        `Refusing to coerce or recreate the column.`,
    );
  }

  const amount = await columnShape(knex, 'refunded_amount');
  if (!amount) fail(`${TABLE}.refunded_amount is missing — not a shape this repair understands.`);
  if (
    amount.data_type !== 'numeric' ||
    amount.numeric_precision !== 14 ||
    amount.numeric_scale !== 2
  ) {
    fail(
      `${TABLE}.refunded_amount is '${amount.data_type}(${amount.numeric_precision},` +
        `${amount.numeric_scale})', expected 'numeric(14,2)'. Refusing to coerce or recreate.`,
    );
  }

  const createdAt = await columnShape(knex, 'created_at');
  if (!createdAt) fail(`${TABLE}.created_at is missing — not a shape this repair understands.`);
  if (createdAt.data_type !== 'timestamp with time zone') {
    fail(
      `${TABLE}.created_at is '${createdAt.data_type}', expected 'timestamp with time zone'. ` +
        `Refusing to coerce or recreate.`,
    );
  }

  // -------------------------------------------------------------------------
  // 4a. Nullability relaxation — the scan-intake shape.
  //
  // DROP NOT NULL is unconditional-safe: it is a no-op when the column is
  // already nullable (canonical/fresh), and the real repair on the drifted
  // shape. It can never fail on existing data.
  // -------------------------------------------------------------------------
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN lasyncro_refund_execution_id DROP NOT NULL`);
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN refunded_amount DROP NOT NULL`);

  // -------------------------------------------------------------------------
  // 6. created_at — SET DEFAULT now(), then SET NOT NULL, fail-closed on NULLs.
  //
  // Timestamps are never invented: a NULL created_at is a real historical fact
  // this migration has no authority to fabricate. Production has zero rows, so
  // this branch is expected to be unreachable there.
  // -------------------------------------------------------------------------
  const nullCreatedAt = Number(
    (await knex.raw(`SELECT count(*)::int AS n FROM ${TABLE} WHERE created_at IS NULL`)).rows[0].n,
  );
  if (nullCreatedAt > 0) {
    fail(
      `${nullCreatedAt} row(s) have created_at IS NULL. Refusing to SET NOT NULL, and refusing ` +
        `to invent timestamps for historical rows. Adjudicate those rows, then re-run.`,
    );
  }

  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN created_at SET DEFAULT now()`);
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN created_at SET NOT NULL`);

  // -------------------------------------------------------------------------
  // 7. source — add when absent, converge when present.
  // -------------------------------------------------------------------------
  const source = await columnShape(knex, 'source');

  if (!source) {
    // Confirmed production drift: column ABSENT and the table EMPTY. Adding a
    // NOT NULL column with a default would silently stamp every existing row
    // 'refund_webhook' — fabricating provenance for lines that may well have
    // been scan-intake. Only safe because prod holds zero rows; anything else
    // is adjudicated by a human.
    if (rowCount > 0) {
      fail(
        `${TABLE}.source is absent but the table holds ${rowCount} row(s). Adding it with ` +
          `DEFAULT 'refund_webhook' would fabricate historical provenance for rows whose real ` +
          `source is unknown. Refusing. Backfill provenance deliberately, then re-run.`,
      );
    }
    await knex.raw(
      `ALTER TABLE ${TABLE}
         ADD COLUMN source varchar(50) NOT NULL DEFAULT 'refund_webhook'`,
    );
  } else {
    // Present already (canonical/fresh, or a partial repair). Validate it is
    // compatible with canonical varchar(50) semantics before converging —
    // never silently replace an incompatible definition.
    if (source.data_type !== 'character varying') {
      fail(
        `${TABLE}.source is '${source.data_type}', expected 'character varying'. ` +
          `Refusing to replace an incompatible column definition.`,
      );
    }
    if (source.character_maximum_length !== 50) {
      fail(
        `${TABLE}.source is varchar(${source.character_maximum_length}), expected varchar(50). ` +
          `Refusing to replace an incompatible column definition.`,
      );
    }

    // Converge default and nullability only. A NULL-valued row would block
    // SET NOT NULL, and 'refund_webhook' is the canonical default for a line
    // with no explicit provenance, so filling only NULLs here is a default
    // application rather than a rewrite of stated provenance.
    await knex.raw(
      `ALTER TABLE ${TABLE} ALTER COLUMN source SET DEFAULT 'refund_webhook'`,
    );
    await knex.raw(
      `UPDATE ${TABLE} SET source = 'refund_webhook' WHERE source IS NULL`,
    );
    await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN source SET NOT NULL`);
  }

  // -------------------------------------------------------------------------
  // VALIDATION — fail loudly rather than leave a half-repaired schema.
  // -------------------------------------------------------------------------
  const finalExecId = await columnShape(knex, 'lasyncro_refund_execution_id');
  if (finalExecId?.is_nullable !== 'YES') {
    fail(`validation failed: ${TABLE}.lasyncro_refund_execution_id is not nullable`);
  }

  const finalAmount = await columnShape(knex, 'refunded_amount');
  if (finalAmount?.is_nullable !== 'YES') {
    fail(`validation failed: ${TABLE}.refunded_amount is not nullable`);
  }

  const finalCreatedAt = await columnShape(knex, 'created_at');
  if (finalCreatedAt?.is_nullable !== 'NO') {
    fail(`validation failed: ${TABLE}.created_at is nullable`);
  }
  if (!/now\(\)|CURRENT_TIMESTAMP/i.test(finalCreatedAt?.column_default ?? '')) {
    fail(
      `validation failed: ${TABLE}.created_at default is ` +
        `'${finalCreatedAt?.column_default}', expected now()/CURRENT_TIMESTAMP`,
    );
  }

  const finalSource = await columnShape(knex, 'source');
  if (!finalSource) fail(`validation failed: ${TABLE}.source missing after repair`);
  if (finalSource.data_type !== 'character varying' || finalSource.character_maximum_length !== 50) {
    fail(
      `validation failed: ${TABLE}.source is ` +
        `'${finalSource.data_type}(${finalSource.character_maximum_length})', expected varchar(50)`,
    );
  }
  if (finalSource.is_nullable !== 'NO') {
    fail(`validation failed: ${TABLE}.source is nullable`);
  }
  if (!/'refund_webhook'/.test(finalSource.column_default ?? '')) {
    fail(
      `validation failed: ${TABLE}.source default is '${finalSource.column_default}', ` +
        `expected 'refund_webhook'`,
    );
  }
}

/**
 * 10. NON-DESTRUCTIVE DOWN — deliberately a no-op.
 *
 * Knex requires an exported down(), but the honest inverse here is "do nothing".
 * These nullability settings, defaults and the `source` column are CANONICAL
 * 0008 structures this migration only RESTORED; they are not structures it
 * introduced, and therefore not its to remove.
 *
 * Reverting them would deliberately reintroduce a KNOWN-INVALID production
 * schema: it would break `createManualReturnLine()` again, drop the provenance
 * column, and re-create the very incident this migration repairs. A faked
 * destructive inverse would be actively dangerous, so none is written.
 */
export async function down(): Promise<void> {
  // Intentionally empty — see the comment above.
}
