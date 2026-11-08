import type { Knex } from 'knex';

/** Forward-only. Never repair or re-key legacy inventory/location records.
 * Run as the migration role: row_security=off fails closed without BYPASSRLS.
 * The protected migration runner owns the transaction.
 * The table lock freezes all tenants while validating and installing guards.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
      SET LOCAL row_security = off;
      LOCK TABLE public.warehouses, public.warehouse_locations IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM public.warehouse_locations l
          LEFT JOIN public.warehouses w ON w.shop_id = l.shop_id AND w.warehouse_id = l.warehouse_id
          WHERE w.warehouse_id IS NULL
        ) THEN RAISE EXCEPTION 'LOCATION_LEGACY_WAREHOUSE_INVALID'; END IF;
        IF EXISTS (
          SELECT 1 FROM public.warehouse_locations l
          LEFT JOIN public.warehouse_locations p ON p.shop_id = l.shop_id
            AND p.warehouse_id = l.warehouse_id AND p.location_code = l.parent_location_code
          WHERE l.parent_location_code IS NOT NULL AND p.location_code IS NULL
        ) THEN RAISE EXCEPTION 'LOCATION_LEGACY_PARENT_INVALID'; END IF;
        IF EXISTS (
          WITH RECURSIVE ancestry AS (
            SELECT shop_id, location_code AS origin, parent_location_code AS next_code,
              ARRAY[location_code]::text[] AS path, false AS cycle
            FROM public.warehouse_locations
            UNION ALL
            SELECT a.shop_id, a.origin, p.parent_location_code,
              a.path || p.location_code::text, p.location_code = ANY(a.path)
            FROM ancestry a JOIN public.warehouse_locations p
              ON p.shop_id = a.shop_id AND p.location_code = a.next_code
            WHERE NOT a.cycle
          ) SELECT 1 FROM ancestry WHERE cycle
        ) THEN RAISE EXCEPTION 'LOCATION_LEGACY_HIERARCHY_CYCLE'; END IF;
        IF EXISTS (
          SELECT 1 FROM public.warehouse_locations a JOIN public.warehouse_locations b
            ON b.shop_id = a.shop_id AND b.location_code <> a.location_code
            AND (a.barcode = b.location_code OR a.barcode = b.barcode)
        ) THEN RAISE EXCEPTION 'LOCATION_LEGACY_IDENTITY_COLLISION'; END IF;
      END $$;

      -- Production 0049 lacks this candidate key as well as the three-column FK.
      CREATE UNIQUE INDEX IF NOT EXISTS warehouse_locations_warehouse_code_unique
        ON public.warehouse_locations (shop_id, warehouse_id, location_code);
      CREATE UNIQUE INDEX IF NOT EXISTS warehouses_shop_warehouse_1305_unique
        ON public.warehouses (shop_id, warehouse_id);
      ALTER TABLE public.warehouse_locations
        DROP CONSTRAINT IF EXISTS warehouse_locations_shop_id_parent_location_code_foreign;
      ALTER TABLE public.warehouse_locations
        DROP CONSTRAINT IF EXISTS warehouse_locations_parent_same_warehouse_fk;
      ALTER TABLE public.warehouse_locations ADD CONSTRAINT warehouse_locations_parent_same_warehouse_fk
        FOREIGN KEY (shop_id, warehouse_id, parent_location_code)
        REFERENCES public.warehouse_locations (shop_id, warehouse_id, location_code) ON DELETE RESTRICT;
      ALTER TABLE public.warehouse_locations ADD CONSTRAINT warehouse_locations_owner_1305_fk
        FOREIGN KEY (shop_id, warehouse_id) REFERENCES public.warehouses (shop_id, warehouse_id) ON DELETE RESTRICT;

      CREATE FUNCTION public.assert_location_integrity_1305(
        tenant integer, warehouse uuid, code text, parent text, override_barcode text
      ) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
      BEGIN
        -- Lock-wait validation needs fresh READ COMMITTED snapshots. A stale
        -- repeatable-read snapshot must never admit a reciprocal reparent.
        IF current_setting('transaction_isolation') <> 'read committed' THEN
          RAISE EXCEPTION 'LOCATION_ISOLATION_UNSUPPORTED' USING ERRCODE = '23514';
        END IF;
        PERFORM pg_advisory_xact_lock(1305, tenant);
        IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE shop_id = tenant AND warehouse_id = warehouse) THEN
          RAISE EXCEPTION 'LOCATION_WAREHOUSE_INVALID' USING ERRCODE = '23514';
        END IF;
        IF parent IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.warehouse_locations WHERE shop_id = tenant
            AND warehouse_id = warehouse AND location_code = parent
        ) THEN
          RAISE EXCEPTION 'LOCATION_PARENT_INVALID' USING ERRCODE = '23514';
        END IF;
        IF parent = code OR EXISTS (
          WITH RECURSIVE ancestors AS (
            SELECT location_code, parent_location_code FROM public.warehouse_locations
              WHERE shop_id = tenant AND location_code = parent
            UNION
            SELECT p.location_code, p.parent_location_code FROM public.warehouse_locations p
              JOIN ancestors a ON p.location_code = a.parent_location_code WHERE p.shop_id = tenant
          ) SELECT 1 FROM ancestors WHERE location_code = code
        ) THEN
          RAISE EXCEPTION 'LOCATION_HIERARCHY_CYCLE' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.warehouse_locations l WHERE l.shop_id = tenant AND l.location_code <> code
            AND (l.barcode = code OR l.location_code = override_barcode OR l.barcode = override_barcode)
        ) THEN
          RAISE EXCEPTION 'LOCATION_IDENTITY_COLLISION' USING ERRCODE = '23505';
        END IF;
      END $$;

      CREATE FUNCTION public.guard_location_integrity_1305() RETURNS trigger
      LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND (NEW.shop_id, NEW.location_code) IS DISTINCT FROM (OLD.shop_id, OLD.location_code) THEN
          RAISE EXCEPTION 'LOCATION_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
        END IF;
        PERFORM public.assert_location_integrity_1305(NEW.shop_id, NEW.warehouse_id,
          NEW.location_code, NEW.parent_location_code, NEW.barcode);
        RETURN NEW;
      END $$;
      CREATE TRIGGER warehouse_locations_integrity_1305
        BEFORE INSERT OR UPDATE OF shop_id, warehouse_id, location_code, parent_location_code, barcode
        ON public.warehouse_locations FOR EACH ROW EXECUTE FUNCTION public.guard_location_integrity_1305();
  `);
}

export async function down(): Promise<void> {
  throw new Error('0229 is forward-only: location integrity must not be weakened');
}
