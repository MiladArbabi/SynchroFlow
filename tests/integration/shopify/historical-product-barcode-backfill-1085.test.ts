/**
 * GH-1085 / BARCODE-LIFECYCLE-01 — historical LSP repair.
 *
 * Classic RED-first is impractical for this one-time deployment repair: the
 * failing state is historical production data, while the disposable integration
 * database runs all current migrations before test execution. This test creates
 * the exact historical before-state directly, then calls the exported
 * migration-local helper and verifies the repaired after-state.
 */
import crypto from 'crypto';
import knexFactory, { Knex } from 'knex';
import {
  backfillMissingProductBarcodeIdentity,
} from '../../../apps/backend/migrations/20260911120000_0170_backfill_missing_product_barcode_identity';

const LSP_PATTERN = /^LSP-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

function assertDisposableTestDb(): string {
  const pgdb = process.env.PGDATABASE;
  if (!pgdb || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(pgdb)) {
    throw new Error(`Refusing historical LSP backfill test on non-disposable DB: ${pgdb ?? '<unset>'}`);
  }
  return pgdb;
}

async function createMigrationDb(): Promise<Knex> {
  return knexFactory({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGMIGRATION_USER,
      password: process.env.PGMIGRATION_PASSWORD,
      database: assertDisposableTestDb(),
    },
    pool: { min: 0, max: 4 },
  });
}

async function seedShop(knex: Knex, label: string): Promise<number> {
  const [shop] = await knex('shops')
    .insert({ name: `GH1085 historical LSP ${label}` })
    .returning('id');
  return shop.id as number;
}

async function seedVariant(
  knex: Knex,
  shopId: number,
  opts: {
    label: string;
    barcode: string | null;
    lasyncroBarcode: string | null;
  }
): Promise<string> {
  const lasyncroProductId = crypto.randomUUID();
  const lasyncroVariantId = crypto.randomUUID();

  await knex('products').insert({
    lasyncro_product_id: lasyncroProductId,
    shop_id: shopId,
    sku: `GH1085-HIST-${opts.label}`,
    title: `GH1085 historical product ${opts.label}`,
    status: 'active',
    product_type: 'physical',
  });

  await knex('variants').insert({
    lasyncro_variant_id: lasyncroVariantId,
    lasyncro_product_id: lasyncroProductId,
    shop_id: shopId,
    sku: `GH1085-HIST-${opts.label}`,
    title: `GH1085 historical variant ${opts.label}`,
    unit_cost: '3.50',
    status: 'active',
    barcode: opts.barcode,
    lasyncro_barcode: opts.lasyncroBarcode,
  });

  return lasyncroVariantId;
}

describe('GH-1085 historical product barcode backfill', () => {
  let migrationDb: Knex;

  beforeAll(async () => {
    migrationDb = await createMigrationDb();
  });

  afterAll(async () => {
    if (migrationDb) await migrationDb.destroy();
  });

  it('H1-H6 — repairs historical null LSPs globally without overwriting existing identities or merchant barcodes', async () => {
    const shopA = await seedShop(migrationDb, 'shop-a');
    const shopB = await seedShop(migrationDb, 'shop-b');
    const existingLsp = 'LSP-ABCDEFGH';
    const merchantBarcode = '5012345678900';

    const nullA1 = await seedVariant(migrationDb, shopA, {
      label: `a-null-1-${crypto.randomBytes(3).toString('hex')}`,
      barcode: null,
      lasyncroBarcode: null,
    });
    const nullA2 = await seedVariant(migrationDb, shopA, {
      label: `a-null-2-${crypto.randomBytes(3).toString('hex')}`,
      barcode: merchantBarcode,
      lasyncroBarcode: null,
    });
    const immutable = await seedVariant(migrationDb, shopA, {
      label: `a-existing-${crypto.randomBytes(3).toString('hex')}`,
      barcode: null,
      lasyncroBarcode: existingLsp,
    });
    const nullB1 = await seedVariant(migrationDb, shopB, {
      label: `b-null-1-${crypto.randomBytes(3).toString('hex')}`,
      barcode: null,
      lasyncroBarcode: null,
    });

    const fixtureVariantIds = [nullA1, nullA2, immutable, nullB1];
    const before = await migrationDb('variants')
      .whereIn('lasyncro_variant_id', fixtureVariantIds)
      .orderBy('lasyncro_variant_id')
      .select('lasyncro_variant_id', 'shop_id', 'barcode', 'lasyncro_barcode');

    expect(before.find((row) => row.lasyncro_variant_id === immutable)!.lasyncro_barcode)
      .toBe(existingLsp);
    expect(before.find((row) => row.lasyncro_variant_id === nullA2)!.barcode)
      .toBe(merchantBarcode);

    const repairedCount = await backfillMissingProductBarcodeIdentity(migrationDb);

    // The migration helper is intentionally global across every shop. Other
    // integration suites share this disposable DB and may concurrently create
    // additional historical-style NULL LSP rows, so the global repaired count
    // is not fixture-exclusive. Our three NULL fixture rows must all be among
    // the repaired population; their exact post-state is asserted below.
    expect(repairedCount).toBeGreaterThanOrEqual(3);

    const after = await migrationDb('variants')
      .whereIn('lasyncro_variant_id', fixtureVariantIds)
      .orderBy('lasyncro_variant_id')
      .select('lasyncro_variant_id', 'shop_id', 'barcode', 'lasyncro_barcode');

    const byId = new Map(after.map((row) => [row.lasyncro_variant_id, row]));

    for (const variantId of [nullA1, nullA2, nullB1]) {
      expect(byId.get(variantId)!.lasyncro_barcode).toMatch(LSP_PATTERN);
    }

    expect(byId.get(immutable)!.lasyncro_barcode).toBe(existingLsp);
    expect(byId.get(nullA2)!.barcode).toBe(merchantBarcode);
    expect(byId.get(nullA2)!.lasyncro_barcode).not.toBe(merchantBarcode);

    expect(new Set(after.map((row) => row.lasyncro_barcode)).size)
      .toBe(after.length);
    expect(new Set([
      byId.get(nullA1)!.shop_id,
      byId.get(nullB1)!.shop_id,
    ])).toEqual(new Set([shopA, shopB]));

    const lspSnapshot = new Map(
      after.map((row) => [row.lasyncro_variant_id, row.lasyncro_barcode])
    );

    // Re-running the global repair must never change identities already
    // established for this fixture. Do not assert the global repaired count:
    // sibling integration suites may create new NULL LSP rows concurrently.
    await backfillMissingProductBarcodeIdentity(migrationDb);

    const afterSecondRun = await migrationDb('variants')
      .whereIn('lasyncro_variant_id', fixtureVariantIds)
      .select('lasyncro_variant_id', 'barcode', 'lasyncro_barcode');

    for (const row of afterSecondRun) {
      expect(row.lasyncro_barcode).toBe(lspSnapshot.get(row.lasyncro_variant_id));
    }
    expect(afterSecondRun.find((row) => row.lasyncro_variant_id === nullA2)!.barcode)
      .toBe(merchantBarcode);
  });
});
