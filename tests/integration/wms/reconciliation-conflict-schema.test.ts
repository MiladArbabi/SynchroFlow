/**
 * RECONCILIATION-CONFLICT-01 — schema contract
 *
 * Durable Shopify ↔ LaSyncro conflicts require first-class persistence.
 *
 * Contract:
 * - reconciliation conflict evidence is durable and tenant-scoped
 * - Shopify parent-location evidence is distinct from LaSyncro warehouse/bin
 * - replay identity prevents duplicate conflicts
 * - Problem Center supports trusted server-created reconciliation incidents
 * - one Problem Center task exists per reconciliation conflict
 */

import crypto from 'crypto';

import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

jest.setTimeout(30000);

async function createFixtureShop(): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');

  return systemTransaction(async (trx) => {
    const shopId = await createTenantShop(
      trx,
      `reconciliation-conflict-schema-${unique}`
    );

    await setTenantContext(trx, shopId);

    return shopId;
  });
}

describe('RECONCILIATION-CONFLICT-01 — schema', () => {
  it(
    'persists reconciliation conflict evidence with tenant isolation and replay identity',
    async () => {
      const shopId = await createFixtureShop();

      const columnsResult = await withTenant(
        shopId,
        (trx) => trx.raw(`
          SELECT
            column_name,
            udt_name,
            is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'inventory_reconciliation_conflicts'
          ORDER BY ordinal_position
        `)
      );

      const columns = new Map(
        columnsResult.rows.map((row: any) => [
          row.column_name,
          {
            udt: row.udt_name,
            nullable: row.is_nullable === 'YES',
          },
        ])
      );

      expect(columns.get('conflict_id')).toEqual({
        udt: 'uuid',
        nullable: false,
      });

      expect(columns.get('shop_id')).toEqual({
        udt: 'int4',
        nullable: false,
      });

      expect(columns.get('conflict_type')).toEqual({
        udt: 'varchar',
        nullable: false,
      });

      expect(columns.get('source_platform')).toEqual({
        udt: 'varchar',
        nullable: false,
      });

      expect(columns.get('source_domain_event_id')).toEqual({
        udt: 'int8',
        nullable: false,
      });

      expect(columns.get('lasyncro_order_id')).toEqual({
        udt: 'uuid',
        nullable: false,
      });

      expect(columns.get('lasyncro_line_item_id')).toEqual({
        udt: 'uuid',
        nullable: false,
      });

      expect(columns.get('lasyncro_variant_id')).toEqual({
        udt: 'uuid',
        nullable: false,
      });

      /**
       * Shopify owns parent commerce location identity.
       * LaSyncro owns warehouse/bin topology.
       *
       * Either can temporarily be unresolved during reconciliation.
       */
      expect(columns.get('external_location_id')).toEqual({
        udt: 'varchar',
        nullable: true,
      });

      expect(columns.get('warehouse_id')).toEqual({
        udt: 'uuid',
        nullable: true,
      });

      expect(columns.get('quantity')).toEqual({
        udt: 'int4',
        nullable: false,
      });

      expect(columns.get('occurred_at')).toEqual({
        udt: 'timestamptz',
        nullable: false,
      });

      expect(columns.get('candidate_locations')).toEqual({
        udt: 'jsonb',
        nullable: false,
      });

      expect(columns.get('status')).toEqual({
        udt: 'inventory_reconciliation_conflict_status',
        nullable: false,
      });

      expect(columns.get('resolution_action')).toEqual({
        udt: 'varchar',
        nullable: true,
      });

      expect(columns.get('resolution_location_code')).toEqual({
        udt: 'varchar',
        nullable: true,
      });

      expect(columns.get('resolution_notes')).toEqual({
        udt: 'text',
        nullable: true,
      });

      expect(columns.get('resolved_by')).toEqual({
        udt: 'int4',
        nullable: true,
      });

      expect(columns.get('resolved_at')).toEqual({
        udt: 'timestamptz',
        nullable: true,
      });

      /**
       * P1D — one reconciliation conflict may own one targeted blind recount.
       *
       * The conflict remains the parent incident; the recount is evidence-
       * gathering work underneath it.
       */
      expect(columns.get('recount_task_id')).toEqual({
        udt: 'uuid',
        nullable: true,
      });

      expect(columns.get('recount_requested_at')).toEqual({
        udt: 'timestamptz',
        nullable: true,
      });

      expect(columns.get('recount_requested_by')).toEqual({
        udt: 'int4',
        nullable: true,
      });

      const recountLinkConstraints = await withTenant(
        shopId,
        (trx) => trx.raw(`
          SELECT
            conname,
            pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid =
            'public.inventory_reconciliation_conflicts'::regclass
        `)
      );

      const recountConstraintByName = new Map(
        recountLinkConstraints.rows.map((row: any) => [
          row.conname,
          String(row.definition),
        ])
      );

      expect(
        recountConstraintByName.get(
          'inventory_reconciliation_conflicts_recount_task_fk'
        )
      ).toMatch(
        /FOREIGN KEY \(recount_task_id\).*inventory_recount_tasks/i
      );

      expect(
        recountConstraintByName.get(
          'inventory_reconciliation_conflicts_recount_requested_by_fk'
        )
      ).toMatch(
        /FOREIGN KEY \(recount_requested_by\).*users/i
      );

      expect(
        recountConstraintByName.get(
          'inventory_reconciliation_conflicts_recount_link_chk'
        )
      ).toMatch(
        /recount_task_id.*recount_requested_at/i
      );

      expect(columns.get('created_at')).toEqual({
        udt: 'timestamptz',
        nullable: false,
      });

      expect(columns.get('updated_at')).toEqual({
        udt: 'timestamptz',
        nullable: false,
      });

      const statusEnum = await withTenant(
        shopId,
        (trx) => trx.raw(`
          SELECT e.enumlabel
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname =
            'inventory_reconciliation_conflict_status'
          ORDER BY e.enumsortorder
        `)
      );

      expect(
        statusEnum.rows.map((row: any) => row.enumlabel)
      ).toEqual([
        'open',
        'resolved',
        'dismissed',
      ]);

      const problemSourceEnum = await withTenant(
        shopId,
        (trx) => trx.raw(`
          SELECT e.enumlabel
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'problem_center_source'
          ORDER BY e.enumsortorder
        `)
      );

      expect(
        problemSourceEnum.rows.map((row: any) => row.enumlabel)
      ).toContain('reconciliation');

      const rls = await withTenant(
        shopId,
        (trx) => trx.raw(`
          SELECT
            relrowsecurity,
            relforcerowsecurity
          FROM pg_class
          WHERE oid =
            'public.inventory_reconciliation_conflicts'::regclass
        `)
      );

      expect(rls.rows[0]).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });

      const conflictIndexes = await withTenant(
        shopId,
        (trx) => trx.raw(`
          SELECT indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename =
              'inventory_reconciliation_conflicts'
        `)
      );

      const hasReplayIdentity = conflictIndexes.rows.some(
        (row: any) => {
          const def = String(row.indexdef);

          return (
            /CREATE UNIQUE INDEX/i.test(def) &&
            /shop_id/i.test(def) &&
            /source_domain_event_id/i.test(def) &&
            /lasyncro_line_item_id/i.test(def) &&
            /conflict_type/i.test(def)
          );
        }
      );

      expect(hasReplayIdentity).toBe(true);

      const problemIndexes = await withTenant(
        shopId,
        (trx) => trx.raw(`
          SELECT indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'problem_center_tasks'
        `)
      );

      const hasOneTaskPerConflict = problemIndexes.rows.some(
        (row: any) => {
          const def = String(row.indexdef);

          return (
            /CREATE UNIQUE INDEX/i.test(def) &&
            /shop_id/i.test(def) &&
            /source_exception_id/i.test(def) &&
            /source/i.test(def) &&
            /reconciliation/i.test(def)
          );
        }
      );

      expect(hasOneTaskPerConflict).toBe(true);
    }
  );
});
