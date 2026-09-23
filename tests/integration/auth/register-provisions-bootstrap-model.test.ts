import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';

const app = createApp();

// S1-03 (SLICE 1) — a genuinely new shop provisioned by organic registration
// is explicitly classified reconcile_opening_expectation_v2. This is kept as
// its own focused suite because register-creates-membership.test.ts's
// unscoped systemQuery(db('users').where({email})) read hits a pre-existing,
// unrelated RLS defect (default tenant '0' under FORCE RLS returns zero
// rows) before reaching that assertion. This suite avoids that gap by using
// the reviewed SECURITY DEFINER resolver (resolve_auth_user_by_email,
// migration 0138) that shopify-install-provisions-wms-settings.test.ts
// already uses for the equivalent tenant-safe post-registration lookup.
describe('Auth registration → bootstrap_model provisioning', () => {
  it('S1-03 classifies a new organic registration reconcile_opening_expectation_v2', async () => {
    const email = `owner+${crypto.randomBytes(4).toString('hex')}@test.com`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'StrongPassword123!',
        firstName: 'Owner',
        lastName: 'User',
      });

    expect(res.status).toBe(201);

    const lookup = await systemQuery(
      db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [email])
    );
    const user = lookup.rows?.[0]?.value;

    expect(user).toBeTruthy();
    expect(user.shop_id).toBeTruthy();

    const shopId = user.shop_id as number;

    const wmsSettings = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).first()
    );
    expect(wmsSettings).toBeDefined();
    expect(wmsSettings?.bootstrap_model).toBe('reconcile_opening_expectation_v2');
  });
});
