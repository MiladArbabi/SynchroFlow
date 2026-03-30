import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  /**
   * MIGRATION VOIDED
   * ----------------
   * shop_id is now defined in base migration (0037).
   *
   * This migration previously:
   * - added shop_id
   * - backfilled from variants
   * - added constraints
   *
   * These are now part of canonical schema.
   *
   * Keeping this migration as NO-OP to preserve
   * migration history integrity and checksum chain.
   */
}

export async function down(knex: Knex): Promise<void> {
  /**
   * NO-OP
   * ------
   * Reversal handled by base migration rollback.
   */
}
