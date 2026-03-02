//apps/backend/migrations/20251110145156_add_sync_status_to_integrations.ts
import { Knex } from 'knex';

const TABLE_NAME = 'integrations';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    // The "Pizza Tracker" status: 'PENDING', 'SYNCING_PRODUCTS', 'COMPLETED', 'FAILED'
    table.string('sync_status').notNullable().defaultTo('PENDING').index();
    
    // e.g., "50"
    table.integer('sync_progress_current').notNullable().defaultTo(0);
    
    // e.g., "500" (total products)
    table.integer('sync_progress_total').notNullable().defaultTo(0);
    
    // Store the error message if the sync fails
    table.text('sync_last_error');
  });

    /**
   * SYNC STATUS ENUM CONSTRAINT
   * ----------------------------
   * Prevents arbitrary string injection.
   *
   * Valid states:
   * - PENDING
   * - SYNCING_PRODUCTS
   * - SYNCING_ORDERS
   * - SYNCING_INVENTORY
   * - SYNCING_SHOP
   * - COMPLETING
   * - COMPLETED
   * - FAILED
   */
  await knex.raw(`
    ALTER TABLE integrations
    ADD CONSTRAINT integrations_sync_status_check
    CHECK (
      sync_status IN (
        'PENDING',
        'SYNCING_PRODUCTS',
        'SYNCING_ORDERS',
        'SYNCING_INVENTORY',
        'SYNCING_SHOP',
        'COMPLETING',
        'COMPLETED',
        'FAILED'
      )
    );
  `);

  /**
   * IRREVERSIBILITY GUARD
   * ---------------------
   * Once sync_status reaches COMPLETED,
   * it must never change.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_sync_status_transition()
    RETURNS trigger AS $$
    BEGIN

      -- Irreversible once COMPLETED
      IF OLD.sync_status = 'COMPLETED'
         AND NEW.sync_status <> 'COMPLETED' THEN
        RAISE EXCEPTION
          'integrations.sync_status cannot regress after COMPLETED';
      END IF;

      -- Strict transition graph
      IF NOT (
        -- Initial progression
        (OLD.sync_status = 'PENDING' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR

        -- Product → Orders
        (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status IN ('SYNCING_ORDERS','FAILED')) OR

        -- Orders → Completed
        (OLD.sync_status = 'SYNCING_ORDERS' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR

        -- Fallback inventory pipeline
        (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status = 'SYNCING_INVENTORY') OR
        (OLD.sync_status = 'SYNCING_INVENTORY' AND NEW.sync_status = 'SYNCING_SHOP') OR
        (OLD.sync_status = 'SYNCING_SHOP' AND NEW.sync_status = 'COMPLETING') OR
        (OLD.sync_status = 'COMPLETING' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR

        -- Retry path
        (OLD.sync_status = 'FAILED' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR

        -- Idempotent no-op
        (OLD.sync_status = NEW.sync_status)
      ) THEN
        RAISE EXCEPTION
          'Illegal sync_status transition: % → %',
          OLD.sync_status,
          NEW.sync_status;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER integrations_sync_transition_guard
    BEFORE UPDATE ON integrations
    FOR EACH ROW
    EXECUTE FUNCTION enforce_sync_status_transition();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.dropColumn('sync_status');
    table.dropColumn('sync_progress_current');
    table.dropColumn('sync_progress_total');
    table.dropColumn('sync_last_error');
  });
}