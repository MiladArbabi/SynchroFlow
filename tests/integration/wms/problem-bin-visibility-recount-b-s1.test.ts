// SF-PROBLEM-BIN-B-S1 — inventory visibility and recount protection.
//
// VIS-01  live order constraint (inventoryConstraintEvaluator) never counts
//         Problem Bin / quarantine stock as orderable.
// VIS-02  live low-stock signal (computeVariantPlanning, stock_protection and
//         legacy modes) uses eligible (pickable) availability only; physical
//         on_hand is untouched.
// REC-01  full / variant_set skip protected zones; suggested never includes them.
// REC-02  explicit location / locations naming a protected zone → 409
//         RECOUNT_LOCATION_PROTECTED, nothing written.
// REC-03  a pre-guard task with a protected variance line cannot commit or be
//         accepted; escalation is the exit; ordinary pick/storage commit works.
// TEN-01  protection is keyed on the shop's own location metadata.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';
import {
  createRecountTask,
  commitRecount,
  reviewLine,
  RECOUNT_LOCATION_PROTECTED,
} from 'api-src/services/wms/inventoryRecount.service';
import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import { computeVariantPlanning } from 'api-src/services/demand/demandIntelligence.service';

const app = createApp();

type Fixture = {
  shopId: number;
  userId: number;
  warehouseId: string;
  token: string;
  productId: string;
  /** stock at A-1 (pick) = 2, PB-1 (problem) = 5, Q-1 (quarantine) = 4 */
  mixedVariant: string;
  /** stock ONLY at PB-1 (problem) = 6 */
  problemOnlyVariant: string;
  /** stock ONLY at S-1 (storage) = 3 */
  storageVariant: string;
};

async function createFixture(tag: string, opts: { pb1Zone?: 'problem' | 'pick' } = {}): Promise<Fixture> {
  const unique = `${tag}-${crypto.randomBytes(5).toString('hex')}`;
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `pb-b-s1-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users').insert({
      shop_id: shopId, email: `pb-b-s1+${unique}@test.example`, password_hash: 'not_a_real_hash',
      first_name: 'Owner', role: 'owner',
    }).returning('id');
    return row.id as number;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  const productId = crypto.randomUUID();
  const [mixedVariant, problemOnlyVariant, storageVariant] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId, user_id: userId, phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID(),
    });
    await trx('shop_subscriptions').insert({
      shop_id: shopId, tier: 'core', allow_overage: true, billing_provider: 'stripe', stripe_customer_id: null,
    });
    await trx('shop_wms_settings').insert({
      shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1', problem_bin_location: 'PB-1',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId, shop_id: shopId, name: 'Main', root_location_code: rootCode, is_default: true, active: true,
    });
    const loc = (location_code: string, zone_type: string | null, type = 'bin') => ({
      shop_id: shopId, warehouse_id: warehouseId, location_code, type,
      parent_location_code: type === 'warehouse' ? null : rootCode, active: true, zone_type,
    });
    await trx('warehouse_locations').insert([
      loc(rootCode, null, 'warehouse'),
      loc('A-1', 'pick'),
      loc('S-1', 'storage'),
      loc('PB-1', opts.pb1Zone ?? 'problem'),
      loc('Q-1', 'quarantine'),
    ]);
    await trx('products').insert({
      lasyncro_product_id: productId, shop_id: shopId, title: 'B-S1 product', status: 'active', product_type: 'physical',
    });
    await trx('variants').insert([mixedVariant, problemOnlyVariant, storageVariant].map((id, i) => ({
      lasyncro_variant_id: id, lasyncro_product_id: productId, shop_id: shopId,
      sku: `PBS1-${unique}-${i}`, title: `V${i}`, unit_cost: '1.00', status: 'active',
    })));
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const truth = (variant: string, location_code: string, qty: number) => ({
      shop_id: shopId, lasyncro_variant_id: variant, location_code, on_hand_quantity: qty,
      reserved_quantity: 0, committed_quantity: 0, available_quantity: qty, last_evaluated_at: new Date(),
    });
    await trx('inventory_truth').insert([
      truth(mixedVariant, 'A-1', 2),
      truth(mixedVariant, 'PB-1', 5),
      truth(mixedVariant, 'Q-1', 4),
      truth(problemOnlyVariant, 'PB-1', 6),
      truth(storageVariant, 'S-1', 3),
    ]);
  });

  return {
    shopId, userId, warehouseId, productId, mixedVariant, problemOnlyVariant, storageVariant,
    token: issueTestToken({ userId, shopId, tier: 'core' }),
  };
}

async function createOrder(f: Fixture, variantId: string, quantity: number): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();
  await withTenant(f.shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId, shop_id: f.shopId, aggregate_version: 1, payment_state: 'paid', currency: 'USD',
      total_price: '10.00', subtotal_price: '10.00', total_tax: '0.00',
      order_created_at: now, order_updated_at: now, created_at: now, updated_at: now,
    });
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(), lasyncro_order_id: orderId, lasyncro_product_id: f.productId,
      lasyncro_variant_id: variantId, sku: null, title: 'B-S1 line', quantity, fulfilled_quantity: 0,
      unit_price: '10.00', line_total: (10 * quantity).toFixed(2), estimated_unit_cost: '1.00',
    });
  });
  return orderId;
}

const linesOf = (shopId: number, taskId: string) => withTenant(shopId, (trx) =>
  trx('inventory_recount_lines').where({ shop_id: shopId, recount_task_id: taskId })
    .orderBy(['location_code', 'lasyncro_variant_id']).select('location_code', 'lasyncro_variant_id'));

const countTasks = (shopId: number) => withTenant(shopId, async (trx) => {
  const [{ count }] = await trx('inventory_recount_tasks').where({ shop_id: shopId }).count<{ count: string }[]>('* as count');
  return Number(count);
});

const PROTECTED = ['PB-1', 'Q-1'];

/** A task as it could exist before this guard: in review, with an accepted
 * non-zero variance at a protected location and one at a pick bin. */
async function seedLegacyReviewTask(f: Fixture) {
  return withTenant(f.shopId, async (trx) => {
    const [task] = await trx('inventory_recount_tasks').insert({
      shop_id: f.shopId, warehouse_id: f.warehouseId, label: `RC-LEGACY-${crypto.randomBytes(3).toString('hex')}`,
      scope: 'full', status: 'manual_review', blind: true, created_by: f.userId,
    }).returning(['recount_task_id']);
    const line = (variant: string, location_code: string, expected: number, counted: number) => ({
      recount_task_id: task.recount_task_id, shop_id: f.shopId, lasyncro_variant_id: variant, location_code,
      expected_quantity: expected, counted_quantity: counted, variance: counted - expected,
      variance_reason: 'shrinkage', counted_at: new Date(), counted_by: f.userId,
    });
    const rows = await trx('inventory_recount_lines').insert([
      line(f.problemOnlyVariant, 'PB-1', 6, 5),
      line(f.mixedVariant, 'A-1', 2, 1),
    ]).returning(['recount_line_id', 'location_code']);
    const byLoc = Object.fromEntries(rows.map((r: any) => [r.location_code, r.recount_line_id]));
    return { taskId: task.recount_task_id as string, protectedLineId: byLoc['PB-1'] as string, pickLineId: byLoc['A-1'] as string };
  });
}

const correctionsFor = (shopId: number, lineIds: string[]) => withTenant(shopId, (trx) =>
  trx('inventory_movements').where({ shop_id: shopId, reference_type: 'recount_line' })
    .whereIn('reference_id', lineIds).select('location_code', 'quantity_delta'));

describe('SF-PROBLEM-BIN-B-S1 inventory visibility', () => {
  let f: Fixture;
  beforeAll(async () => { f = await createFixture('vis'); });

  it('VIS-01: order constraint counts only pickable stock (Problem Bin / quarantine never orderable)', async () => {
    const fits = await createOrder(f, f.mixedVariant, 2);          // pickable 2 → ok
    const exceeds = await createOrder(f, f.mixedVariant, 3);       // pickable 2, physical 11 → oversell
    const onlyProblem = await createOrder(f, f.problemOnlyVariant, 1); // 6 in PB-1, 0 pickable → oversell

    const evaluate = (orderId: string) => withTenant(f.shopId, (trx) => evaluateInventoryConstraint(trx, orderId, f.shopId));
    expect((await evaluate(fits))[0]).toMatchObject({ targetId: f.mixedVariant, isActive: false });
    expect((await evaluate(exceeds))[0]).toMatchObject({ targetId: f.mixedVariant, isActive: true, meta: { blockType: 'oversell' } });
    expect((await evaluate(onlyProblem))[0]).toMatchObject({ targetId: f.problemOnlyVariant, isActive: true });
  });

  it.each(['stock_protection', 'legacy'] as const)(
    'VIS-02 (%s): low-stock availability excludes Problem Bin / quarantine; on_hand unchanged',
    async (eligibilityMode) => {
      const rows = await withTenant(f.shopId, (trx) =>
        computeVariantPlanning(trx, f.shopId, [f.mixedVariant, f.problemOnlyVariant], { eligibilityMode }));
      const avail = (id: string) => rows.find((r: any) => r.lasyncro_variant_id === id)?.available_quantity;
      expect(avail(f.mixedVariant)).toBe(2);
      // Its 6 units are all in PB-1. Depending on mode/eligibility the variant
      // is absent or present at 0 — never counted as sellable stock.
      expect([0, undefined]).toContain(avail(f.problemOnlyVariant));

      const onHand = await withTenant(f.shopId, (trx) => trx('inventory_truth')
        .where({ shop_id: f.shopId, lasyncro_variant_id: f.mixedVariant }).sum({ q: 'on_hand_quantity' }).first());
      expect(Number(onHand?.q)).toBe(11);
    }
  );
});

describe('SF-PROBLEM-BIN-B-S1 recount protection', () => {
  let f: Fixture;
  beforeAll(async () => { f = await createFixture('rec'); });

  it('REC-01 full: excludes Problem Bin and quarantine, keeps pick and storage', async () => {
    const res = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${f.token}`).send({ scope: 'full' });
    expect(res.status).toBe(201);
    const codes = (await linesOf(f.shopId, res.body.task.recount_task_id)).map((l: any) => l.location_code);
    expect(codes.sort()).toEqual(['A-1', 'S-1']);
    expect(codes.some((c: string) => PROTECTED.includes(c))).toBe(false);
  });

  it('REC-01 variant_set: protected rows of the selected variants are skipped', async () => {
    const res = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${f.token}`).send({ scope: 'variant_set', variant_ids: [f.mixedVariant] });
    expect(res.status).toBe(201);
    expect(await linesOf(f.shopId, res.body.task.recount_task_id))
      .toEqual([{ location_code: 'A-1', lasyncro_variant_id: f.mixedVariant }]);
  });

  it('REC-01 variant_set: a variant held only in protected zones yields no task (400, nothing written)', async () => {
    const before = await countTasks(f.shopId);
    const res = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${f.token}`).send({ scope: 'variant_set', variant_ids: [f.problemOnlyVariant] });
    expect(res.status).toBe(400);
    expect(await countTasks(f.shopId)).toBe(before);
  });

  it('REC-01 suggested: dormant protected stock is never suggested; dormant pick/storage stock is', async () => {
    const res = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${f.token}`).send({ scope: 'suggested' });
    expect(res.status).toBe(201);
    const codes = (await linesOf(f.shopId, res.body.task.recount_task_id)).map((l: any) => l.location_code);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.some((c: string) => PROTECTED.includes(c))).toBe(false);
  });

  it.each([
    ['location PB-1', { scope: 'location', location_code: 'PB-1' }, 'PB-1'],
    ['location Q-1', { scope: 'location', location_code: 'Q-1' }, 'Q-1'],
    ['locations [A-1, PB-1]', { scope: 'locations', location_codes: ['A-1', 'PB-1'] }, 'PB-1'],
  ])('REC-02 explicit %s → 409 RECOUNT_LOCATION_PROTECTED, nothing written', async (_n, body, code) => {
    const before = await countTasks(f.shopId);
    const res = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${f.token}`).send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(RECOUNT_LOCATION_PROTECTED);
    expect(res.body.error).toContain(code);
    expect(res.body.error).toContain('Problem Center');
    expect(await countTasks(f.shopId)).toBe(before);
  });

  it('REC-02 explicit pick and storage locations still work', async () => {
    const res = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${f.token}`).send({ scope: 'locations', location_codes: ['A-1', 'S-1'] });
    expect(res.status).toBe(201);
    expect(res.body.task.line_count).toBe(2);
  });

  it('REC-03: legacy protected variance refuses commit (409) with no correction written', async () => {
    const { taskId, protectedLineId, pickLineId } = await seedLegacyReviewTask(f);
    const res = await request(app).post(`/api/v1/wms/recount-tasks/${taskId}/commit`)
      .set('Authorization', `Bearer ${f.token}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(RECOUNT_LOCATION_PROTECTED);
    expect(res.body.error).toContain('PB-1');
    expect(await correctionsFor(f.shopId, [protectedLineId, pickLineId])).toEqual([]);
    const task = await withTenant(f.shopId, (trx) =>
      trx('inventory_recount_tasks').where({ shop_id: f.shopId, recount_task_id: taskId }).first('status'));
    expect(task.status).toBe('manual_review');
  });

  it('REC-03: accept on a protected line is refused; escalation is the exit; pick correction then commits', async () => {
    const { taskId, protectedLineId, pickLineId } = await seedLegacyReviewTask(f);

    await expect(withTenant(f.shopId, (trx) => reviewLine(trx, {
      shopId: f.shopId, recountTaskId: taskId, recountLineId: protectedLineId,
      decision: 'accept', varianceReason: 'shrinkage', reviewedBy: f.userId,
    }))).rejects.toThrow(RECOUNT_LOCATION_PROTECTED);

    await withTenant(f.shopId, (trx) => reviewLine(trx, {
      shopId: f.shopId, recountTaskId: taskId, recountLineId: protectedLineId,
      decision: 'escalate', reviewedBy: f.userId,
    }));

    const result = await withTenant(f.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      return commitRecount(trx, f.shopId, taskId, f.userId);
    });
    expect(result).toEqual({ corrections: 1, units: 1 });
    expect(await correctionsFor(f.shopId, [protectedLineId, pickLineId]))
      .toEqual([{ location_code: 'A-1', quantity_delta: -1 }]);

    const pb = await withTenant(f.shopId, (trx) => trx('inventory_truth')
      .where({ shop_id: f.shopId, lasyncro_variant_id: f.problemOnlyVariant, location_code: 'PB-1' }).first('on_hand_quantity'));
    expect(pb.on_hand_quantity).toBe(6);
  });

  it('REC-03: service-level createRecountTask refuses a protected explicit location', async () => {
    await expect(withTenant(f.shopId, (trx) => createRecountTask(trx, {
      shopId: f.shopId, scope: 'location', locationCode: 'Q-1', createdBy: f.userId,
    }))).rejects.toThrow(RECOUNT_LOCATION_PROTECTED);
  });
});

describe('SF-PROBLEM-BIN-B-S1 tenant isolation', () => {
  it('TEN-01: protection follows each shop\'s own zones; another shop\'s Problem Bin code is irrelevant', async () => {
    const a = await createFixture('ten-a');                     // PB-1 is a problem zone
    const b = await createFixture('ten-b', { pb1Zone: 'pick' }); // PB-1 is an ordinary pick bin

    const bRes = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${b.token}`).send({ scope: 'location', location_code: 'PB-1' });
    expect(bRes.status).toBe(201);
    expect((await linesOf(b.shopId, bRes.body.task.recount_task_id)).every((l: any) => l.location_code === 'PB-1')).toBe(true);

    const aRes = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${a.token}`).send({ scope: 'location', location_code: 'PB-1' });
    expect(aRes.status).toBe(409);

    // Shop A's full scope never sees shop B's rows, and B's full scope keeps its PB-1.
    const aFull = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${a.token}`).send({ scope: 'full' });
    const aVariants = new Set((await linesOf(a.shopId, aFull.body.task.recount_task_id)).map((l: any) => l.lasyncro_variant_id));
    for (const v of [b.mixedVariant, b.problemOnlyVariant, b.storageVariant]) expect(aVariants.has(v)).toBe(false);

    const bFull = await request(app).post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${b.token}`).send({ scope: 'full' });
    const bCodes = (await linesOf(b.shopId, bFull.body.task.recount_task_id)).map((l: any) => l.location_code);
    expect(bCodes).toContain('PB-1');
    expect(bCodes).not.toContain('Q-1');

    // Cross-tenant constraint read: A's order never sees B's pickable stock.
    const order = await createOrder(a, a.problemOnlyVariant, 1);
    const [res] = await withTenant(a.shopId, (trx) => evaluateInventoryConstraint(trx, order, a.shopId));
    expect(res).toMatchObject({ isActive: true });
  });
});
