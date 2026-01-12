import request from 'supertest';
import db from 'api-db';
import app from 'api-server';
import crypto from 'crypto';

const TEST_EVENT_ID = crypto.randomUUID();

describe('FT2 route authorization', () => {
  const userId = 3;
  const shopId = 30;

  beforeEach(async () => {
    await db('user_lifecycle_snapshot').truncate();
    await db('ft2_state').truncate();
  });

  it('returns 403 if lifecycle is FT1 without FT2 seal', async () => {
    await db('user_lifecycle_snapshot').insert({
      user_id: userId,
      shop_id: shopId,
      phase: 'FT1',
      since: db.fn.now(),
      last_event_id: TEST_EVENT_ID,
    });

    const res = await request(app)
      .get('/api/v1/dashboard/ft2')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(403);
  });
});