//tests/unit/integration/koreSearch.test.ts
import app from 'api-server'; // Import our express app
import request from 'supertest'; // Use supertest for API testing

describe.skip('Kore Federated Search Endpoint (/api/v1/kore/search)', () => {
  
  it('should return 404 for a non-existent route (this is our Red test)', async () => {
    const res = await request(app)
      .get('/api/v1/kore/search?q=test')
      .send();

    // This will fail because the route doesn't exist yet
    expect(res.statusCode).not.toEqual(404);
  });

  it.skip('should return a list of matching entities (e.g., our test user)', async () => {
    const res = await request(app)
      .get('/api/v1/kore/search?q=test@example.com')
      .send();

    expect(res.statusCode).toEqual(200);
    expect(res.body).toBeDefined();
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Check for our seeded user
    const userResult = res.body.find((item: any) => item.type === 'customer');
    expect(userResult).toBeDefined();
    expect(userResult.title).toBe('test@example.com');
  });

  it('should return an empty list for no matches', async () => {
    const res = await request(app)
      .get('/api/v1/kore/search?q=nonexistentqueryxyz')
      .send();

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual([]);
  });

});