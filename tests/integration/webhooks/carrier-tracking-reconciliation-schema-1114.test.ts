// tests/integration/webhooks/carrier-tracking-reconciliation-schema-1114.test.ts
//
// #1114 — Carrier tracking reconciliation, Shippo metadata schema contract.
//
// WORKSHOP #1114 §5/§12 (Shippo metadata strategy "persist both"):
// order_shipment_tracking must gain two additive, nullable columns so a
// Shippo label purchase can record the provider-authoritative
// `rate.carrier_account` immediately (zero extra API cost, never blocking a
// successful purchase — see the companion label-purchase RED test), and
// later carry the canonical carrier token once best-effort resolution
// succeeds. Both must be nullable: Sendcloud rows need neither, and
// historical Shippo rows purchased before this migration exists can never
// safely backfill either (WORKSHOP #1114 §11 — no heuristic recovery from
// carrier_zone's free-text display string is permitted).
//
// RED today: no migration has added either column yet. This is schema/
// catalog introspection only (information_schema.columns), matching
// tests/integration/inventory/stock-protection-policy.migration.test.ts's
// established pattern — no service module dependency, no SELECT of a
// nonexistent column (which would fail at the SQL level, not the assertion
// level).

import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const TABLE = 'order_shipment_tracking';

const REQUIRED_COLUMNS: Record<string, { nullable: boolean; udt: string[] }> = {
  provider_carrier_account_id: { nullable: true, udt: ['varchar', 'text'] },
  provider_carrier_code:       { nullable: true, udt: ['varchar', 'text'] },
};

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = Math.random().toString(36).slice(2, 8);
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

describe('#1114 order_shipment_tracking — Shippo reconciliation metadata columns', () => {
  it.each(Object.entries(REQUIRED_COLUMNS))(
    '%s exists, nullable, on a text-like type',
    async (column, expected) => {
      const shopId = await createFixtureShop('carrier1114col');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT udt_name, is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
          [TABLE, column]
        )
      );

      // RED: expected present, currently absent (rows is empty today).
      expect(rows).toHaveLength(1);
      expect(expected.udt).toContain(rows[0].udt_name);
      expect(rows[0].is_nullable).toBe(expected.nullable ? 'YES' : 'NO');
    }
  );
});

// ─── SENDCLOUD V3 RECONCILIATION STATUS-MAP NAMESPACE ────────────────────────
//
// WORKSHOP #1114 §6 (Sendcloud v3 mapping strategy "Strategy B — pure
// adapter, separate namespace"): Sendcloud v3's `parent_status` vocabulary is
// NOT guaranteed equal to the existing webhook vocabulary already seeded
// under carrier_code='sendcloud' (migration 0118) — conflating them risks a
// textual collision between two different true meanings. A distinct
// carrier_code='sendcloud_v3' namespace in the SAME carrier_status_map table
// closes that risk with zero code change to resolveCanonicalEventType.
//
// Only the eight statuses the WORKSHOP brief itself certified as externally
// unambiguous are asserted — no speculative/ambiguous mapping is seeded or
// tested here.
//
// `sendcloud_v3` must never surface as a business carrier_code/source value
// (order_shipment_tracking.carrier_code, alerts.source, return_jobs.source
// all stay 'sendcloud'/'carrier_webhook') — it exists ONLY as a
// carrier_status_map lookup namespace. That non-exposure is asserted by a
// characterization contract in carrierTrackingNormalization.test.ts
// (STATUS_NAMESPACE_RED_BLOCKED_BY_NO_EXISTING_SEAM — no runtime code path
// reads 'sendcloud_v3' yet, so there is nothing to assert against today).
describe('#1114 carrier_status_map — Sendcloud v3 reconciliation namespace', () => {
  const UNAMBIGUOUS_MAPPINGS: Array<{ raw_status: string; event_type: string }> = [
    { raw_status: 'Announced', event_type: 'announced' },
    { raw_status: 'Parcel en route', event_type: 'in_transit' },
    { raw_status: 'Driver en route', event_type: 'out_for_delivery' },
    { raw_status: 'Delivered', event_type: 'delivered' },
    { raw_status: 'Delivery attempt failed', event_type: 'exception' },
    { raw_status: 'Unable to deliver', event_type: 'exception' },
    { raw_status: 'Exception', event_type: 'exception' },
    { raw_status: 'Returned to sender', event_type: 'returned' },
  ];

  it('carries zero sendcloud_v3 rows today (RED — the namespace has not been seeded yet)', async () => {
    const shopId = await createFixtureShop('carrier1114v3zero');
    const { rows } = await withTenant(shopId, (trx) =>
      trx.raw(`SELECT raw_status, event_type FROM carrier_status_map WHERE carrier_code = 'sendcloud_v3'`)
    );
    // RED: expected >= 8 seeded rows; currently 0.
    expect(rows.length).toBeGreaterThanOrEqual(UNAMBIGUOUS_MAPPINGS.length);
  });

  it.each(UNAMBIGUOUS_MAPPINGS)(
    'sendcloud_v3 "$raw_status" maps to canonical "$event_type"',
    async ({ raw_status, event_type }) => {
      const shopId = await createFixtureShop('carrier1114v3map');
      const { rows } = await withTenant(shopId, (trx) =>
        trx.raw(
          `SELECT event_type FROM carrier_status_map WHERE carrier_code = 'sendcloud_v3' AND raw_status = ?`,
          [raw_status]
        )
      );
      // RED: expected exactly one row with the certified mapping; currently none.
      expect(rows).toHaveLength(1);
      expect(rows[0].event_type).toBe(event_type);
    }
  );

  it('the sendcloud_v3 namespace stays fully separate from the existing sendcloud webhook vocabulary', async () => {
    const shopId = await createFixtureShop('carrier1114v3sep');
    const { rows } = await withTenant(shopId, (trx) =>
      trx.raw(
        `SELECT raw_status FROM carrier_status_map WHERE carrier_code = 'sendcloud' AND raw_status = ANY(?)`,
        [UNAMBIGUOUS_MAPPINGS.map((m) => m.raw_status)]
      )
    );
    // None of the new v3 raw_status strings should exist under the OLD
    // 'sendcloud' webhook namespace — proves the two vocabularies were never
    // merged into one carrier_code.
    expect(rows).toHaveLength(0);
  });
});
