import type { Knex } from 'knex';

/**
 * MIGRATION 0165 — repair_refund_execution_line_item_decision_columns
 * ----------------------------------------------------------------------------
 * RETURNS-SCHEMA-DRIFT-01
 *
 * Production has 20260212162717_0008_refund_executions_sovereign recorded as
 * applied, but `refund_execution_line_items` is MISSING five columns the
 * current canonical 0008 declares:
 *
 *   return_job_id, owner_decision, decision_notes, decision_by, decision_at
 *
 * ...plus the single-column index on return_job_id and the FK
 *
 *   refund_execution_line_items.return_job_id
 *     -> return_jobs.return_job_id ON DELETE CASCADE
 *
 * ROOT CAUSE: 0008 was amended AFTER production had already applied it. Knex
 * marks 0008 complete and will never re-run it, so the amendment never reached
 * production. 0008's own DRIFT WARNING (0008:4-16) forbids amending its up()
 * again and requires a NEW forward migration — the same approach taken by 0131
 * for the RLS policy drift. 0008 is deliberately NOT touched by this migration.
 *
 * WHY THE REAL INCIDENT MATTERS: `listItemsAwaitingDecision`
 * (returnJobs.service.ts:946) selects reli.owner_decision / decision_notes /
 * decision_at and joins reli.return_job_id. On the drifted shape that query
 * cannot execute at all — the Returns items surface is down, not degraded.
 *
 * IDEMPOTENT BY DESIGN. Fresh databases already obtain these structures from
 * 0008, so every step below inspects the live PostgreSQL catalog and does
 * nothing when the canonical structure is already present. It must be safe on
 * both shapes: drifted production, and canonical fresh install.
 */

const TABLE = 'refund_execution_line_items';
const COLUMN = 'return_job_id';

interface ColumnShape {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}

async function columnShape(knex: Knex, column: string): Promise<ColumnShape | undefined> {
  const { rows } = await knex.raw(
    `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
    [TABLE, column],
  );
  return rows[0];
}

/**
 * Every single-column FK defined on refund_execution_line_items(return_job_id),
 * described STRUCTURALLY (referenced table/column + delete action) rather than
 * by constraint name — a correct FK created under a different name must not be
 * duplicated.
 */
async function returnJobForeignKeys(knex: Knex) {
  const { rows } = await knex.raw(
    `SELECT c.conname,
            c.confdeltype,
            ft.relname AS referenced_table,
            fa.attname AS referenced_column
       FROM pg_constraint c
       JOIN pg_class t  ON t.oid = c.conrelid
       JOIN pg_class ft ON ft.oid = c.confrelid
       JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord) ON TRUE
       JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = k.attnum
       JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
       JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fk.attnum
      WHERE c.contype = 'f'
        AND t.relname = ?
        AND a.attname = ?
        AND array_length(c.conkey, 1) = 1`,
    [TABLE, COLUMN],
  );
  return rows as Array<{
    conname: string;
    confdeltype: string;
    referenced_table: string;
    referenced_column: string;
  }>;
}

/** Indexes whose key is exactly (return_job_id). */
async function returnJobIndexes(knex: Knex) {
  const { rows } = await knex.raw(
    `SELECT i.relname AS index_name
       FROM pg_index x
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(x.indkey)
      WHERE t.relname = ? AND a.attname = ? AND x.indnatts = 1`,
    [TABLE, COLUMN],
  );
  return rows as Array<{ index_name: string }>;
}

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // A. COLUMN REPAIR — conditional, never destructive.
  //
  // ADD COLUMN IF NOT EXISTS leaves an already-canonical column untouched
  // (no recreate, no type churn, no data loss). Types mirror 0008 exactly.
  // -------------------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS return_job_id   uuid,
      ADD COLUMN IF NOT EXISTS owner_decision  return_owner_decision_type,
      ADD COLUMN IF NOT EXISTS decision_notes  text,
      ADD COLUMN IF NOT EXISTS decision_by     integer,
      ADD COLUMN IF NOT EXISTS decision_at     timestamp with time zone;
  `);

  // D. OWNER DECISION DATA — deliberately NOT backfilled.
  //
  // return_jobs.owner_decision/decision_notes/decision_by/decision_at are a
  // JOB-level legacy summary; these columns are per LINE. Copying them would
  // fabricate a per-unit disposition no operator ever made, on every line of a
  // multi-line job. New line-level decision columns start NULL.

  // -------------------------------------------------------------------------
  // C. DETERMINISTIC return_job_id BACKFILL
  //
  // The ONLY permitted relationship:
  //   refund_execution_line_items.lasyncro_refund_execution_id
  //     = return_jobs.lasyncro_refund_execution_id
  //
  // No order ids, no timestamps, no revenue-unit ids, no ordering heuristic.
  // -------------------------------------------------------------------------

  // FAIL CLOSED on ambiguity — detected BEFORE the backfill UPDATE runs.
  //
  // A refund execution carrying more than one return job cannot be attributed
  // to a single job by this relationship. There is no safe automatic answer:
  // picking one would fabricate a link, and silently leaving it NULL while
  // reporting success would hide a data condition nobody has adjudicated. So
  // the migration throws and its transaction aborts, leaving the database
  // exactly as it was for a human to resolve.
  //
  // Deliberately NO heuristic selection and NO `LIMIT 1`.
  const { rows: ambiguous } = await knex.raw(
    `SELECT lasyncro_refund_execution_id, count(*)::int AS job_count
       FROM return_jobs
      WHERE lasyncro_refund_execution_id IS NOT NULL
      GROUP BY lasyncro_refund_execution_id
     HAVING count(*) > 1
      ORDER BY lasyncro_refund_execution_id`,
  );

  if (ambiguous.length > 0) {
    const worst = ambiguous.reduce(
      (m: number, r: { job_count: number }) => Math.max(m, r.job_count),
      0,
    );
    throw new Error(
      `[0165 RETURNS-SCHEMA-DRIFT-01] AMBIGUOUS BACKFILL — aborting before any write. ` +
        `${ambiguous.length} refund execution(s) map to more than one return_jobs row ` +
        `(largest group: ${worst} jobs). The deterministic relationship ` +
        `refund_execution_line_items.lasyncro_refund_execution_id = ` +
        `return_jobs.lasyncro_refund_execution_id cannot resolve these to a single job, ` +
        `and this migration will not guess. Resolve the duplicate return_jobs rows, then re-run.`,
    );
  }

  const backfilled = await knex.raw(
    `UPDATE ${TABLE} reli
        SET return_job_id = rj.return_job_id
       FROM return_jobs rj
      WHERE reli.return_job_id IS NULL                       -- preserve existing links
        AND reli.lasyncro_refund_execution_id IS NOT NULL
        AND rj.lasyncro_refund_execution_id = reli.lasyncro_refund_execution_id`,
  );

  // eslint-disable-next-line no-console
  console.log(
    `[0165 RETURNS-SCHEMA-DRIFT-01] deterministic backfill linked ${backfilled.rowCount ?? 0} line item(s).`,
  );

  // -------------------------------------------------------------------------
  // F. INDEX — one usable single-column index on return_job_id.
  // -------------------------------------------------------------------------
  if ((await returnJobIndexes(knex)).length === 0) {
    await knex.raw(
      `CREATE INDEX refund_execution_line_items_return_job_id_index ON ${TABLE} (${COLUMN})`,
    );
  }

  // -------------------------------------------------------------------------
  // E. FK — exactly one canonical FK, matched structurally, not by name.
  // -------------------------------------------------------------------------
  const fks = await returnJobForeignKeys(knex);
  const canonical = fks.filter(
    (fk) =>
      fk.referenced_table === 'return_jobs' &&
      fk.referenced_column === 'return_job_id' &&
      fk.confdeltype === 'c', // 'c' = ON DELETE CASCADE
  );
  const incompatible = fks.filter((fk) => !canonical.includes(fk));

  if (incompatible.length > 0) {
    // An unknown FK on this same single-column relationship is not ours to
    // silently replace — dropping a production structure we did not create
    // could remove referential protection nobody asked us to remove.
    throw new Error(
      `[0165 RETURNS-SCHEMA-DRIFT-01] Refusing to proceed: incompatible FK(s) on ` +
        `${TABLE}(${COLUMN}): ` +
        incompatible
          .map(
            (fk) =>
              `${fk.conname} -> ${fk.referenced_table}(${fk.referenced_column}) ` +
              `ON DELETE '${fk.confdeltype}'`,
          )
          .join(', ') +
        `. Expected return_jobs(return_job_id) ON DELETE CASCADE. Resolve manually.`,
    );
  }

  if (canonical.length === 0) {
    await knex.raw(
      `ALTER TABLE ${TABLE}
         ADD CONSTRAINT refund_execution_line_items_return_job_id_foreign
         FOREIGN KEY (${COLUMN}) REFERENCES return_jobs (return_job_id) ON DELETE CASCADE`,
    );
  }

  // -------------------------------------------------------------------------
  // G. VALIDATION — fail loudly rather than leave a half-repaired schema.
  // -------------------------------------------------------------------------
  const expected: Array<[string, { udt?: string; dataType?: string }]> = [
    ['return_job_id', { udt: 'uuid' }],
    ['owner_decision', { udt: 'return_owner_decision_type' }],
    ['decision_notes', { dataType: 'text' }],
    ['decision_by', { dataType: 'integer' }],
    ['decision_at', { dataType: 'timestamp with time zone' }],
  ];

  for (const [name, want] of expected) {
    const col = await columnShape(knex, name);
    if (!col) {
      throw new Error(`[0165 RETURNS-SCHEMA-DRIFT-01] validation failed: ${TABLE}.${name} missing`);
    }
    if (col.is_nullable !== 'YES') {
      throw new Error(
        `[0165 RETURNS-SCHEMA-DRIFT-01] validation failed: ${TABLE}.${name} must be nullable`,
      );
    }
    if (want.udt && col.udt_name !== want.udt) {
      throw new Error(
        `[0165 RETURNS-SCHEMA-DRIFT-01] validation failed: ${TABLE}.${name} is ` +
          `'${col.udt_name}', expected '${want.udt}'`,
      );
    }
    if (want.dataType && col.data_type !== want.dataType) {
      throw new Error(
        `[0165 RETURNS-SCHEMA-DRIFT-01] validation failed: ${TABLE}.${name} is ` +
          `'${col.data_type}', expected '${want.dataType}'`,
      );
    }
  }

  const finalFks = await returnJobForeignKeys(knex);
  if (finalFks.length !== 1) {
    throw new Error(
      `[0165 RETURNS-SCHEMA-DRIFT-01] validation failed: expected exactly 1 FK on ` +
        `${TABLE}(${COLUMN}), found ${finalFks.length}`,
    );
  }
  if (
    finalFks[0].referenced_table !== 'return_jobs' ||
    finalFks[0].referenced_column !== 'return_job_id' ||
    finalFks[0].confdeltype !== 'c'
  ) {
    throw new Error(
      `[0165 RETURNS-SCHEMA-DRIFT-01] validation failed: FK is not ` +
        `return_jobs(return_job_id) ON DELETE CASCADE`,
    );
  }

  const finalIndexes = await returnJobIndexes(knex);
  if (finalIndexes.length === 0) {
    throw new Error(
      `[0165 RETURNS-SCHEMA-DRIFT-01] validation failed: no single-column index on ` +
        `${TABLE}(${COLUMN})`,
    );
  }
}

/**
 * H. NON-DESTRUCTIVE DOWN — deliberately a no-op.
 *
 * Knex requires an exported down(), but the honest inverse of this migration is
 * "do nothing". These five columns, the index and the FK are CANONICAL 0008
 * structures that this migration only RESTORED; they are not new structures it
 * introduced and therefore not its to remove.
 *
 * Dropping them on rollback would:
 *   - re-create the exact production incident this migration repairs,
 *   - destroy line-level owner-decision data written after the repair,
 *   - destroy deterministically backfilled return_job_id links,
 *   - and break `listItemsAwaitingDecision` again.
 *
 * A faked destructive inverse would be actively dangerous, so none is written.
 * Rolling this migration back leaves the repaired schema in place, which is the
 * intended and approved contract.
 */
export async function down(): Promise<void> {
  // Intentionally empty — see the comment above.
}
