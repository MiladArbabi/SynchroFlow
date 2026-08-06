import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery } from '@lasyncro/backend-core/db.js'

const app = createApp();

describe('Auth registration → auth side-effects', () => {
  it('issues access and refresh tokens on registration', async () => {
    const email = `owner+${crypto.randomBytes(4).toString('hex')}@test.com`;

  it('issues access and refresh tokens on registration', async () => {
    const email = `owner+${crypto.randomBytes(4).toString('hex')}@test.com`;
    const agent = request.agent(app);
    const res = await agent
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

    const user = await systemQuery(
      db('users').where({ email }).first()
    );
    expect(user).toBeDefined();

    const refreshTokens = await systemQuery(
      db('refresh_tokens').where({ user_id: user.id })
    );

    expect(refreshTokens).toHaveLength(1);
  });
});