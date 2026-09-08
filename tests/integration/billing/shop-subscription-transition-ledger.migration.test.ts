// tests/integration/billing/shop-subscription-transition-ledger.migration.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B2 — schema contract for the canonical commercial
// transition ledger. PERMANENT regression contract, authored RED.
// ===========================================================================
// INDEPENDENTLY RED
//   This suite depends only on the ledger SCHEMA, never on the canonical
//   service. It is RED because shop_subscription_transitions does not exist,
//   and it stays green afterwards only while the table keeps its provenance
//   shape and its append-only guarantee.
//
// PLACEMENT
//   Lives under tests/integration/ because that is the ONLY Jest project
//   (backend-integration) wired to the disposable-PostgreSQL harness
//   scripts/with-test-db.js. There is no tests/migrations/ directory and no
//   migrations Jest project in this repository; a file placed there would be
//   claimed by backend-legacy, which has no test-DB lifecycle. No separate
//   harness is invented here.
//
// WHAT IS ASSERTED
//   Structure that is contractual (columns, nullability, types, FK, index,
//   idempotency uniqueness) and behaviour that is contractual (append-only:
//   INSERT permitted, UPDATE rejected, DELETE rejected). Column ORDER,
//   constraint NAMES and index NAMES are deliberately not frozen.

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const LEDGER_TABLE = 'shop_subscription_transitions';

/** column -> { nullable, udt } — udt_name is the concrete PostgreSQL type. */
const REQUIRED_COLUMNS: Record<string, { nullable: boolean; udt: string[] }> = {
  id:                    { nullable: false, udt: ['int4', 'int8', 'uuid'] },
  shop_id:               { nullable: false, udt: ['int4', 'int8'] },
  from_tier:             { nullable: true,  udt: ['varchar', 'text'] },
  to_tier:               { nullable: false, udt: ['varchar', 'text'] },
  from_status:           { nullable: true,  udt: ['varchar', 'text'] },
  to_status:             { nullable: false, udt: ['varchar', 'text'] },
  from_billing_provider: { nullable: true,  udt: ['varchar', 'text'] },
  to_billing_provider:   { nullable: false, udt: ['varchar', 'text'] },
  source:                { nullable: false, udt: ['varchar', 'text'] },
  reason:                { nullable: false, udt: ['varchar', 'text'] },
  actor_type:            { nullable: false, udt: ['varchar', 'text'] },
  actor_id:              { nullable: true,  udt: ['varchar', 'text'] },
  external_event_id:     { nullable: true,  udt: ['varchar', 'text'] },
  idempotency_key:       { nullable: true,  udt: ['varchar', 'text'] },
  metadata:              { nullable: true,  udt: ['jsonb'] },
  occurred_at:           { nullable: false, udt: ['timestamptz'] },
  created_at:            { nullable: false, udt: ['timestamptz'] },
};

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/** Minimum valid ledger row for the fixture shop. */
function ledgerRow(shopId: number, overrides: Record<string, unknown> = {}) {
  return {
    shop_id: shopId,
    from_tier: 'growth',
    to_tier: 'scale',
    from_status: 'active',
    to_status: 'active',
    from_billing_provider: 'stripe',
    to_billing_provider: 'stripe',
    source: 'stripe_webhook',
    reason: 'customer.subscription.updated',
    actor_type: 'system',
    occurred_at: new Date(),
    ...overrides,
  };
}

describe('BILL-ENTITLEMENT-01 — shop_subscription_transitions schema', () => {
  // ── SCHEMA-01 ───────────────────────────────────────────────────────────
  describe('SCHEMA-01: the canonical ledger table exists', () => {
    it('public.shop_subscription_transitions is present', async () => {
      const shopId = await createFixtureShop('schema01');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ?`,
          [LEDGER_TABLE]
        )
      );
      expect(rows).toHaveLength(1);
    });
  });

  // ── SCHEMA-02 ───────────────────────────────────────────────────────────
  describe('SCHEMA-02: every provenance column exists with the contracted type and nullability', () => {
    it.each(Object.entries(REQUIRED_COLUMNS))(
      '%s matches the provenance contract',
      async (column, expected) => {
        const shopId = await createFixtureShop('schema02');
        const { rows } = await withTenant(shopId, (trx) =>
          trx.raw(
            `SELECT udt_name, is_nullable FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
            [LEDGER_TABLE, column]
          )
        );
        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        expect(rows[0].is_nullable).toBe(expected.nullable ? 'YES' : 'NO');
      }
    );
  });

  // ── SCHEMA-03 ───────────────────────────────────────────────────────────
  describe('SCHEMA-03: the ledger is anchored to a real shop and indexed for shop history reads', () => {
    it('shop_id carries a foreign key to shops', async () => {
      const shopId = await createFixtureShop('schema03a');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT con.conname
             FROM pg_constraint con
             JOIN pg_class child  ON child.oid  = con.conrelid
             JOIN pg_class parent ON parent.oid = con.confrelid
            WHERE con.contype = 'f'
              AND child.relname = ?
              AND parent.relname = 'shops'`,
          [LEDGER_TABLE]
        )
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('an index leads with shop_id so per-shop history is not a sequential scan', async () => {
      const shopId = await createFixtureShop('schema03b');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ?`, [
          LEDGER_TABLE,
        ])
      );
      const leadsWithShopId = rows.some((r: any) => /\(\s*shop_id\b/.test(r.indexdef));
      expect(leadsWithShopId).toBe(true);
    });
  });

  // ── SCHEMA-04 ───────────────────────────────────────────────────────────
  describe('SCHEMA-04: non-null idempotency keys are unique per shop, NULLs are unconstrained', () => {
    it('a duplicate non-null idempotency_key for the same shop is rejected', async () => {
      const shopId = await createFixtureShop('schema04a');
      const key = `evt_${crypto.randomBytes(8).toString('hex')}`;

      await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE).insert(ledgerRow(shopId, { idempotency_key: key }))
      );

      await expect(
        withTenant(shopId, (trx) =>
          trx(LEDGER_TABLE).insert(ledgerRow(shopId, { idempotency_key: key }))
        )
      ).rejects.toBeDefined();
    });

    it('multiple rows with a NULL idempotency_key are permitted for the same shop', async () => {
      const shopId = await createFixtureShop('schema04b');

      await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE).insert(ledgerRow(shopId, { idempotency_key: null }))
      );
      await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE).insert(ledgerRow(shopId, { idempotency_key: null }))
      );

      const [{ count }] = await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE).where({ shop_id: shopId }).count<{ count: string }[]>('* as count')
      );
      expect(Number(count)).toBe(2);
    });
  });

  // ── SCHEMA-05 ───────────────────────────────────────────────────────────
  describe('SCHEMA-05: the ledger is append-only', () => {
    it('INSERT is permitted', async () => {
      const shopId = await createFixtureShop('schema05a');
      await withTenant(shopId, (trx) => trx(LEDGER_TABLE).insert(ledgerRow(shopId)));

      const [{ count }] = await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE).where({ shop_id: shopId }).count<{ count: string }[]>('* as count')
      );
      expect(Number(count)).toBe(1);
    });

    it('UPDATE of an existing ledger row is rejected', async () => {
      const shopId = await createFixtureShop('schema05b');
      await withTenant(shopId, (trx) => trx(LEDGER_TABLE).insert(ledgerRow(shopId)));

      await expect(
        withTenant(shopId, (trx) =>
          trx(LEDGER_TABLE).where({ shop_id: shopId }).update({ reason: 'rewritten_history' })
        )
      ).rejects.toBeDefined();

      const row = await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE).where({ shop_id: shopId }).first('reason')
      );
      expect(row?.reason).toBe('customer.subscription.updated');
    });

    it('DELETE of an existing ledger row is rejected', async () => {
      const shopId = await createFixtureShop('schema05c');
      await withTenant(shopId, (trx) => trx(LEDGER_TABLE).insert(ledgerRow(shopId)));

      await expect(
        withTenant(shopId, (trx) => trx(LEDGER_TABLE).where({ shop_id: shopId }).del())
      ).rejects.toBeDefined();

      const [{ count }] = await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE).where({ shop_id: shopId }).count<{ count: string }[]>('* as count')
      );
      expect(Number(count)).toBe(1);
    });
  });
});
