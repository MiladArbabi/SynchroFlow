import type { Knex } from 'knex';

/**
 * ZONE-SHAPE-01b
 *
 * Harden dock-face integrity at the database boundary.
 *
 * PostgreSQL CHECK constraints accept UNKNOWN, so the original predicate:
 *   dock_face IS NULL OR zone_type IN (...)
 * allowed an explicit dock_face when zone_type itself was NULL.
 *
 * Explicit dock intent is valid only for receive/ship zones.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE warehouse_locations
    DROP CONSTRAINT IF EXISTS warehouse_locations_dock_face_zone_check
  `);

  await knex.raw(`
    ALTER TABLE warehouse_locations
    ADD CONSTRAINT warehouse_locations_dock_face_zone_check
    CHECK (
      dock_face IS NULL
      OR (
        zone_type IS NOT NULL
        AND zone_type IN (
          'ship'::warehouse_zone_type,
          'receive'::warehouse_zone_type
        )
      )
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE warehouse_locations
    DROP CONSTRAINT IF EXISTS warehouse_locations_dock_face_zone_check
  `);

  await knex.raw(`
    ALTER TABLE warehouse_locations
    ADD CONSTRAINT warehouse_locations_dock_face_zone_check
    CHECK (
      dock_face IS NULL
      OR zone_type IN (
        'ship'::warehouse_zone_type,
        'receive'::warehouse_zone_type
      )
    )
  `);
}