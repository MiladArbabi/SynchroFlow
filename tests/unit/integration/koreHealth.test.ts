//tests/unit/integration/koreHealth.test.ts
import app from 'api-server'; // Import our express app
import request from 'supertest'; // We'll use supertest for API testing

describe('Kore Health Endpoint (/api/v1/kore/health)', () => {

  it('should return 200 OK and a healthy status', async () => {
    // This request will fail with a 404
    const res = await request(app)
      .get('/api/v1/kore/health')
      .send();

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({
      status: 'healthy',
      services: {
        database: 'connected', // We can add more checks later
      },
    });
  });

});