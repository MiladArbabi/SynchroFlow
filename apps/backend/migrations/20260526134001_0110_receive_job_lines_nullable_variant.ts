//apps/backend/migrations/20260526134001_0110_receive_job_lines_nullable_variant.ts
import { Knex } from 'knex';

/**
 * MIGRATION 0110 — receive_job_lines_nullable_variant
 * -----------------------------------------------------
 * Makes lasyncro_variant_id nullable on receive_job_lines.
 *
 * Reason:
 * PO line items created via the Suppliers portal UI use free-text
 * descriptions with no variant linkage. receive_job_lines must
 * support these lines in count-only mode (no barcode scanning).
 *
 * Variant linkage can be added later via:
 * PATCH /api/v1/suppliers/purchase-orders/:poId/line-items/:lineId
 *
 * Also replaces the blanket unique constraint on
 * (receive_job_id, lasyncro_variant_id) with a partial unique index
 * that only applies when lasyncro_variant_id IS NOT NULL.
 * Without this, multiple unlinked lines on the same job would
 * violate uniqueness on NULL = NULL.
 *
 * CHANGE CONTROL: Any modification to receive_job_lines schema
 * requires explicit approval per ReceiveJobProcess.md.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Drop FK constraint to allow nullability change
  await knex.raw(`
    ALTER TABLE receive_job_lines
    DROP CONSTRAINT IF EXISTS receive_job_lines_lasyncro_variant_id_foreign;
  `);

  // 2. Make lasyncro_variant_id nullable
  await knex.raw(`
    ALTER TABLE receive_job_lines
    ALTER COLUMN lasyncro_variant_id DROP NOT NULL;
  `);

  // 3. Re-add FK as nullable (ON DELETE SET NULL — variant deleted = line becomes unlinked)
  await knex.raw(`
    ALTER TABLE receive_job_lines
    ADD CONSTRAINT receive_job_lines_lasyncro_variant_id_foreign
    FOREIGN KEY (lasyncro_variant_id)
    REFERENCES variants(lasyncro_variant_id)
    ON DELETE SET NULL;
  `);

  // 4. Drop blanket unique constraint (NULL = NULL causes multiple unlinked lines to collide)
  await knex.raw(`
    ALTER TABLE receive_job_lines
    DROP CONSTRAINT IF EXISTS receive_job_lines_unique;
  `);

  // 5. Replace with partial unique index — only enforces uniqueness when variant is linked
  await knex.raw(`
    CREATE UNIQUE INDEX receive_job_lines_variant_unique
    ON receive_job_lines (receive_job_id, lasyncro_variant_id)
    WHERE lasyncro_variant_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS receive_job_lines_variant_unique;`);

  await knex.raw(`
    ALTER TABLE receive_job_lines
    DROP CONSTRAINT IF EXISTS receive_job_lines_lasyncro_variant_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE receive_job_lines
    ALTER COLUMN lasyncro_variant_id SET NOT NULL;
  `);

  await knex.raw(`
    ALTER TABLE receive_job_lines
    ADD CONSTRAINT receive_job_lines_lasyncro_variant_id_foreign
    FOREIGN KEY (lasyncro_variant_id)
    REFERENCES variants(lasyncro_variant_id)
    ON DELETE RESTRICT;
  `);

  await knex.raw(`
    ALTER TABLE receive_job_lines
    ADD CONSTRAINT receive_job_lines_unique
    UNIQUE (receive_job_id, lasyncro_variant_id);
  `);
}