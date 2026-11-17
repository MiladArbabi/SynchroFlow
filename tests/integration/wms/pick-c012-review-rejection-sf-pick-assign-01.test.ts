/**
 * SF-PICK-ASSIGN-01 C012 (OUTCOME-INTEGRITY) — POST /pick/unconfirmed-scan-review
 * keeps the device's rejection evidence (status, code, error, reason and the
 * time it was rejected) in the existing operator_audit_log metadata, beside the
 * original scan. No migration; no Pick, ownership or inventory effect.
 * Real routes via createApp + supertest; disposable DB only (with-test-db.js).
 */
import request from 'supertest';
import crypto from 'crypto';
import { app, fixture, release, claim, batchRow, evidence } from './pick-assign-sf-01.fixture';
import { withTenant } from '@lasyncro/backend-core/db.js';

jest.setTimeout(240000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const review = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/wms/pick/unconfirmed-scan-review').set('Authorization', `Bearer ${token}`).send(body);
const auditRows = (shopId: number) => withTenant(shopId, (trx) =>
  trx('operator_audit_log').where({ shop_id: shopId, action_type: 'pick_unconfirmed_scan_review' }).select('*'));
const meta = (row: any) => (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata);

test('C12-A-01 the review keeps the rejection status, code, error, reason and timestamp beside the original scan; no Pick effect', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation as string;
  const before = { row: await batchRow(shopId, batchId), ev: await evidence(shopId, batchId) };
  const original = JSON.stringify({
    pick_batch_id: batchId, reservation_allocation_id: allocations[0].allocation_id,
    quantity_confirmed: 1, pick_claim_generation: gen,
  });
  const deviceEventId = crypto.randomUUID();
  const rejection = {
    status: 409, code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'This pick may already have been recorded.',
    reason: 'outcome_uncertain', rejected_at: 1_700_000_000_500,
  };
  const res = await review(fx.A.token, {
    device_event_id: deviceEventId, queued_at: 1_700_000_000_000,
    original: { url: '/api/v1/wms/pick/scan', method: 'POST', body: original },
    rejection,
  });
  expect(res.status).toBe(201);

  const rows = await auditRows(shopId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ operator_id: fx.A.userId, entity_type: 'pick_batch', entity_id: batchId });
  expect(meta(rows[0])).toMatchObject({
    device_event_id: deviceEventId, queued_at: 1_700_000_000_000, outcome: 'unconfirmed',
    original: { url: '/api/v1/wms/pick/scan', method: 'POST', body: original },
    rejection,
  });

  const after = { row: await batchRow(shopId, batchId), ev: await evidence(shopId, batchId) };
  expect(after).toEqual(before);
});

test('C12-A-02 a 5xx-exhausted mobile rejection (no code, no queue time) is kept with nulls, not dropped', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const res = await review(fx.A.token, {
    device_event_id: 'mobile-evt-1', queued_at: null,
    original: { url: '/api/v1/wms/pick/scan', method: 'POST', body: JSON.stringify({ pick_batch_id: 'b-1' }) },
    rejection: { status: 503, code: null, error: 'Service unavailable', reason: 'server_error_retries_exhausted', rejected_at: 1_234 },
  });
  expect(res.status).toBe(201);
  const [row] = await auditRows(shopId);
  expect(meta(row).rejection).toEqual({
    status: 503, code: null, error: 'Service unavailable', reason: 'server_error_retries_exhausted', rejected_at: 1_234,
  });
});

test('C12-A-03 a review without rejection data is still recorded (C010 historical scans), with rejection null', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const res = await review(fx.A.token, {
    device_event_id: 'hist-1', queued_at: 1,
    original: { url: '/api/v1/wms/pick/scan', method: 'POST', body: '{}' },
  });
  expect(res.status).toBe(201);
  const [row] = await auditRows(shopId);
  expect(meta(row).rejection).toBeNull();
});

test('C12-A-04 malformed rejection data is refused and writes nothing', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const valid = {
    device_event_id: 'x', queued_at: null,
    original: { url: '/api/v1/wms/pick/scan', method: 'POST', body: '{}' },
  };
  for (const rejection of [
    'nope',
    [],
    { status: '409' },
    { code: 42 },
    { error: 'e'.repeat(2049) },
    { reason: { nested: true } },
    { rejected_at: 'yesterday' },
  ]) {
    const res = await review(fx.A.token, { ...valid, rejection });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_UNCONFIRMED_SCAN_REVIEW');
  }
  expect(await auditRows(shopId)).toHaveLength(0);
});
