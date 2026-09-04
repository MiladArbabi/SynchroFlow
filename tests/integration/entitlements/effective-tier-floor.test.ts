// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2A
// =======================================
// RED DB-invariant contracts for the EFFECTIVE entitlement resolver:
//
//   effective modules = modulesForTier(currentTier) ∪ temporally-valid persisted module rows
//   effective flags   = flagsForTier(currentTier)   ∪ temporally-valid persisted flag rows
//
// Real disposable PostgreSQL (backend-integration harness). Isolated fixture
// shops via createTenantShop (the SECURITY-DEFINER bootstrap real code uses).
// Calls EntitlementsService.getForUser directly — no createApp, no routes.
//
// RED today because getForUser is ROWS-ONLY (returns { modules:[], flags:[] }
// when there are no rows) and never derives a tier floor.

import crypto from 'crypto';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { EntitlementsService } from '../../../packages/backend-core/src/services/entitlements.service';
import { EntitlementRevocationService } from '../../../apps/backend/src/services/entitlement-revocation.service';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';

type Tier = 'starter' | 'core' | 'growth' | 'scale';

async function createFixtureShop(
  namePrefix: string,
  tier: Tier,
): Promise<{ shopId: number; userId: number }> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${namePrefix}+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return row.id as number;
  });
  await withTenant(shopId, (trx) =>
    trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' }),
  );
  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({ shop_id: shopId, tier }),
  );
  return { shopId, userId };
}

async function insertRow(
  shopId: number,
  row: { module_key?: string | null; flag_key?: string | null; valid_from?: Date; valid_until?: Date | null },
) {
  await withTenant(shopId, (trx) =>
    trx('shop_module_entitlements').insert({
      shop_id: shopId,
      module_key: row.module_key ?? null,
      flag_key: row.flag_key ?? null,
      source: 'test',
      valid_from: row.valid_from ?? new Date(Date.now() - 60_000),
      valid_until: row.valid_until ?? null,
    }),
  );
}

async function setTier(shopId: number, tier: Tier) {
  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').where({ shop_id: shopId }).update({ tier }),
  );
}

afterAll(async () => {
  await db.destroy();
});

// ===========================================================================
// A2A-C1 — EFFECTIVE MODULE FLOOR
// ===========================================================================
describe('A2A-C1 — effective module floor from tier', () => {
  it('EXPECTED RED: Growth shop with ZERO entitlement rows still exposes every modulesForTier(growth)', async () => {
    const { shopId, userId } = await createFixtureShop('a2a-c1', 'growth');
    const snap = await EntitlementsService.getForUser(userId);
    expect(snap).not.toBeNull();
    const modules = new Set(snap!.modules);
    for (const m of modulesForTier('growth')) {
      expect({ module: m, present: modules.has(m) }).toEqual({ module: m, present: true });
    }
    void shopId;
  });
});

// ===========================================================================
// A2A-C2 — EFFECTIVE FLAG FLOOR
// ===========================================================================
describe('A2A-C2 — effective flag floor from tier', () => {
  it('EXPECTED RED: Growth shop with ZERO entitlement rows still exposes every flagsForTier(growth)', async () => {
    const { userId } = await createFixtureShop('a2a-c2', 'growth');
    const snap = await EntitlementsService.getForUser(userId);
    const flags = new Set(snap!.flags);
    for (const f of flagsForTier('growth')) {
      expect({ flag: f, present: flags.has(f) }).toEqual({ flag: f, present: true });
    }
  });
});

// ===========================================================================
// A2A-C3 — VALID (legacy/additive) ROWS ARE ADDITIVE
// ===========================================================================
describe('A2A-C3 — persisted rows are additive over the tier floor', () => {
  it('EXPECTED RED: Growth + a valid `echo-hub` row => Growth modules ∪ {echo-hub}', async () => {
    const { shopId, userId } = await createFixtureShop('a2a-c3', 'growth');
    await insertRow(shopId, { module_key: 'echo-hub' }); // grant-only, in no tier
    const snap = await EntitlementsService.getForUser(userId);
    const modules = new Set(snap!.modules);
    expect(modules.has('echo-hub')).toBe(true);
    for (const m of modulesForTier('growth')) {
      expect({ module: m, present: modules.has(m) }).toEqual({ module: m, present: true });
    }
  });
});

// ===========================================================================
// A2A-C4 — EXPIRED ROWS EXCLUDED (floor still present)
// ===========================================================================
describe('A2A-C4 — expired rows do not appear; tier floor still does', () => {
  it('EXPECTED RED: a row with valid_until in the past is excluded, Growth floor remains', async () => {
    const { shopId, userId } = await createFixtureShop('a2a-c4', 'growth');
    await insertRow(shopId, {
      module_key: 'expired-extra',
      valid_from: new Date(Date.now() - 120_000),
      valid_until: new Date(Date.now() - 60_000),
    });
    const snap = await EntitlementsService.getForUser(userId);
    const modules = new Set(snap!.modules);
    expect(modules.has('expired-extra')).toBe(false);
    for (const m of modulesForTier('growth')) {
      expect({ module: m, present: modules.has(m) }).toEqual({ module: m, present: true });
    }
  });
});

// ===========================================================================
// A2A-C5 — DOWNGRADE BOUNDING (real revocation path)
// ===========================================================================
describe('A2A-C5 — downgrade bounds the effective set to the new tier', () => {
  it('EXPECTED RED: Growth→Core + revoke Growth-only `demand` => modulesForTier(core) ∪ remaining, no `demand`', async () => {
    const { shopId, userId } = await createFixtureShop('a2a-c5', 'growth');
    // Seed a Growth-only module row and a Core module row.
    await insertRow(shopId, { module_key: 'demand' });     // Growth-only
    await insertRow(shopId, { module_key: 'products' });   // Core

    // Real downgrade path: revoke Growth-only, then lower the tier.
    await EntitlementRevocationService.revokeEntitlements({
      shopId,
      scope: { modules: ['demand'] },
      reason: 'test_downgrade:growth->core',
    });
    await setTier(shopId, 'core');

    const snap = await EntitlementsService.getForUser(userId);
    const modules = new Set(snap!.modules);
    expect(modules.has('demand')).toBe(false);            // revoked + not in core floor
    expect(modules.has('products')).toBe(true);           // still a valid additive row
    for (const m of modulesForTier('core')) {
      expect({ module: m, present: modules.has(m) }).toEqual({ module: m, present: true });
    }
    for (const m of modulesForTier('growth')) {
      if (!modulesForTier('core').has(m)) {
        expect({ growthOnly: m, leaked: modules.has(m) }).toEqual({ growthOnly: m, leaked: false });
      }
    }
  });
});
