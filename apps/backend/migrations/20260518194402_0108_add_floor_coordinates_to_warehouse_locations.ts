import { Knex } from 'knex';

/**
 * MIGRATION 0108 — add_floor_coordinates_to_warehouse_locations
 * ---------------------------------------------------------------
 * Extends warehouse_locations with physical floor layout metadata.
 * All columns are nullable — backwards compatible with existing rows.
 *
 * NEW COLUMNS:
 *
 *   position_x      — X coordinate on warehouse floor (metres from origin)
 *   position_y      — Y coordinate on warehouse floor (metres from origin)
 *   width           — physical width of this location (metres)
 *   depth           — physical depth of this location (metres)
 *   orientation     — rotation in degrees (0/90/180/270)
 *   rack_levels     — number of shelf levels in this rack (bins per level derived)
 *   zone_type       — operational zone classification
 *
 * ZONE TYPES:
 *   pick            — primary picking zone
 *   pack            — packing station area
 *   receive         — inbound receiving dock
 *   ship            — outbound shipping bay
 *   returns         — returns processing area
 *   quarantine      — quarantine / hold area
 *   kitting         — kitting / assembly bench
 *   storage         — general storage (default)
 *
 * DESIGN INTENT:
 *   - position_x/y + width/depth define the rack footprint on a 2D canvas
 *   - rack_levels drives the 3D renderer (how tall to draw the rack)
 *   - zone_type drives colour coding in both 2D and 3D views
 *   - orientation allows racks to face any cardinal direction
 *
 * CANVAS COORDINATE SYSTEM:
 *   Origin (0,0) = top-left corner of warehouse floor
 *   X increases rightward, Y increases downward
 *   Units: metres (display scaled to pixels by the renderer)
 *
 * PHASE 2: 2D canvas editor writes position_x/y + width/depth on drag-drop
 * PHASE 3: Three.js renderer reads rack_levels for vertical geometry
 *
 * See: docs/blueprints/WarehouseGrid.md
 */
export async function up(knex: Knex): Promise<void> {

  // 1. Zone type enum
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'warehouse_zone_type'
      ) THEN
        CREATE TYPE warehouse_zone_type AS ENUM (
          'pick',
          'pack',
          'receive',
          'ship',
          'returns',
          'quarantine',
          'kitting',
          'storage'
        );
      END IF;
    END$$;
  `);

  // 2. Add columns
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table
      .decimal('position_x', 8, 3)
      .nullable()
      .comment('X coordinate on warehouse floor in metres from top-left origin');

    table
      .decimal('position_y', 8, 3)
      .nullable()
      .comment('Y coordinate on warehouse floor in metres from top-left origin');

    table
      .decimal('width', 6, 3)
      .nullable()
      .comment('Physical width of this location in metres');

    table
      .decimal('depth', 6, 3)
      .nullable()
      .comment('Physical depth of this location in metres');

    table
      .integer('orientation')
      .nullable()
      .defaultTo(0)
      .comment('Rotation in degrees: 0=north, 90=east, 180=south, 270=west');

    table
      .integer('rack_levels')
      .nullable()
      .comment('Number of vertical shelf levels — drives 3D rack height renderer');

    table
      .specificType('zone_type', 'warehouse_zone_type')
      .nullable()
      .defaultTo('storage')
      .comment('Operational zone classification — drives colour coding in 2D/3D views');

    table
      .timestamp('last_printed_at', { useTz: true })
      .nullable()
      .comment('Timestamp of last barcode print — updated by floor-planning module when Print barcode is triggered');
  });

  // 3. Index for canvas queries (fetch all locations with coordinates for a shop)
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.index(
      ['shop_id', 'position_x', 'position_y'],
      'warehouse_locations_floor_position_idx'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropIndex([], 'warehouse_locations_floor_position_idx');
    table.dropColumn('position_x');
    table.dropColumn('position_y');
    table.dropColumn('width');
    table.dropColumn('depth');
    table.dropColumn('orientation');
    table.dropColumn('rack_levels');
    table.dropColumn('zone_type');
    table.dropColumn('last_printed_at');
  });

  await knex.raw(`DROP TYPE IF EXISTS warehouse_zone_type;`);
}