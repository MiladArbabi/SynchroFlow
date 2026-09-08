// SEC-SPECTER-FT2-UNAUTH-01
//
// SECURITY REGRESSION — unauthenticated, tenant-selectable Specter FT2 probe.
// PERMANENT contract, authored RED.
// ===========================================================================
// THE DEFECT
//   `GET /api/v1/specter/ft2` is mounted on the public Express app
//   (bootstrap/express.ts:147 -> specter.routes.ts:22) with NO
//   authenticateToken and NO tier gate. Its handler resolves the tenant from a
//   client-supplied header:
//
//     specter.ft2.controller.ts:22-24
//       const shopId =
//         Number(req.headers['x-test-shop-id']) ||   <-- attacker controlled
//         Number((req as any).shopId);
//
//   `x-test-shop-id` is checked FIRST, has no NODE_ENV guard, and is stripped
//   by no middleware. `(req as any).shopId` is never populated on this route
//   because no middleware runs. So any unauthenticated caller selects an
//   arbitrary tenant and receives that tenant's Specter FT2 exposure, derived
//   from the per-shop session store. Nothing in the path touches Postgres, so
//   RLS offers no compensating control.
//
// APPROVED FIX DIRECTION
//   Retire the endpoint completely. The permanent expected behaviour is 404
//   for every caller — authenticated or not, with or without the header.
//
//   404 is the contract, deliberately NOT 401/403. A 401 would mean the route
//   still exists and merely gained a gate; the approved direction is that this
//   probe is gone.
//
// SCOPE
//   This slice covers ONLY /ft2. The authenticated Specter routes (/state,
//   /config) are explicitly out of scope and are used below as a CONTROL.
//
// HARNESS
//   Real Express app via createApp(), supertest, no database access — the same
//   minimal shape as tests/integration/billing/shopify-billing-retired-callback.ts.

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

const FT2_PATH = '/api/v1/specter/ft2';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

describe('SEC-SPECTER-FT2-UNAUTH-01 — the unauthenticated Specter FT2 probe must not exist', () => {
  /**
   * CONTROL — must pass BEFORE and AFTER the fix.
   *
   * Proves the Specter router itself is still mounted, so the 404s asserted
   * below can only mean "/ft2 was removed", never "the whole router vanished"
   * or "createApp() failed to build". Without this the suite could pass
   * vacuously.
   */
  it('CONTROL: the Specter router stays mounted — /state still answers 401 unauthenticated', async () => {
    const res = await request(app).get('/api/v1/specter/state');

    expect(res.status).toBe(401);
  });

  it('SEC-SPECTER-FT2-UNAUTH-01: unauthenticated GET returns 404', async () => {
    const res = await request(app).get(FT2_PATH);

    expect(res.status).toBe(404);
  });

  it('SEC-SPECTER-FT2-UNAUTH-01: unauthenticated GET with x-test-shop-id: 1 returns 404', async () => {
    // The exact exploit shape: no credentials, tenant chosen by header.
    const res = await request(app).get(FT2_PATH).set('x-test-shop-id', '1');

    expect(res.status).toBe(404);
  });

  it('SEC-SPECTER-FT2-UNAUTH-01: unauthenticated GET with x-test-shop-id: 999999 returns 404', async () => {
    // A shop the caller could not possibly own.
    const res = await request(app).get(FT2_PATH).set('x-test-shop-id', '999999');

    expect(res.status).toBe(404);
  });

  it('SEC-SPECTER-FT2-UNAUTH-01: authenticated GET also returns 404 — the endpoint is retired, not gated', async () => {
    const token = issueTestToken({ userId: 1, shopId: 1, tier: 'scale' });

    const res = await request(app)
      .get(FT2_PATH)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
