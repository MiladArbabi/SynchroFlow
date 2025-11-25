// tests/unit/api/integration/product-costs.db.test.ts - UPDATED:

import request from 'supertest';
import express from 'express';
import productCostsRoutes from 'api-src/api/product-costs/product-costs.routes';
import db from 'api-src/db';

// Mock the authentication middleware
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 1, shopId: 1 };
    next();
  }
}));

// Create test app with product-costs routes
const app = express();
app.use(express.json());
app.use('/api/v1/product-costs', productCostsRoutes);

describe('Product Costs API Database Integration Tests', () => {
  beforeEach(async () => {
    // Clean up product_costs table before each test
    await db('product_costs').del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should create and retrieve product cost from database', async () => {
    const costData = {
        platform_product_id: 'test-prod-123',
        purchase_price: 20,
        landed_cost_per_unit: 27,
        // Remove selling_price - backend doesn't store it
        currency: 'USD'
    };

    const createResponse = await request(app)
        .post('/api/v1/product-costs/test-prod-123')
        .send(costData);

    expect(createResponse.status).toBe(200);

    const getResponse = await request(app)
        .get('/api/v1/product-costs/test-prod-123');

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.platform_product_id).toBe('test-prod-123');
    expect(parseFloat(getResponse.body.landed_cost_per_unit)).toBe(27);
    expect(parseFloat(getResponse.body.purchase_price)).toBe(20);
    // Don't check selling_price - backend doesn't return it
    });

    it('should update existing product cost in database', async () => {
    const initialData = {
        platform_product_id: 'test-prod-456',
        purchase_price: 15,
        landed_cost_per_unit: 20,
        currency: 'USD'
    };

    await request(app)
        .post('/api/v1/product-costs/test-prod-456')
        .send(initialData);

    const updatedData = {
        platform_product_id: 'test-prod-456',
        purchase_price: 18,
        landed_cost_per_unit: 25,
        currency: 'USD'
    };

    const updateResponse = await request(app)
        .post('/api/v1/product-costs/test-prod-456')
        .send(updatedData);

    expect(updateResponse.status).toBe(200);

    const getResponse = await request(app)
        .get('/api/v1/product-costs/test-prod-456');

    expect(parseFloat(getResponse.body.purchase_price)).toBe(18);
    expect(parseFloat(getResponse.body.landed_cost_per_unit)).toBe(25);
    // Don't check selling_price - backend doesn't return it
    });
});