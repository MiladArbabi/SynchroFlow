// tests/integration/wms/wms-display-commercial-access-gh1219.test.ts
//
// GH-1219 / TIER-05 — RED INTEGRATION CONTRACT.
// ===========================================================================
// A WMS analytics display token proves display IDENTITY only. It must not
// independently preserve paid commercial access. The public display routes
//
//   GET  /api/v1/wms/analytics/display
//   POST /api/v1/wms/analytics/display/heartbeat
//
// must evaluate the shop's CURRENT authoritative commercial state against the
// canonical warehouse.analytics capability on every request:
//
//   display token -> validateDisplayToken -> verified shopId
//     -> current commercial state -> warehouse.analytics decision
//     -> ALLOW (200) / DENY (403 COMMERCIAL_ACCESS_DENIED)
//        / unavailable (503 COMMERCIAL_STATE_UNAVAILABLE)
//
// Decisive contract: SAME VALID TOKEN + CURRENT COMMERCIAL STATE CHANGES
// = ACCESS CHANGES IMMEDIATELY. No token rotation is ever performed here.
//
// EXPECTED RED on current main: httpGetDisplayData / httpDisplayHeartbeat
// (apps/backend/src/api/wms/wms.analytics.controller.ts) validate the token
// and then serve data / write last_seen_at with no commercial check at all.
//
// Real Express app (createApp(), never server.ts). Real disposable Postgres.
// Real generateDisplayToken() + validateDisplayToken() path. No user JWT on
// the public display routes. No worker started. No Stripe/Shopify call.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import * as shopResolutionModule from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { generateDisplayToken } from 'api-src/services/wms/wmsAnalytics.service';

const app = createApp();

const DISPLAY_ROUTE = '/api/v1/wms/analytics/display';
const HEARTBEAT_ROUTE = '/api/v1/wms/analytics/display/heartbeat';

// Fixed, clearly-past seed value so heartbeat advancement is unambiguous.
const SEEDED_LAST_SEEN_AT = new Date('2020-01-01T00:00:00.000Z');

let SHOP_ID: number;
let TOKEN_ID: string;
let RAW_TOKEN: string;

/**
 * Minimum fixture graph for the public display routes: tenant shop, one
 * explicit shop_subscriptions row (Core), one active shop_display_tokens row
 * whose hash comes from production generateDisplayToken(). The display routes
 * use no user, membership, or lifecycle state.
 */
beforeAll(async () => {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1219-display-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(SHOP_ID, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: SHOP_ID,
      tier: 'core',
      billing_provider: 'stripe',
    }),
  );

  const { raw, hash } = generateDisplayToken(SHOP_ID);
  RAW_TOKEN = raw;
  TOKEN_ID = await withTenant(SHOP_ID, async (trx) => {
    const [row] = await trx('shop_display_tokens')
      .insert({
        shop_id: SHOP_ID,
        token_hash: hash,
        label: 'gh1219 fixture display',
        last_seen_at: SEEDED_LAST_SEEN_AT,
      })
      .returning('id');
    return row.id as string;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await db.destroy();
});

/** Mutates ONLY the current shop_subscriptions tier for the fixture shop. */
async function setCurrentTier(tier: 'starter' | 'core'): Promise<void> {
  const updated = await withTenant(SHOP_ID, (trx) =>
    trx('shop_subscriptions').where({ shop_id: SHOP_ID }).update({ tier }),
  );
  expect(updated).toBe(1);
}

async function readLastSeenAt(): Promise<Date | null> {
  const row = await withTenant(SHOP_ID, (trx) =>
    trx('shop_display_tokens')
      .where({ id: TOKEN_ID, shop_id: SHOP_ID })
      .first('last_seen_at', 'rotated_at'),
  );
  // The SAME token must still be the active, unrotated row throughout.
  expect(row?.rotated_at).toBeNull();
  return row?.last_seen_at ?? null;
}

function getDisplay(token: string = RAW_TOKEN) {
  return request(app).get(DISPLAY_ROUTE).query({ token });
}

function postHeartbeat(token: string = RAW_TOKEN) {
  return request(app).post(HEARTBEAT_ROUTE).query({ token }).send({});
}

function expectDisplayPayload(res: request.Response) {
  expect(res.status).toBe(200);
  expect(res.body).toEqual(
    expect.objectContaining({
      live: expect.anything(),
      pipeline: expect.anything(),
      exceptions: expect.anything(),
      zones: expect.anything(),
    }),
  );
}

function expectNoDisplayPayload(res: request.Response) {
  for (const key of ['live', 'pipeline', 'exceptions', 'zones']) {
    expect(res.body).not.toHaveProperty(key);
  }
}

function expectAnalyticsDenied(res: request.Response) {
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({
    error: 'COMMERCIAL_ACCESS_DENIED',
    capabilityId: 'warehouse.analytics',
    currentTier: 'starter',
  });
  expectNoDisplayPayload(res);
}

describe('GH-1219 WMS display token — current commercial boundary', () => {
  it('A. GREEN CONTROL: valid token + current Core => 200 display payload', async () => {
    await setCurrentTier('core');

    const res = await getDisplay();

    expect(res.status).not.toBe(401);
    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expectDisplayPayload(res);
  });

  it('B. EXPECTED RED: SAME token after Core -> Starter downgrade => 403 COMMERCIAL_ACCESS_DENIED', async () => {
    await setCurrentTier('core');
    expectDisplayPayload(await getDisplay());

    await setCurrentTier('starter');
    const res = await getDisplay();

    expectAnalyticsDenied(res);
  });

  it('C. GREEN CONTROL: valid token + current Core heartbeat => 200 and last_seen_at advances', async () => {
    await setCurrentTier('core');
    const before = await readLastSeenAt();

    const res = await postHeartbeat();

    expect(res.status).toBe(200);
    const after = await readLastSeenAt();
    expect(after).not.toBeNull();
    expect(after!.getTime()).toBeGreaterThan((before ?? SEEDED_LAST_SEEN_AT).getTime());
  });

  it('D. EXPECTED RED: SAME token heartbeat after downgrade => 403 and last_seen_at unchanged', async () => {
    await setCurrentTier('core');
    expect((await postHeartbeat()).status).toBe(200);

    await setCurrentTier('starter');
    const before = await readLastSeenAt();

    const res = await postHeartbeat();

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'warehouse.analytics',
      currentTier: 'starter',
    });
    expect(await readLastSeenAt()).toEqual(before);
  });

  it('E. GREEN CONTROL: invalid token => 401 INVALID_TOKEN', async () => {
    await setCurrentTier('core');
    const forged = `${SHOP_ID}_${crypto.randomBytes(32).toString('hex')}`;

    const display = await getDisplay(forged);
    expect(display.status).toBe(401);
    expect(display.body.error).toBe('INVALID_TOKEN');

    const heartbeat = await postHeartbeat(forged);
    expect(heartbeat.status).toBe(401);
    expect(heartbeat.body.error).toBe('INVALID_TOKEN');
  });

  it('F. EXPECTED RED: commercial-state resolution failure => 503 COMMERCIAL_STATE_UNAVAILABLE, no payload, no heartbeat write', async () => {
    // Allowed tier on the row, so a 503 cannot be confused with a DENY.
    await setCurrentTier('core');
    const before = await readLastSeenAt();

    jest
      .spyOn(shopResolutionModule, 'resolveTierForShop')
      .mockRejectedValue(new Error('gh1219_simulated_commercial_state_failure'));

    const display = await getDisplay();
    expect(display.status).toBe(503);
    expect(display.body.error).toBe('COMMERCIAL_STATE_UNAVAILABLE');
    expectNoDisplayPayload(display);

    const heartbeat = await postHeartbeat();
    expect(heartbeat.status).toBe(503);
    expect(heartbeat.body.error).toBe('COMMERCIAL_STATE_UNAVAILABLE');
    expect(await readLastSeenAt()).toEqual(before);
  });
});
