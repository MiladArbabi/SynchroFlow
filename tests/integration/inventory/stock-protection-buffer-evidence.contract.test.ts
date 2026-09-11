// tests/integration/inventory/stock-protection-buffer-evidence.contract.test.ts
//
// STOCK-PROTECT-02 — API/DB integration contract for settled supplier
// evidence derivation. PERMANENT regression contract, authored RED.
// ============================================================================
// INDEPENDENTLY RED
//   Imports a service module that does not exist yet:
//     api-src/services/inventory/stockProtectionBufferEvidence
//   expected to export deriveSupplierEvidence(trx, shopId, supplierId). The
//   import fails with MODULE_NOT_FOUND — narrowly attributable to that one
//   missing file.
//
// WHAT THIS PROTECTS (STOCK-PROTECT-02A audit findings)
//   - Only status='received' purchase orders are SETTLED supplier-reliability
//     evidence. 'partially_received' POs are excluded from the
//     confidence-bearing sample entirely — a partial PO's actual_delivery_date
//     is set on its FIRST receive action and never revisited, so it measures
//     "was the first shipment on time," not "did the order complete."
//   - suppliers.total_pos MUST NOT be used as the sample-size denominator —
//     it increments only on full receipt and disagrees with whatever
//     population feeds the rate fields. The sample count must be derived
//     live from purchase_orders rows.
//   - Schedule variance = actual_delivery_date - expected_delivery_date.
//     Positive = late, negative = early. It is NEVER supplier lead time —
//     suppliers.lead_time_days is a separate, merchant-configured planning
//     input and must not be conflated with it.
//   - defect_rate is not general V1 supplier evidence (its population is a
//     WMS-receive-job subset, distinct from the settled-PO population used
//     for on-time/fill evidence).
//   - Repeated evidence reads are read-only — no DB mutation.
//
// PLACEMENT: tests/integration/ (backend-integration project) — real
// Postgres via scripts/with-test-db.js, following the fixture conventions in
// tests/integration/inventory/stock-protection-policy.contract.test.ts.

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { deriveSupplierEvidence } from 'api-src/services/inventory/stockProtectionBufferEvidence';

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedSupplier(
  shopId: number,
  name: string,
  overrides: Record<string, unknown> = {}
): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers')
      .insert({ shop_id: shopId, name, active: true, ...overrides })
      .returning('id');
    return Number((row as any).id ?? row);
  });
}

async function seedPo(
  shopId: number,
  supplierId: number,
  opts: {
    status: string;
    expectedDeliveryDate?: string | null;
    actualDeliveryDate?: string | null;
  }
): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('purchase_orders')
      .insert({
        shop_id: shopId,
        supplier_id: supplierId,
        status: opts.status,
        expected_delivery_date: opts.expectedDeliveryDate ?? null,
        actual_delivery_date: opts.actualDeliveryDate ?? null,
      })
      .returning('id');
    return String((row as any).id ?? row);
  });
}

async function seedPoLine(shopId: number, poId: string, ordered: number, received: number) {
  await withTenant(shopId, (trx) =>
    trx('purchase_order_line_items').insert({
      po_id: poId,
      shop_id: shopId,
      description: 'buffer-evidence fixture line',
      quantity_ordered: ordered,
      quantity_received: received,
    })
  );
}

async function supplierAndPoSnapshot(shopId: number, supplierId: number) {
  return withTenant(shopId, async (trx) => {
    const supplierRow = await trx('suppliers').where({ id: supplierId, shop_id: shopId }).first();
    const poCount = await trx('purchase_orders').where({ shop_id: shopId, supplier_id: supplierId }).count({ n: '*' }).first();
    return { supplierRow, poCount: Number(poCount?.n ?? 0) };
  });
}

describe('STOCK-PROTECT-02 — settled supplier evidence contract', () => {
  it('SP-BUF-EV-01: only status=received POs contribute settled evidence; partially_received, shipped, ordered are excluded', async () => {
    const shopId = await createFixtureShop('spbufev01');
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');

    // Two settled (received) POs, both on-time.
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-10', actualDeliveryDate: '2026-01-10' });
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-20', actualDeliveryDate: '2026-01-19' });
    // Noise: must NOT be counted as settled evidence.
    await seedPo(shopId, supplierId, { status: 'partially_received', expectedDeliveryDate: '2026-02-01', actualDeliveryDate: '2026-02-15' });
    await seedPo(shopId, supplierId, { status: 'shipped', expectedDeliveryDate: '2026-03-01' });
    await seedPo(shopId, supplierId, { status: 'ordered' });
    await seedPo(shopId, supplierId, { status: 'draft' });

    const evidence = await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    expect(evidence.settledPoCount).toBe(2);
  });

  it('SP-BUF-EV-02: suppliers.total_pos is misleading and must NOT be used as the sample denominator', async () => {
    const shopId = await createFixtureShop('spbufev02');
    // Deliberately misleading: total_pos claims 999 completed orders while
    // the real PO table has exactly 3 received rows.
    const supplierId = await seedSupplier(shopId, 'Misleading Supplier', { total_pos: 999 });

    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-01', actualDeliveryDate: '2026-01-01' });
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-05', actualDeliveryDate: '2026-01-06' });
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-08', actualDeliveryDate: '2026-01-08' });

    const evidence = await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    expect(evidence.settledPoCount).toBe(3);
    expect(evidence.settledPoCount).not.toBe(999);
  });

  it('SP-BUF-EV-03: a first partial receipt is not counted as final on-time evidence', async () => {
    const shopId = await createFixtureShop('spbufev03');
    const supplierId = await seedSupplier(shopId, 'Partial Receipt Supplier');

    // A partially_received PO whose FIRST receive happened to be on-time —
    // this must not count toward on-time evidence at all, settled or
    // otherwise, because the order itself never reached 'received'.
    await seedPo(shopId, supplierId, {
      status: 'partially_received',
      expectedDeliveryDate: '2026-01-10',
      actualDeliveryDate: '2026-01-10',
    });

    const evidence = await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    expect(evidence.settledPoCount).toBe(0);
    expect(evidence.hasEvidence).toBe(false);
    expect(evidence.onTimeRatePercent).toBeNull();
  });

  it('SP-BUF-EV-04: fill rate for Buffer Diagnosis uses only fully-settled received POs', async () => {
    const shopId = await createFixtureShop('spbufev04');
    const supplierId = await seedSupplier(shopId, 'Fill Rate Supplier');

    const settledPo = await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-01', actualDeliveryDate: '2026-01-01' });
    await seedPoLine(shopId, settledPo, 10, 10);

    // Noise: a partially_received PO with a much worse fill ratio must not
    // drag the settled fill-rate evidence down.
    const partialPo = await seedPo(shopId, supplierId, { status: 'partially_received' });
    await seedPoLine(shopId, partialPo, 100, 5);

    const evidence = await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    expect(evidence.fillRatePercent).toBe(100);
  });

  it('SP-BUF-EV-05: schedule variance is actual_delivery_date - expected_delivery_date (positive=late, negative=early), never lead time', async () => {
    const shopId = await createFixtureShop('spbufev05');
    const supplierId = await seedSupplier(shopId, 'Variance Supplier', { lead_time_days: 21 });

    // 3 days late.
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-10', actualDeliveryDate: '2026-01-13' });
    // 2 days early.
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-20', actualDeliveryDate: '2026-01-18' });

    const evidence = await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    // Mean of (+3, -2) = +0.5 — a schedule-variance figure, unrelated in
    // magnitude and sign convention to the configured 21-day lead time.
    expect(evidence.scheduleVarianceDays).toBeCloseTo(0.5, 5);
    expect(evidence.scheduleVarianceDays).not.toBe(21);
    expect(evidence).not.toHaveProperty('leadTimeDays');
    expect(evidence).not.toHaveProperty('lead_time_days');
  });

  it('SP-BUF-EV-06: configured suppliers.lead_time_days remains a separate planning input, untouched by evidence derivation', async () => {
    const shopId = await createFixtureShop('spbufev06');
    const supplierId = await seedSupplier(shopId, 'Lead Time Supplier', { lead_time_days: 14 });
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-01', actualDeliveryDate: '2026-01-05' });

    await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    const supplierRow = await withTenant(shopId, (trx) => trx('suppliers').where({ id: supplierId, shop_id: shopId }).first());
    expect(Number(supplierRow.lead_time_days)).toBe(14);
  });

  it('SP-BUF-EV-07: repeated evidence reads do not mutate the database', async () => {
    const shopId = await createFixtureShop('spbufev07');
    const supplierId = await seedSupplier(shopId, 'Read Only Supplier', { total_pos: 42 });
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-01', actualDeliveryDate: '2026-01-01' });

    const before = await supplierAndPoSnapshot(shopId, supplierId);

    await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));
    await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));
    await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    const after = await supplierAndPoSnapshot(shopId, supplierId);
    expect(after).toEqual(before);
  });

  it('SP-BUF-EV-08: defect_rate is not general V1 supplier evidence', async () => {
    const shopId = await createFixtureShop('spbufev08');
    const supplierId = await seedSupplier(shopId, 'Defect Rate Supplier', { defect_rate: '15.00' });
    await seedPo(shopId, supplierId, { status: 'received', expectedDeliveryDate: '2026-01-01', actualDeliveryDate: '2026-01-01' });

    const evidence = await withTenant(shopId, (trx) => deriveSupplierEvidence(trx, shopId, supplierId));

    expect(evidence).not.toHaveProperty('defectRatePercent');
    expect(evidence).not.toHaveProperty('defect_rate');
  });
});
