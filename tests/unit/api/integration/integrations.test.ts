// tests/unit/api/integration/integrations.test.ts
import request from 'supertest';
import app from '../../../../packages/api/src/server'; 

describe('GET /api/v1/integrations/oauth/initiate', () => {
  it('should return a 200 and an authorizationUrl for Shopify', async () => {
    // Mock environment variables for the test
    process.env.SHOPIFY_API_KEY = 'test_api_key';
    process.env.API_URL = 'http://localhost:3000';

    const res = await request(app).get(
      '/api/v1/integrations/oauth/initiate?platform=shopify&shop=my-store'
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('authorizationUrl');
    expect(res.body.authorizationUrl).toContain('my-store.myshopify.com');
    expect(res.body.authorizationUrl).toContain('client_id=test_api_key');
    expect(res.body.authorizationUrl).toContain('scope=read_products,read_orders,read_inventory');
    expect(res.body.authorizationUrl).toContain('state='); // Check that state is present
  });

  it('should fail with 400 if platform is missing', async () => {
    const res = await request(app).get('/api/v1/integrations/oauth/initiate');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Missing required query param: platform');
  });

  it('should fail with 400 if shop is missing for Shopify', async () => {
    const res = await request(app).get(
      '/api/v1/integrations/oauth/initiate?platform=shopify'
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Missing required query param: shop');
  });
});