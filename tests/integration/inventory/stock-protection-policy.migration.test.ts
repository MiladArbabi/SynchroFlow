// tests/integration/inventory/stock-protection-policy.migration.test.ts
//
// STOCK-PROTECT-01 — schema/DB-invariant contract for the durable Stock
// Protection Policy persistence surface. PERMANENT regression contract,
// authored RED.
// ===========================================================================
// INDEPENDENTLY RED
//   This suite depends only on SCHEMA/catalog introspection and raw table
//   behaviour, never on a service module. It is RED because neither
//   stock_protection_policies nor stock_protection_policy_transitions exist
//   yet (surface A — persistence/migration missing).
//
// PLACEMENT
//   Lives under tests/integration/ (backend-integration project) — the only
//   Jest project wired to the disposable-PostgreSQL harness
//   scripts/with-test-db.js. Mirrors
//   tests/integration/billing/shop-subscription-transition-ledger.migration.test.ts.
//
// WHAT IS ASSERTED
//   Structure that is contractual (columns, nullability, types, FK, grain
//   uniqueness, forced RLS, append-only guarantee) and behaviour that is
//   contractual (INSERT permitted / UPDATE+DELETE rejected on the transition
//   ledger; cross-tenant rows invisible under RLS). Column ORDER, constraint
//   NAMES, and index NAMES are deliberately not frozen.
//
// COVERS: SP-POL-01, SP-POL-08 (structural), SP-POL-10, SP-POL-11, SP-POL-16 (structural)

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const CURRENT_TABLE = 'stock_protection_policies';
const TRANSITIONS_TABLE = 'stock_protection_policy_transitions';

/** column -> { nullable, udt } — udt_name is the concrete PostgreSQL type. */
const CURRENT_TABLE_COLUMNS: Record<string, { nullable: boolean; udt: string[] }> = {
  id:                      { nullable: false, udt: ['int4', 'int8', 'uuid'] },
  shop_id:                 { nullable: false, udt: ['int4', 'int8'] },
  lasyncro_variant_id:     { nullable: false, udt: ['uuid'] },
  version:                 { nullable: false, udt: ['int4', 'int8'] },
  safety_days:             { nullable: false, udt: ['int4', 'int8'] },
  review_cycle_days:       { nullable: false, udt: ['int4', 'int8'] },
  planning_supplier_id:    { nullable: true,  udt: ['int4', 'int8'] },
  source:                  { nullable: false, udt: ['varchar', 'text'] },
  approved_by_actor_type:  { nullable: false, udt: ['varchar', 'text'] },
  approved_by_actor_id:    { nullable: true,  udt: ['varchar', 'text'] },
  approved_at:             { nullable: false, udt: ['timestamptz'] },
  created_at:              { nullable: false, udt: ['timestamptz'] },
  updated_at:              { nullable: false, udt: ['timestamptz'] },
};

const TRANSITIONS_TABLE_COLUMNS: Record<string, { nullable: boolean; udt: string[] }> = {
  id:                        { nullable: false, udt: ['int4', 'int8', 'uuid'] },
  shop_id:                   { nullable: false, udt: ['int4', 'int8'] },
  lasyncro_variant_id:       { nullable: false, udt: ['uuid'] },
  from_version:              { nullable: true,  udt: ['int4', 'int8'] },
  to_version:                { nullable: false, udt: ['int4', 'int8'] },
  from_safety_days:          { nullable: true,  udt: ['int4', 'int8'] },
  to_safety_days:            { nullable: false, udt: ['int4', 'int8'] },
  from_review_cycle_days:    { nullable: true,  udt: ['int4', 'int8'] },
  to_review_cycle_days:      { nullable: false, udt: ['int4', 'int8'] },
  from_planning_supplier_id: { nullable: true,  udt: ['int4', 'int8'] },
  to_planning_supplier_id:   { nullable: true,  udt: ['int4', 'int8'] },
  source:                    { nullable: false, udt: ['varchar', 'text'] },
  reason:                    { nullable: false, udt: ['varchar', 'text'] },
  actor_type:                { nullable: false, udt: ['varchar', 'text'] },
  actor_id:                  { nullable: true,  udt: ['varchar', 'text'] },
  recommendation_snapshot:   { nullable: true,  udt: ['jsonb'] },
  occurred_at:               { nullable: false, udt: ['timestamptz'] },
  created_at:                { nullable: false, udt: ['timestamptz'] },
};

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedVariant(shopId: number): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'SP-POL migration fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SP-POL-MIG-${variantId.slice(0, 8)}`,
      title: 'SP-POL migration fixture variant',
      unit_cost: '5.00',
      status: 'active',
    });
  });
  return variantId;
}

function currentPolicyRow(shopId: number, variantId: string, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    shop_id: shopId,
    lasyncro_variant_id: variantId,
    version: 1,
    safety_days: 5,
    review_cycle_days: 7,
    planning_supplier_id: null,
    source: 'merchant_approved',
    approved_by_actor_type: 'user',
    approved_by_actor_id: 'test-actor',
    approved_at: now,
    ...overrides,
  };
}

/**
 * Mechanical fixture prerequisite (COMMAND CORRECTIONS / Mechanical fixture
 * corrections): stock_protection_policy_transitions.policy_id is a required
 * NOT NULL FK to stock_protection_policies, per the ratified IMPLEMENTATION
 * brief (not part of the original RED contract). A transition row always
 * refers to a real current-policy row in production, so this seeds one and
 * returns its id — a prerequisite for the SAME authorised append-only
 * fixture, not a change to append-only semantics.
 */
async function seedPolicyId(shopId: number, variantId: string): Promise<number> {
  const [row] = await withTenant(shopId, (trx) =>
    trx(CURRENT_TABLE).insert(currentPolicyRow(shopId, variantId)).returning('id')
  );
  return Number((row as any).id ?? row);
}

function transitionRow(shopId: number, variantId: string, policyId: number, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    shop_id: shopId,
    policy_id: policyId,
    lasyncro_variant_id: variantId,
    from_version: null,
    to_version: 1,
    from_safety_days: null,
    to_safety_days: 5,
    from_review_cycle_days: null,
    to_review_cycle_days: 7,
    from_planning_supplier_id: null,
    to_planning_supplier_id: null,
    source: 'ui_approval',
    reason: 'initial_policy_approval',
    actor_type: 'user',
    actor_id: 'test-actor',
    recommendation_snapshot: null,
    occurred_at: now,
    ...overrides,
  };
}

describe('STOCK-PROTECT-01 — stock_protection_policies / stock_protection_policy_transitions schema', () => {
  // ── SP-POL-01 ─────────────────────────────────────────────────────────────
  describe('SP-POL-01: exactly one current policy row per shop + variant', () => {
    it('public.stock_protection_policies is present', async () => {
      const shopId = await createFixtureShop('sppol01a');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ?`,
          [CURRENT_TABLE]
        )
      );
      expect(rows).toHaveLength(1);
    });

    it('(shop_id, lasyncro_variant_id) is uniquely constrained', async () => {
      const shopId = await createFixtureShop('sppol01b');
      const variantId = await seedVariant(shopId);

      await withTenant(shopId, (trx) => trx(CURRENT_TABLE).insert(currentPolicyRow(shopId, variantId)));

      await expect(
        withTenant(shopId, (trx) =>
          trx(CURRENT_TABLE).insert(currentPolicyRow(shopId, variantId, { version: 2 }))
        )
      ).rejects.toBeDefined();
    });
  });

  // ── SP-POL-01 (columns) / SP-POL-16 (structural) ────────────────────────
  describe('SP-POL-01/16: current-policy authority columns match the contracted type and nullability', () => {
    it.each(Object.entries(CURRENT_TABLE_COLUMNS))(
      '%s matches the authority contract',
      async (column, expected) => {
        const shopId = await createFixtureShop('sppol01c');
        const { rows } = await withTenant(shopId, (trx) =>
          trx.raw(
            `SELECT udt_name, is_nullable FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
            [CURRENT_TABLE, column]
          )
        );
        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        expect(rows[0].is_nullable).toBe(expected.nullable ? 'YES' : 'NO');
      }
    );

    it('lasyncro_variant_id carries a foreign key to variants', async () => {
      const shopId = await createFixtureShop('sppol01d');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT con.conname
             FROM pg_constraint con
             JOIN pg_class child  ON child.oid  = con.conrelid
             JOIN pg_class parent ON parent.oid = con.confrelid
            WHERE con.contype = 'f'
              AND child.relname = ?
              AND parent.relname = 'variants'`,
          [CURRENT_TABLE]
        )
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── SP-POL-08 (structural) ───────────────────────────────────────────────
  describe('SP-POL-08: transition ledger carries complete before/after state and mandatory provenance', () => {
    it('public.stock_protection_policy_transitions is present', async () => {
      const shopId = await createFixtureShop('sppol08a');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ?`,
          [TRANSITIONS_TABLE]
        )
      );
      expect(rows).toHaveLength(1);
    });

    it.each(Object.entries(TRANSITIONS_TABLE_COLUMNS))(
      '%s matches the provenance contract',
      async (column, expected) => {
        const shopId = await createFixtureShop('sppol08b');
        const { rows } = await withTenant(shopId, (trx) =>
          trx.raw(
            `SELECT udt_name, is_nullable FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
            [TRANSITIONS_TABLE, column]
          )
        );
        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        expect(rows[0].is_nullable).toBe(expected.nullable ? 'YES' : 'NO');
      }
    );

    it('an index leads with shop_id so per-variant history reads are not a sequential scan', async () => {
      const shopId = await createFixtureShop('sppol08c');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ?`, [
          TRANSITIONS_TABLE,
        ])
      );
      const leadsWithShopId = rows.some((r: any) => /\(\s*shop_id\b/.test(r.indexdef));
      expect(leadsWithShopId).toBe(true);
    });
  });

  // ── SP-POL-10 ─────────────────────────────────────────────────────────────
  describe('SP-POL-10: the transition ledger is append-only', () => {
    it('INSERT is permitted', async () => {
      const shopId = await createFixtureShop('sppol10a');
      const variantId = await seedVariant(shopId);
      const policyId = await seedPolicyId(shopId, variantId);
      await withTenant(shopId, (trx) => trx(TRANSITIONS_TABLE).insert(transitionRow(shopId, variantId, policyId)));

      const [{ count }] = await withTenant(shopId, (trx) =>
        trx(TRANSITIONS_TABLE).where({ shop_id: shopId }).count<{ count: string }[]>('* as count')
      );
      expect(Number(count)).toBe(1);
    });

    it('UPDATE of an existing transition row is rejected', async () => {
      const shopId = await createFixtureShop('sppol10b');
      const variantId = await seedVariant(shopId);
      const policyId = await seedPolicyId(shopId, variantId);
      await withTenant(shopId, (trx) => trx(TRANSITIONS_TABLE).insert(transitionRow(shopId, variantId, policyId)));

      await expect(
        withTenant(shopId, (trx) =>
          trx(TRANSITIONS_TABLE).where({ shop_id: shopId }).update({ reason: 'rewritten_history' })
        )
      ).rejects.toBeDefined();

      const row = await withTenant(shopId, (trx) =>
        trx(TRANSITIONS_TABLE).where({ shop_id: shopId }).first('reason')
      );
      expect(row?.reason).toBe('initial_policy_approval');
    });

    it('DELETE of an existing transition row is rejected', async () => {
      const shopId = await createFixtureShop('sppol10c');
      const variantId = await seedVariant(shopId);
      const policyId = await seedPolicyId(shopId, variantId);
      await withTenant(shopId, (trx) => trx(TRANSITIONS_TABLE).insert(transitionRow(shopId, variantId, policyId)));

      await expect(
        withTenant(shopId, (trx) => trx(TRANSITIONS_TABLE).where({ shop_id: shopId }).del())
      ).rejects.toBeDefined();

      const [{ count }] = await withTenant(shopId, (trx) =>
        trx(TRANSITIONS_TABLE).where({ shop_id: shopId }).count<{ count: string }[]>('* as count')
      );
      expect(Number(count)).toBe(1);
    });
  });

  // ── SP-POL-11 ─────────────────────────────────────────────────────────────
  describe('SP-POL-11: tenant isolation is DB-enforced (forced RLS)', () => {
    it('stock_protection_policies has ROW LEVEL SECURITY enabled and FORCED', async () => {
      const shopId = await createFixtureShop('sppol11a');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT relrowsecurity, relforcerowsecurity
             FROM pg_class WHERE relname = ?`,
          [CURRENT_TABLE]
        )
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].relrowsecurity).toBe(true);
      expect(rows[0].relforcerowsecurity).toBe(true);
    });

    it('stock_protection_policy_transitions has ROW LEVEL SECURITY enabled and FORCED', async () => {
      const shopId = await createFixtureShop('sppol11b');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT relrowsecurity, relforcerowsecurity
             FROM pg_class WHERE relname = ?`,
          [TRANSITIONS_TABLE]
        )
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].relrowsecurity).toBe(true);
      expect(rows[0].relforcerowsecurity).toBe(true);
    });

    it('one tenant cannot read another tenant\'s current-policy row', async () => {
      const shopAId = await createFixtureShop('sppol11c-a');
      const shopBId = await createFixtureShop('sppol11c-b');
      const variantAId = await seedVariant(shopAId);

      await withTenant(shopAId, (trx) => trx(CURRENT_TABLE).insert(currentPolicyRow(shopAId, variantAId)));

      const visibleToB = await withTenant(shopBId, (trx) =>
        trx(CURRENT_TABLE).where({ shop_id: shopAId }).select('*')
      );
      expect(visibleToB).toHaveLength(0);
    });

    it('one tenant cannot write a current-policy row for another tenant (WITH CHECK)', async () => {
      const shopAId = await createFixtureShop('sppol11d-a');
      const shopBId = await createFixtureShop('sppol11d-b');
      const variantAId = await seedVariant(shopAId);

      // Asserting the exact rejection reason (not merely "any rejection")
      // matters here: before the table existed, this same assertion passed
      // vacuously because the INSERT failed with "relation does not exist"
      // rather than an RLS violation. Pinning the message keeps that
      // contradiction from silently recurring.
      await expect(
        withTenant(shopBId, (trx) => trx(CURRENT_TABLE).insert(currentPolicyRow(shopAId, variantAId)))
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
