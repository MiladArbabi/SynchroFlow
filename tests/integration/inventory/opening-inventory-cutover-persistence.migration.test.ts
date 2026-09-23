// tests/integration/inventory/opening-inventory-cutover-persistence.migration.test.ts
//
// 4b-2b / MIGRATION 0199 — permanent DB contract for opening inventory
// cutover persistence.
//
// This suite exercises schema and database invariants only.
// No Shopify client, cutover service, controller, readiness provider, or UI.

import crypto from 'crypto';

import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

import { down as down0199 } from
  '../../../apps/backend/migrations/20260923200000_0199_create_opening_inventory_cutover_persistence';

const CUTOVERS = 'opening_inventory_cutovers';
const BATCHES = 'opening_inventory_cutover_batches';

const CUTOVER_COLUMNS: Record<
  string,
  { nullable: boolean; udt: string[] }
> = {
  cutover_id:                 { nullable: false, udt: ['uuid'] },
  shop_id:                    { nullable: false, udt: ['int4', 'int8'] },
  status:                     { nullable: false, udt: ['varchar', 'text'] },
  approved_by_actor_type:     { nullable: false, udt: ['varchar', 'text'] },
  approved_by_actor_id:       { nullable: false, udt: ['varchar', 'text'] },
  approved_by_role:           { nullable: false, udt: ['varchar', 'text'] },
  approved_at:                { nullable: false, udt: ['timestamptz'] },
  physical_truth_accepted_at: { nullable: true,  udt: ['timestamptz'] },
  correction_variant_count:   { nullable: false, udt: ['int4', 'int8'] },
  batch_count:                { nullable: false, udt: ['int4', 'int8'] },
  last_error:                 { nullable: true,  udt: ['varchar', 'text'] },
  completed_at:               { nullable: true,  udt: ['timestamptz'] },
  created_at:                 { nullable: false, udt: ['timestamptz'] },
  updated_at:                 { nullable: false, udt: ['timestamptz'] },
};

const BATCH_COLUMNS: Record<
  string,
  { nullable: boolean; udt: string[] }
> = {
  id:                          { nullable: false, udt: ['int4', 'int8'] },
  cutover_id:                  { nullable: false, udt: ['uuid'] },
  shop_id:                     { nullable: false, udt: ['int4', 'int8'] },
  batch_sequence:              { nullable: false, udt: ['int4', 'int8'] },
  idempotency_key:             { nullable: false, udt: ['varchar', 'text'] },
  shopify_input:               { nullable: false, udt: ['jsonb'] },
  audit_snapshot:              { nullable: false, udt: ['jsonb'] },
  status:                      { nullable: false, udt: ['varchar', 'text'] },
  attempt_count:               { nullable: false, udt: ['int4', 'int8'] },
  last_attempted_at:           { nullable: true,  udt: ['timestamptz'] },
  last_error:                  { nullable: true,  udt: ['varchar', 'text'] },
  shopify_adjustment_group_id: { nullable: true,  udt: ['varchar', 'text'] },
  completed_at:                { nullable: true,  udt: ['timestamptz'] },
  created_at:                  { nullable: false, udt: ['timestamptz'] },
  updated_at:                  { nullable: false, udt: ['timestamptz'] },
};

async function createFixtureShop(prefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `${prefix}-${unique}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_wms_settings')
      .insert({
        shop_id: shopId,
        bootstrap_model: 'reconcile_opening_expectation_v2',
      })
      .onConflict('shop_id')
      .ignore()
  );

  return shopId;
}

function cutoverRow(
  shopId: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    cutover_id: crypto.randomUUID(),
    shop_id: shopId,
    status: 'prepared',
    approved_by_actor_type: 'user',
    approved_by_actor_id: `user-${shopId}`,
    approved_by_role: 'owner',
    approved_at: new Date(),
    physical_truth_accepted_at: new Date(),
    correction_variant_count: 1,
    batch_count: 1,
    last_error: null,
    completed_at: null,
    ...overrides,
  };
}

function shopifyInput(changeCount = 1) {
  return {
    reason: 'correction',
    name: 'available',
    referenceDocumentUri:
      'gid://lasyncro/OpeningInventoryCutover/test',
    changes: Array.from(
      { length: changeCount },
      (_, index) => ({
        inventoryItemId:
          `gid://shopify/InventoryItem/${1000 + index}`,
        locationId:
          'gid://shopify/Location/2000',
        delta: -1,
        changeFromQuantity: null,
      })
    ),
  };
}

function auditSnapshot(changeCount = 1) {
  return Array.from(
    { length: changeCount },
    (_, index) => ({
      lasyncroVariantId: crypto.randomUUID(),
      openingExpectedQuantity: 10 + index,
      openingPhysicalQuantity: 9 + index,
      quantityDelta: -1,
    })
  );
}

function jsonbFixtureValue(value: unknown): string {
  return typeof value === 'string'
    ? value
    : JSON.stringify(value);
}

function batchRow(
  shopId: number,
  cutoverId: string,
  overrides: Record<string, unknown> = {}
) {
  const row = {
    cutover_id: cutoverId,
    shop_id: shopId,
    batch_sequence: 1,
    idempotency_key:
      `lasyncro:opening-cutover:${cutoverId}:1`,
    shopify_input: shopifyInput(1),
    audit_snapshot: auditSnapshot(1),
    status: 'pending',
    attempt_count: 0,
    last_attempted_at: null,
    last_error: null,
    shopify_adjustment_group_id: null,
    completed_at: null,
    ...overrides,
  };

  return {
    ...row,
    shopify_input:
      jsonbFixtureValue(row.shopify_input),
    audit_snapshot:
      jsonbFixtureValue(row.audit_snapshot),
  };
}

async function insertCutover(
  shopId: number,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const row = cutoverRow(shopId, overrides);

  await withTenant(shopId, (trx) =>
    trx(CUTOVERS).insert(row)
  );

  return String(row.cutover_id);
}

describe(
  '4b-2b — opening inventory cutover persistence migration',
  () => {
    describe('schema surface', () => {
      it(
        'adds opening_inventory_shopify_synced_at as nullable timestamptz',
        async () => {
          const shopId =
            await createFixtureShop('cut-schema-settings');

          const { rows } = await withTenant(
            shopId,
            (trx) =>
              trx.raw(`
                SELECT udt_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'shop_wms_settings'
                  AND column_name =
                    'opening_inventory_shopify_synced_at'
              `)
          );

          expect(rows).toHaveLength(1);
          expect(rows[0].udt_name).toBe('timestamptz');
          expect(rows[0].is_nullable).toBe('YES');
        }
      );

      it.each(Object.entries(CUTOVER_COLUMNS))(
        'cutover.%s matches the persistence contract',
        async (column, expected) => {
          const shopId =
            await createFixtureShop('cut-schema-cutover');

          const { rows } = await withTenant(
            shopId,
            (trx) =>
              trx.raw(
                `
                  SELECT udt_name, is_nullable
                  FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name = ?
                    AND column_name = ?
                `,
                [CUTOVERS, column]
              )
          );

          expect(rows).toHaveLength(1);
          expect(expected.udt).toContain(rows[0].udt_name);
          expect(rows[0].is_nullable).toBe(
            expected.nullable ? 'YES' : 'NO'
          );
        }
      );

      it.each(Object.entries(BATCH_COLUMNS))(
        'batch.%s matches the persistence contract',
        async (column, expected) => {
          const shopId =
            await createFixtureShop('cut-schema-batch');

          const { rows } = await withTenant(
            shopId,
            (trx) =>
              trx.raw(
                `
                  SELECT udt_name, is_nullable
                  FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name = ?
                    AND column_name = ?
                `,
                [BATCHES, column]
              )
          );

          expect(rows).toHaveLength(1);
          expect(expected.udt).toContain(rows[0].udt_name);
          expect(rows[0].is_nullable).toBe(
            expected.nullable ? 'YES' : 'NO'
          );
        }
      );

      it(
        'batch parent is composite cutover_id + shop_id',
        async () => {
          const shopId =
            await createFixtureShop('cut-schema-fk');

          const { rows } = await withTenant(
            shopId,
            (trx) =>
              trx.raw(
                `
                  SELECT pg_get_constraintdef(con.oid) AS definition
                  FROM pg_constraint con
                  JOIN pg_class child
                    ON child.oid = con.conrelid
                  JOIN pg_class parent
                    ON parent.oid = con.confrelid
                  WHERE con.contype = 'f'
                    AND child.relname = ?
                    AND parent.relname = ?
                `,
                [BATCHES, CUTOVERS]
              )
          );

          expect(
            rows.some((row: any) =>
              /FOREIGN KEY \(cutover_id, shop_id\)/i
                .test(row.definition)
            )
          ).toBe(true);
        }
      );
    });

    describe('one cutover per shop', () => {
      it(
        'rejects a second economic cutover for the same shop',
        async () => {
          const shopId =
            await createFixtureShop('cut-one-shop');

          await insertCutover(shopId);

          await expect(
            withTenant(shopId, (trx) =>
              trx(CUTOVERS).insert(cutoverRow(shopId))
            )
          ).rejects.toBeDefined();
        }
      );

      it('allows different shops to own their own cutover', async () => {
        const shopA =
          await createFixtureShop('cut-one-a');
        const shopB =
          await createFixtureShop('cut-one-b');

        await insertCutover(shopA);
        await insertCutover(shopB);

        const a = await withTenant(
          shopA,
          (trx) => trx(CUTOVERS).select('*')
        );

        const b = await withTenant(
          shopB,
          (trx) => trx(CUTOVERS).select('*')
        );

        expect(a).toHaveLength(1);
        expect(b).toHaveLength(1);
      });
    });

    describe('merchant approval contract', () => {
      it.each(['owner', 'admin'])(
        'accepts %s approval',
        async (role) => {
          const shopId =
            await createFixtureShop(`cut-role-${role}`);

          await expect(
            withTenant(shopId, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopId, {
                  approved_by_role: role,
                })
              )
            )
          ).resolves.toBeDefined();
        }
      );

      it('rejects operator approval', async () => {
        const shopId =
          await createFixtureShop('cut-role-operator');

        await expect(
          withTenant(shopId, (trx) =>
            trx(CUTOVERS).insert(
              cutoverRow(shopId, {
                approved_by_role: 'operator',
              })
            )
          )
        ).rejects.toBeDefined();
      });

      it('rejects non-user approval provenance', async () => {
        const shopId =
          await createFixtureShop('cut-role-system');

        await expect(
          withTenant(shopId, (trx) =>
            trx(CUTOVERS).insert(
              cutoverRow(shopId, {
                approved_by_actor_type: 'system',
              })
            )
          )
        ).rejects.toBeDefined();
      });

      it('rejects missing approver identity', async () => {
        const shopId =
          await createFixtureShop('cut-role-no-actor');

        await expect(
          withTenant(shopId, (trx) =>
            trx(CUTOVERS).insert(
              cutoverRow(shopId, {
                approved_by_actor_id: null,
              })
            )
          )
        ).rejects.toBeDefined();
      });
    });

    describe('mismatch acceptance and batching', () => {
      it.each([
        [0, 0],
        [1, 1],
        [250, 1],
        [251, 2],
        [500, 2],
        [501, 3],
      ])(
        'accepts correction count %i with batch count %i',
        async (correctionCount, batchCount) => {
          const shopId =
            await createFixtureShop(
              `cut-count-${correctionCount}`
            );

          await expect(
            withTenant(shopId, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopId, {
                  correction_variant_count:
                    correctionCount,
                  batch_count: batchCount,
                  physical_truth_accepted_at:
                    correctionCount === 0
                      ? null
                      : new Date(),
                })
              )
            )
          ).resolves.toBeDefined();
        }
      );

      it(
        'rejects exact match with unnecessary mismatch acceptance',
        async () => {
          const shopId =
            await createFixtureShop('cut-exact-accept');

          await expect(
            withTenant(shopId, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopId, {
                  correction_variant_count: 0,
                  batch_count: 0,
                  physical_truth_accepted_at: new Date(),
                })
              )
            )
          ).rejects.toBeDefined();
        }
      );

      it(
        'rejects mismatch without physical-truth acceptance',
        async () => {
          const shopId =
            await createFixtureShop('cut-mismatch-noaccept');

          await expect(
            withTenant(shopId, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopId, {
                  correction_variant_count: 1,
                  batch_count: 1,
                  physical_truth_accepted_at: null,
                })
              )
            )
          ).rejects.toBeDefined();
        }
      );

      it('rejects an incorrect batch count', async () => {
        const shopId =
          await createFixtureShop('cut-wrong-batches');

        await expect(
          withTenant(shopId, (trx) =>
            trx(CUTOVERS).insert(
              cutoverRow(shopId, {
                correction_variant_count: 251,
                batch_count: 1,
              })
            )
          )
        ).rejects.toBeDefined();
      });

      it('rejects negative counts', async () => {
        const shopId =
          await createFixtureShop('cut-negative');

        await expect(
          withTenant(shopId, (trx) =>
            trx(CUTOVERS).insert(
              cutoverRow(shopId, {
                correction_variant_count: -1,
                batch_count: 0,
              })
            )
          )
        ).rejects.toBeDefined();
      });
    });

    describe('cutover state consistency', () => {
      it('rejects unknown status', async () => {
        const shopId =
          await createFixtureShop('cut-status-unknown');

        await expect(
          withTenant(shopId, (trx) =>
            trx(CUTOVERS).insert(
              cutoverRow(shopId, {
                status: 'mystery',
              })
            )
          )
        ).rejects.toBeDefined();
      });

      it(
        'requires completed_at exactly when status is complete',
        async () => {
          const shopA =
            await createFixtureShop('cut-complete-a');

          await expect(
            withTenant(shopA, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopA, {
                  status: 'complete',
                  completed_at: null,
                })
              )
            )
          ).rejects.toBeDefined();

          const shopB =
            await createFixtureShop('cut-complete-b');

          await expect(
            withTenant(shopB, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopB, {
                  status: 'prepared',
                  completed_at: new Date(),
                })
              )
            )
          ).rejects.toBeDefined();

          const shopC =
            await createFixtureShop('cut-complete-c');

          await expect(
            withTenant(shopC, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopC, {
                  status: 'complete',
                  completed_at: new Date(),
                })
              )
            )
          ).resolves.toBeDefined();
        }
      );
    });

    describe('batch identity and payload contract', () => {
      it(
        'enforces sequence and idempotency uniqueness',
        async () => {
          const shopId =
            await createFixtureShop('cut-batch-unique');
          const cutoverId =
            await insertCutover(shopId);

          const row = batchRow(shopId, cutoverId);

          await withTenant(shopId, (trx) =>
            trx(BATCHES).insert(row)
          );

          await expect(
            withTenant(shopId, (trx) =>
              trx(BATCHES).insert({
                ...batchRow(shopId, cutoverId),
                idempotency_key:
                  `different-${crypto.randomUUID()}`,
              })
            )
          ).rejects.toBeDefined();

          await expect(
            withTenant(shopId, (trx) =>
              trx(BATCHES).insert({
                ...batchRow(shopId, cutoverId),
                batch_sequence: 2,
                idempotency_key: row.idempotency_key,
              })
            )
          ).rejects.toBeDefined();
        }
      );

      it(
        'rejects invalid sequence and attempt count',
        async () => {
          const shopA =
            await createFixtureShop('cut-batch-seq');
          const cutoverA =
            await insertCutover(shopA);

          await expect(
            withTenant(shopA, (trx) =>
              trx(BATCHES).insert(
                batchRow(shopA, cutoverA, {
                  batch_sequence: 0,
                })
              )
            )
          ).rejects.toBeDefined();

          const shopB =
            await createFixtureShop('cut-batch-attempt');
          const cutoverB =
            await insertCutover(shopB);

          await expect(
            withTenant(shopB, (trx) =>
              trx(BATCHES).insert(
                batchRow(shopB, cutoverB, {
                  attempt_count: -1,
                })
              )
            )
          ).rejects.toBeDefined();
        }
      );

      it(
        'accepts 1..250 changes and rejects 0 or 251',
        async () => {
          for (const count of [1, 250]) {
            const shopId =
              await createFixtureShop(
                `cut-payload-valid-${count}`
              );
            const cutoverId =
              await insertCutover(shopId, {
                correction_variant_count: count,
                batch_count: 1,
              });

            await expect(
              withTenant(shopId, (trx) =>
                trx(BATCHES).insert(
                  batchRow(shopId, cutoverId, {
                    shopify_input:
                      shopifyInput(count),
                    audit_snapshot:
                      auditSnapshot(count),
                  })
                )
              )
            ).resolves.toBeDefined();
          }

          for (const count of [0, 251]) {
            const shopId =
              await createFixtureShop(
                `cut-payload-invalid-${count}`
              );

            const cutoverId =
              await insertCutover(shopId);

            await expect(
              withTenant(shopId, (trx) =>
                trx(BATCHES).insert(
                  batchRow(shopId, cutoverId, {
                    shopify_input:
                      shopifyInput(count),
                    audit_snapshot:
                      auditSnapshot(count),
                  })
                )
              )
            ).rejects.toBeDefined();
          }
        }
      );

      it(
        'requires correction/available Shopify input',
        async () => {
          const shopId =
            await createFixtureShop('cut-payload-shape');
          const cutoverId =
            await insertCutover(shopId);

          await expect(
            withTenant(shopId, (trx) =>
              trx(BATCHES).insert(
                batchRow(shopId, cutoverId, {
                  shopify_input: {
                    ...shopifyInput(1),
                    reason: 'received',
                  },
                })
              )
            )
          ).rejects.toBeDefined();

          await expect(
            withTenant(shopId, (trx) =>
              trx(BATCHES).insert(
                batchRow(shopId, cutoverId, {
                  batch_sequence: 2,
                  idempotency_key:
                    `shape-${crypto.randomUUID()}`,
                  shopify_input: {
                    ...shopifyInput(1),
                    name: 'on_hand',
                  },
                })
              )
            )
          ).rejects.toBeDefined();
        }
      );

      it(
        'requires one audit entry per Shopify change',
        async () => {
          const shopId =
            await createFixtureShop('cut-audit-length');
          const cutoverId =
            await insertCutover(shopId, {
              correction_variant_count: 2,
              batch_count: 1,
            });

          await expect(
            withTenant(shopId, (trx) =>
              trx(BATCHES).insert(
                batchRow(shopId, cutoverId, {
                  shopify_input: shopifyInput(2),
                  audit_snapshot: auditSnapshot(1),
                })
              )
            )
          ).rejects.toBeDefined();
        }
      );

      it(
        'requires completed_at exactly for succeeded batches',
        async () => {
          const shopA =
            await createFixtureShop('cut-batch-done-a');
          const cutoverA =
            await insertCutover(shopA);

          await expect(
            withTenant(shopA, (trx) =>
              trx(BATCHES).insert(
                batchRow(shopA, cutoverA, {
                  status: 'succeeded',
                  completed_at: null,
                })
              )
            )
          ).rejects.toBeDefined();

          const shopB =
            await createFixtureShop('cut-batch-done-b');
          const cutoverB =
            await insertCutover(shopB);

          await expect(
            withTenant(shopB, (trx) =>
              trx(BATCHES).insert(
                batchRow(shopB, cutoverB, {
                  status: 'succeeded',
                  completed_at: new Date(),
                })
              )
            )
          ).resolves.toBeDefined();
        }
      );
    });

    describe('immutability versus execution mutability', () => {
      it(
        'rejects mutation of cutover economic identity',
        async () => {
          const shopId =
            await createFixtureShop('cut-immutable');
          const cutoverId =
            await insertCutover(shopId);

          const changes: Array<Record<string, unknown>> = [
            { cutover_id: crypto.randomUUID() },
            { shop_id: shopId + 1000000 },
            { approved_by_actor_type: 'system' },
            { approved_by_actor_id: 'different-user' },
            { approved_by_role: 'admin' },
            { approved_at: new Date(Date.now() + 1000) },
            {
              physical_truth_accepted_at:
                new Date(Date.now() + 2000),
            },
            { correction_variant_count: 2 },
            { batch_count: 2 },
          ];

          for (const change of changes) {
            await expect(
              withTenant(shopId, (trx) =>
                trx(CUTOVERS)
                  .where({ cutover_id: cutoverId })
                  .update(change)
              )
            ).rejects.toBeDefined();
          }
        }
      );

      it(
        'allows cutover execution state to advance',
        async () => {
          const shopId =
            await createFixtureShop('cut-mutable');
          const cutoverId =
            await insertCutover(shopId);

          await withTenant(shopId, (trx) =>
            trx(CUTOVERS)
              .where({ cutover_id: cutoverId })
              .update({
                status: 'executing',
                last_error: null,
                updated_at: new Date(),
              })
          );

          const completedAt = new Date();

          await withTenant(shopId, (trx) =>
            trx(CUTOVERS)
              .where({ cutover_id: cutoverId })
              .update({
                status: 'complete',
                last_error: null,
                completed_at: completedAt,
                updated_at: completedAt,
              })
          );

          const row = await withTenant(
            shopId,
            (trx) =>
              trx(CUTOVERS)
                .where({ cutover_id: cutoverId })
                .first('status', 'completed_at')
          );

          expect(row?.status).toBe('complete');
          expect(row?.completed_at).toBeTruthy();
        }
      );

      it(
        'rejects mutation of frozen batch identity/payload',
        async () => {
          const shopId =
            await createFixtureShop('batch-immutable');
          const cutoverId =
            await insertCutover(shopId);

          await withTenant(shopId, (trx) =>
            trx(BATCHES).insert(
              batchRow(shopId, cutoverId)
            )
          );

          const changes: Array<Record<string, unknown>> = [
            { cutover_id: crypto.randomUUID() },
            { shop_id: shopId + 1000000 },
            { batch_sequence: 2 },
            {
              idempotency_key:
                `different-${crypto.randomUUID()}`,
            },
            {
              shopify_input:
                JSON.stringify(shopifyInput(2)),
            },
            {
              audit_snapshot:
                JSON.stringify(auditSnapshot(2)),
            },
          ];

          for (const change of changes) {
            await expect(
              withTenant(shopId, (trx) =>
                trx(BATCHES)
                  .where({
                    cutover_id: cutoverId,
                    batch_sequence: 1,
                  })
                  .update(change)
              )
            ).rejects.toBeDefined();
          }
        }
      );

      it(
        'allows batch retry/execution fields to advance',
        async () => {
          const shopId =
            await createFixtureShop('batch-mutable');
          const cutoverId =
            await insertCutover(shopId);

          await withTenant(shopId, (trx) =>
            trx(BATCHES).insert(
              batchRow(shopId, cutoverId)
            )
          );

          await withTenant(shopId, (trx) =>
            trx(BATCHES)
              .where({
                cutover_id: cutoverId,
                batch_sequence: 1,
              })
              .update({
                status: 'in_flight',
                attempt_count: 1,
                last_attempted_at: new Date(),
                updated_at: new Date(),
              })
          );

          await withTenant(shopId, (trx) =>
            trx(BATCHES)
              .where({
                cutover_id: cutoverId,
                batch_sequence: 1,
              })
              .update({
                status: 'failed',
                last_error: 'controlled failure',
                updated_at: new Date(),
              })
          );

          const completedAt = new Date();

          await withTenant(shopId, (trx) =>
            trx(BATCHES)
              .where({
                cutover_id: cutoverId,
                batch_sequence: 1,
              })
              .update({
                status: 'succeeded',
                attempt_count: 2,
                last_attempted_at: completedAt,
                last_error: null,
                shopify_adjustment_group_id:
                  'gid://shopify/InventoryAdjustmentGroup/1',
                completed_at: completedAt,
                updated_at: completedAt,
              })
          );

          const row = await withTenant(
            shopId,
            (trx) =>
              trx(BATCHES)
                .where({
                  cutover_id: cutoverId,
                  batch_sequence: 1,
                })
                .first()
          );

          expect(row?.status).toBe('succeeded');
          expect(row?.attempt_count).toBe(2);
          expect(row?.completed_at).toBeTruthy();
        }
      );
    });

    describe('durable evidence deletion protection', () => {
      it('rejects cutover DELETE', async () => {
        const shopId =
          await createFixtureShop('cut-delete');
        const cutoverId =
          await insertCutover(shopId);

        await expect(
          withTenant(shopId, (trx) =>
            trx(CUTOVERS)
              .where({ cutover_id: cutoverId })
              .del()
          )
        ).rejects.toThrow(
          /OPENING_INVENTORY_CUTOVER_DELETE_BLOCKED/
        );

        const rows = await withTenant(
          shopId,
          (trx) =>
            trx(CUTOVERS)
              .where({ cutover_id: cutoverId })
              .select('*')
        );

        expect(rows).toHaveLength(1);
      });

      it('rejects batch DELETE', async () => {
        const shopId =
          await createFixtureShop('batch-delete');
        const cutoverId =
          await insertCutover(shopId);

        await withTenant(shopId, (trx) =>
          trx(BATCHES).insert(
            batchRow(shopId, cutoverId)
          )
        );

        await expect(
          withTenant(shopId, (trx) =>
            trx(BATCHES)
              .where({ cutover_id: cutoverId })
              .del()
          )
        ).rejects.toThrow(
          /OPENING_INVENTORY_CUTOVER_DELETE_BLOCKED/
        );
      });
    });

    describe('tenant isolation', () => {
      it.each([CUTOVERS, BATCHES])(
        '%s has ENABLE + FORCE RLS',
        async (table) => {
          const shopId =
            await createFixtureShop(`cut-rls-${table}`);

          const { rows } = await withTenant(
            shopId,
            (trx) =>
              trx.raw(
                `
                  SELECT relrowsecurity, relforcerowsecurity
                  FROM pg_class
                  WHERE relname = ?
                `,
                [table]
              )
          );

          expect(rows).toHaveLength(1);
          expect(rows[0].relrowsecurity).toBe(true);
          expect(rows[0].relforcerowsecurity).toBe(true);
        }
      );

      it(
        'cross-tenant reads cannot see cutover or batch rows',
        async () => {
          const shopA =
            await createFixtureShop('cut-rls-a');
          const shopB =
            await createFixtureShop('cut-rls-b');

          const cutoverId =
            await insertCutover(shopA);

          await withTenant(shopA, (trx) =>
            trx(BATCHES).insert(
              batchRow(shopA, cutoverId)
            )
          );

          const cutoversVisibleToB =
            await withTenant(
              shopB,
              (trx) => trx(CUTOVERS).select('*')
            );

          const batchesVisibleToB =
            await withTenant(
              shopB,
              (trx) => trx(BATCHES).select('*')
            );

          expect(cutoversVisibleToB).toHaveLength(0);
          expect(batchesVisibleToB).toHaveLength(0);
        }
      );

      it(
        'cross-tenant writes are rejected by RLS',
        async () => {
          const shopA =
            await createFixtureShop('cut-rls-write-a');
          const shopB =
            await createFixtureShop('cut-rls-write-b');

          await expect(
            withTenant(shopB, (trx) =>
              trx(CUTOVERS).insert(
                cutoverRow(shopA)
              )
            )
          ).rejects.toThrow(/row-level security/i);
        }
      );

      it(
        'no tenant context sees no cutover rows',
        async () => {
          const shopId =
            await createFixtureShop('cut-rls-none');

          await insertCutover(shopId);

          const rows = await systemTransaction(
            (trx) => trx(CUTOVERS).select('*')
          );

          expect(rows).toHaveLength(0);
        }
      );
    });

    describe(
      'opening_inventory_shopify_synced_at authority',
      () => {
        it(
          'starts NULL and can be populated explicitly',
          async () => {
            const shopId =
              await createFixtureShop('cut-synced-at');

            const before = await withTenant(
              shopId,
              (trx) =>
                trx('shop_wms_settings')
                  .where({ shop_id: shopId })
                  .first(
                    'opening_inventory_shopify_synced_at'
                  )
            );

            expect(
              before?.opening_inventory_shopify_synced_at
            ).toBeNull();

            const syncedAt = new Date();

            await withTenant(shopId, (trx) =>
              trx('shop_wms_settings')
                .where({ shop_id: shopId })
                .update({
                  opening_inventory_shopify_synced_at:
                    syncedAt,
                })
            );

            const after = await withTenant(
              shopId,
              (trx) =>
                trx('shop_wms_settings')
                  .where({ shop_id: shopId })
                  .first(
                    'opening_inventory_shopify_synced_at'
                  )
            );

            expect(
              after?.opening_inventory_shopify_synced_at
            ).toBeTruthy();
          }
        );
      }
    );

    describe('down migration fail-closed contract', () => {
      it.each(['prepared', 'executing', 'failed'])(
        'blocks rollback while a %s cutover exists',
        async (status) => {
          const shopId =
            await createFixtureShop(`cut-down-${status}`);

          await insertCutover(shopId, { status });

          await expect(
            withTenant(shopId, (trx) =>
              down0199(trx)
            )
          ).rejects.toThrow(
            /MIGRATION_0199_DOWN_BLOCKED/
          );
        }
      );

      it(
        'blocks rollback after Shopify sync confirmation even without a cutover row',
        async () => {
          const shopId =
            await createFixtureShop('cut-down-synced');

          await withTenant(shopId, (trx) =>
            trx('shop_wms_settings')
              .where({ shop_id: shopId })
              .update({
                opening_inventory_shopify_synced_at:
                  new Date(),
              })
          );

          await expect(
            withTenant(shopId, (trx) =>
              down0199(trx)
            )
          ).rejects.toThrow(
            /MIGRATION_0199_DOWN_BLOCKED/
          );
        }
      );
    });
  }
);
