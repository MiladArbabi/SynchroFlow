import type { Knex } from 'knex';

const ORIGINAL_TRANSITION_FUNCTION = `
  CREATE OR REPLACE FUNCTION enforce_sync_status_transition()
  RETURNS trigger AS $$
  BEGIN
    IF OLD.sync_status = 'COMPLETED'
       AND NEW.sync_status <> 'COMPLETED' THEN
      RAISE EXCEPTION
        'integrations.sync_status cannot regress after COMPLETED';
    END IF;

    IF NOT (
      (OLD.sync_status = 'PENDING' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR
      (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status IN ('SYNCING_ORDERS','FAILED')) OR
      (OLD.sync_status = 'SYNCING_ORDERS' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR
      (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status = 'SYNCING_INVENTORY') OR
      (OLD.sync_status = 'SYNCING_INVENTORY' AND NEW.sync_status = 'SYNCING_SHOP') OR
      (OLD.sync_status = 'SYNCING_SHOP' AND NEW.sync_status = 'COMPLETING') OR
      (OLD.sync_status = 'COMPLETING' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR
      (OLD.sync_status = 'FAILED' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR
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
`;

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_sync_status_transition()
    RETURNS trigger AS $$
    DECLARE
      reconnect_shop_id text := current_setting('app.shopify_reconnect_shop_id', true);
      reconnect_integration_id text := current_setting('app.shopify_reconnect_integration_id', true);
      reconnect_generation text := current_setting('app.shopify_reconnect_generation', true);
      authorized_reconnect_reset boolean := false;
    BEGIN
      IF NEW.sync_status = 'PENDING'
         AND NEW.sync_progress_current = 0
         AND NEW.sync_progress_total = 0
         AND NEW.sync_last_error IS NULL
         AND reconnect_shop_id ~ '^[0-9]+$'
         AND reconnect_integration_id ~ '^[0-9]+$'
         AND reconnect_generation ~ '^[0-9]+$'
         AND reconnect_shop_id::bigint = OLD.shop_id
         AND reconnect_integration_id::bigint = OLD.id
         AND OLD.shop_id = NEW.shop_id
         AND OLD.id = NEW.id
         AND OLD.platform = 'shopify'
         AND NEW.platform = OLD.platform
         AND NEW.platform_shop_name = OLD.platform_shop_name
      THEN
        SELECT EXISTS (
          SELECT 1
          FROM shopify_app_installations installation
          JOIN shopify_admin_credentials credential
            ON credential.installation_id = installation.id
           AND credential.shop_id = installation.shop_id
          WHERE installation.shop_id = OLD.shop_id
            AND installation.shop_domain = OLD.platform_shop_name
            AND installation.uninstalled_at IS NULL
            AND credential.credential_state = 'ACTIVE'
            AND credential.credential_generation = reconnect_generation::bigint
        ) INTO authorized_reconnect_reset;
      END IF;

      IF OLD.sync_status = 'COMPLETED'
         AND NEW.sync_status <> 'COMPLETED'
         AND NOT authorized_reconnect_reset THEN
        RAISE EXCEPTION
          'integrations.sync_status cannot regress after COMPLETED';
      END IF;

      IF NOT (
        authorized_reconnect_reset OR
        (OLD.sync_status = 'PENDING' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR
        (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status IN ('SYNCING_ORDERS','FAILED')) OR
        (OLD.sync_status = 'SYNCING_ORDERS' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR
        (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status = 'SYNCING_INVENTORY') OR
        (OLD.sync_status = 'SYNCING_INVENTORY' AND NEW.sync_status = 'SYNCING_SHOP') OR
        (OLD.sync_status = 'SYNCING_SHOP' AND NEW.sync_status = 'COMPLETING') OR
        (OLD.sync_status = 'COMPLETING' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR
        (OLD.sync_status = 'FAILED' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR
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
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(ORIGINAL_TRANSITION_FUNCTION);
}
