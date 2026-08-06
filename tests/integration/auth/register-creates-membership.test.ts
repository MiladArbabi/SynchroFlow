import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';

const app = createApp();

describe('Auth registration → membership creation invariants', () => {
  it('creates a shop, an OWNER membership, and issues auth tokens', async () => {
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
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeDefined();

    const users = await systemQuery(db('users').where({ email }));
    expect(users).toHaveLength(1);

    const memberships = await systemQuery(
      db('shop_memberships').where({ user_id: users[0].id })
    );

    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');

    const wmsSettings = await withTenant(memberships[0].shop_id, (trx) =>
      trx('shop_wms_settings').where({ shop_id: memberships[0].shop_id })
    );
    expect(wmsSettings).toHaveLength(1);
  });
});