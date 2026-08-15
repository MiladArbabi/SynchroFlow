import type { Knex } from 'knex';

/**
 * ZONE-SHAPE-01b
 *
 * Dock opening direction is warehouse truth, not renderer inference.
 * NULL means Auto. Explicit values persist merchant intent.
 * `none` deliberately renders no opening.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TYPE warehouse_dock_face AS ENUM (
      'north',
      'south',
      'east',
      'west',
      'none'
    )
  `);

  await knex.raw(`
    ALTER TABLE warehouse_locations
    ADD COLUMN dock_face warehouse_dock_face NULL
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

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE warehouse_locations
    DROP CONSTRAINT IF EXISTS warehouse_locations_dock_face_zone_check
  `);

  await knex.raw(`
    ALTER TABLE warehouse_locations
    DROP COLUMN IF EXISTS dock_face
  `);

  await knex.raw(`
    DROP TYPE IF EXISTS warehouse_dock_face
  `);
}
