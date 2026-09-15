/**
 * COMMERCIAL-DEAD-SURFACE-01D-5 — historical persisted-entitlement repair.
 *
 * Production audit proved historical rows can remain temporally open even
 * though canonical commercial policy already makes them non-effective.
 *
 * The repair is deliberately temporal and non-destructive:
 * - close only currently-started, still-open dead/paused grants;
 * - preserve already-closed history;
 * - preserve future-not-started rows;
 * - preserve unrelated live grants;
 * - reruns are idempotent;
 * - down() must never resurrect historical access.
 *
 * This test locates the future repair by stable marker rather than migration
 * number because unrelated migrations may land before this slice is committed.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import knexFactory, { Knex } from 'knex';

const REPO = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO, 'apps/backend/migrations');
const COMPILED_MIGRATIONS_DIR = path.join(REPO, 'apps/backend/dist/migrations');
const ISSUE_MARKER = 'COMMERCIAL-DEAD-SURFACE-01D-5';

const EXPECTED_MODULES = [
  'echo-hub',
  'customers',
  'specter',
  'specter_sdk_free',
  'finances',
  'cashflow',
] as const;

const EXPECTED_FLAGS = [
  'finances.core',
  'finances.cashflow',
  'cashflow.revenue_buckets',
  'customers.ltv',
  'customers.segmentation',
  'specter.full_capture',
] as const;

interface RepairMigration {
  NON_EFFECTIVE_MODULES: readonly string[];
  NON_ACTIVE_FLAGS: readonly string[];
  closeHistoricalNonEffectiveEntitlements(
    knex: Knex | Knex.Transaction,
    closedAt: Date,
  ): Promise<number>;
  down(knex?: Knex | Knex.Transaction): Promise<void>;
}

function findRepairMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) =>
      fs
        .readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
        .includes(ISSUE_MARKER),
    )
    .sort();
}

function loadRepairMigration(files: string[]): RepairMigration {
  if (files.length !== 1) {
    throw new Error(
      `${ISSUE_MARKER}: expected exactly ONE forward repair migration ` +
        `carrying marker "${ISSUE_MARKER}", found ${files.length} ` +
        `(${files.join(', ') || 'none'}). The repair migration has not been written yet.`,
    );
  }

  const compiled = files[0].replace(/\.ts$/, '.js');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(COMPILED_MIGRATIONS_DIR, compiled)) as RepairMigration;
}

function assertDisposableTestDb(): string {
  const database = process.env.PGDATABASE ?? '';

  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(
      `${ISSUE_MARKER} refuses non-disposable DB: ${database || '<unset>'}`,
    );
  }

  return database;
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

async function seedShop(db: Knex): Promise<number> {
  const [shop] = await db('shops')
    .insert({
      name: `01D5 historical entitlement ${crypto.randomUUID()}`,
    })
    .returning('id');

  return Number(shop.id);
}

async function seedEntitlement(
  db: Knex,
  input: {
    shopId: number;
    moduleKey: string;
    flagKey?: string | null;
    source?: string;
    validFrom: Date;
    validUntil?: Date | null;
  },
): Promise<number> {
  const [row] = await db('shop_module_entitlements')
    .insert({
      shop_id: input.shopId,
      module_key: input.moduleKey,
      flag_key: input.flagKey ?? null,
      source: input.source ?? 'trial:growth',
      valid_from: input.validFrom,
      valid_until: input.validUntil ?? null,
    })
    .returning('id');

  return Number(row.id);
}

describe('COMMERCIAL-DEAD-SURFACE-01D-5 historical entitlement repair', () => {
  let migrationDb: Knex;

  beforeAll(async () => {
    migrationDb = await createMigrationDb();
  });

  afterAll(async () => {
    if (migrationDb) await migrationDb.destroy();
  });

  it('closes only started/open non-effective historical grants and never resurrects them', async () => {
    const repairFiles = findRepairMigrations();

    // REQUIRED RED until the repair migration exists.
    expect(repairFiles).toHaveLength(1);

    const migration = loadRepairMigration(repairFiles);

    expect([...migration.NON_EFFECTIVE_MODULES]).toEqual(EXPECTED_MODULES);
    expect([...migration.NON_ACTIVE_FLAGS]).toEqual(EXPECTED_FLAGS);

    const shopId = await seedShop(migrationDb);

    const closedAt = new Date('2026-09-15T12:00:00.000Z');
    const past = new Date('2026-09-01T00:00:00.000Z');
    const alreadyClosedAt = new Date('2026-09-05T00:00:00.000Z');
    const future = new Date('2026-10-01T00:00:00.000Z');

    const specter = await seedEntitlement(migrationDb, {
      shopId,
      moduleKey: 'specter',
      validFrom: past,
    });

    const customerFlag = await seedEntitlement(migrationDb, {
      shopId,
      moduleKey: 'customers',
      flagKey: 'customers.segmentation',
      validFrom: past,
    });

    const cashflow = await seedEntitlement(migrationDb, {
      shopId,
      moduleKey: 'cashflow',
      validFrom: past,
    });

    const alreadyClosed = await seedEntitlement(migrationDb, {
      shopId,
      moduleKey: 'finances',
      validFrom: past,
      validUntil: alreadyClosedAt,
    });

    const futureTarget = await seedEntitlement(migrationDb, {
      shopId,
      moduleKey: 'specter_sdk_free',
      validFrom: future,
    });

    const unrelatedLive = await seedEntitlement(migrationDb, {
      shopId,
      moduleKey: 'shopify_integration',
      validFrom: past,
    });

    const fixtureIds = [
      specter,
      customerFlag,
      cashflow,
      alreadyClosed,
      futureTarget,
      unrelatedLive,
    ];

    const repairedCount =
      await migration.closeHistoricalNonEffectiveEntitlements(
        migrationDb,
        closedAt,
      );

    expect(repairedCount).toBeGreaterThanOrEqual(3);

    const after = await migrationDb('shop_module_entitlements')
      .whereIn('id', fixtureIds)
      .select('id', 'valid_from', 'valid_until');

    const byId = new Map(after.map((row) => [Number(row.id), row]));

    for (const id of [specter, customerFlag, cashflow]) {
      expect(
        new Date(byId.get(id)!.valid_until).toISOString(),
      ).toBe(closedAt.toISOString());
    }

    expect(
      new Date(byId.get(alreadyClosed)!.valid_until).toISOString(),
    ).toBe(alreadyClosedAt.toISOString());

    expect(byId.get(futureTarget)!.valid_until).toBeNull();
    expect(byId.get(unrelatedLive)!.valid_until).toBeNull();

    const secondCount =
      await migration.closeHistoricalNonEffectiveEntitlements(
        migrationDb,
        closedAt,
      );

    expect(secondCount).toBe(0);

    await migration.down(migrationDb);

    const afterDown = await migrationDb('shop_module_entitlements')
      .whereIn('id', [specter, customerFlag, cashflow])
      .select('id', 'valid_until');

    for (const row of afterDown) {
      expect(new Date(row.valid_until).toISOString())
        .toBe(closedAt.toISOString());
    }
  });
});
