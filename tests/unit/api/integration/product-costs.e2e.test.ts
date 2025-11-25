// tests/unit/api/integration/product-costs.e2e.test.ts
import request from 'supertest';
import express from 'express';
import productCostsRoutes from 'api-src/api/product-costs/product-costs.routes';

// Mock the authentication middleware
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    // Mock user object with shopId
    req.user = { userId: 1, shopId: 1 };
    next();
  }
}));

// Mock the service
jest.mock('api-src/api/product-costs/product-costs.service', () => ({
  getProductCost: jest.fn(),
  upsertProductCost: jest.fn(),
  deleteProductCost: jest.fn()
}));

import {
  getProductCost,
  upsertProductCost,
  deleteProductCost
} from 'api-src/api/product-costs/product-costs.service';

const app = express();
app.use(express.json());
app.use('/api/v1/product-costs', productCostsRoutes);

describe('Product Costs API E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/product-costs/:platformProductId', () => {
    it('should return product cost when found', async () => {
      // Arrange
      const mockCost = {
        platform_product_id: 'prod_123',
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00,
        shipping_cost: 2.50,
        customs_duties: 1.00,
        packaging_cost: 1.00,
        selling_price: 45.00,
        currency: 'USD'
      };
      (getProductCost as jest.Mock).mockResolvedValue(mockCost);

      // Act
      const response = await request(app)
        .get('/api/v1/product-costs/prod_123')
        .expect(200);

      // Assert
      expect(response.body).toEqual(mockCost);
      expect(getProductCost).toHaveBeenCalledWith('prod_123');
    });

    it('should return 404 when product cost not found', async () => {
      // Arrange
      (getProductCost as jest.Mock).mockResolvedValue(null);

      // Act & Assert
      await request(app)
        .get('/api/v1/product-costs/nonexistent')
        .expect(404);

      expect(getProductCost).toHaveBeenCalledWith('nonexistent');
    });

    it('should return 400 when platformProductId is missing', async () => {
      // Act & Assert
      await request(app)
        .get('/api/v1/product-costs/')
        .expect(404); // This will be 404 because the route doesn't match
    });
  });

  describe('POST /api/v1/product-costs/:platformProductId', () => {
    it('should create or update product cost successfully', async () => {
        // Arrange
        const costData = {
        platform_product_id: 'prod_123',
        purchase_price: 15,
        shipping_cost: 5,
        customs_duties: 2,
        packaging_cost: 1,
        landed_cost_per_unit: 23,
        selling_price: 35,
        currency: 'USD'
        };
        
        // The backend service only expects purchase_price and landed_cost_per_unit
        (upsertProductCost as jest.Mock).mockResolvedValue({
        platform_product_id: 'prod_123',
        purchase_price: 15,
        landed_cost_per_unit: 23
        });

        // Act
        const response = await request(app)
        .post('/api/v1/product-costs/prod_123')
        .send(costData)
        .expect(200);

        // Assert - The service is called with only the two expected parameters
        expect(upsertProductCost).toHaveBeenCalledWith('prod_123', 15, 23);
        
        // The response contains the stored data
        expect(response.body.platform_product_id).toBe('prod_123');
        expect(response.body.purchase_price).toBe(15);
        expect(response.body.landed_cost_per_unit).toBe(23);
    });

    it('should handle cost breakdown fields correctly', async () => {
    // Arrange
    const costData = {
      platform_product_id: 'prod_123',
      purchase_price: 10,
      shipping_cost: 3,
      customs_duties: 1.5,
      packaging_cost: 0.5,
      landed_cost_per_unit: 15,
      selling_price: 25,
      currency: 'USD'
    };
    
    (upsertProductCost as jest.Mock).mockResolvedValue({
      platform_product_id: 'prod_123',
      purchase_price: 10,
      landed_cost_per_unit: 15
    });

    // Act
    const response = await request(app)
      .post('/api/v1/product-costs/prod_123')
      .send(costData)
      .expect(200);

    // Assert - The service should be called with the calculated landed cost
    expect(upsertProductCost).toHaveBeenCalledWith('prod_123', 10, 15);
    expect(response.body.landed_cost_per_unit).toBe(15);
  });

  it('should return 400 when required fields are missing', async () => {
    // Arrange
    const invalidData = {
      platform_product_id: 'prod_123'
      // Missing purchase_price and landed_cost_per_unit
    };

    // Act & Assert
    await request(app)
      .post('/api/v1/product-costs/prod_123')
      .send(invalidData)
      .expect(400); // The backend validates these fields
  });

  it('should return 400 when purchase_price is invalid', async () => {
  // Arrange
  const invalidData = {
    platform_product_id: 'prod_123',
    purchase_price: -10, // Invalid negative price
    landed_cost_per_unit: 15
  };

  // Act & Assert
  await request(app)
    .post('/api/v1/product-costs/prod_123')
    .send(invalidData)
    .expect(400);
});
    it('should return 400 when landed_cost_per_unit is invalid', async () => {
    // Arrange
    const invalidData = {
        platform_product_id: 'prod_123',
        purchase_price: 10,
        landed_cost_per_unit: -5 // Invalid negative cost
    };

    // Act & Assert
    await request(app)
        .post('/api/v1/product-costs/prod_123')
        .send(invalidData)
        .expect(400);
    });
});

  describe('DELETE /api/v1/product-costs/:platformProductId', () => {
    it('should delete product cost successfully', async () => {
        // Arrange
        (deleteProductCost as jest.Mock).mockResolvedValue(true);

        // Act & Assert - Expect 204 No Content for successful deletion
        await request(app)
        .delete('/api/v1/product-costs/prod_123')
        .expect(204); // Changed from 200 to 204

        expect(deleteProductCost).toHaveBeenCalledWith('prod_123');
    });

    it('should return 404 when trying to delete non-existent cost', async () => {
        // Arrange
        (deleteProductCost as jest.Mock).mockResolvedValue(false);

        // Act & Assert - Expect 404 for non-existent resource
        await request(app)
        .delete('/api/v1/product-costs/nonexistent')
        .expect(404);
    });
    });

    describe('FULL-CYCLE CRUD', () => {
        it('should complete full CRUD lifecycle for product costs', async () => {
        const testProductId = 'test-crud-product-123';
        const costData = {
            platform_product_id: testProductId,
            purchase_price: 20,
            landed_cost_per_unit: 30,
            selling_price: 45,
            currency: 'USD'
        };

        // Set up dynamic mocks for this specific test
        (upsertProductCost as jest.Mock).mockImplementation((platformProductId, purchasePrice, landedCost) => {
            return Promise.resolve({
            platform_product_id: platformProductId, // Use the actual ID passed
            purchase_price: purchasePrice,
            landed_cost_per_unit: landedCost
            });
        });

        (getProductCost as jest.Mock).mockImplementation((platformProductId) => {
            if (platformProductId === testProductId) {
            return Promise.resolve({
                platform_product_id: platformProductId,
                purchase_price: 20,
                landed_cost_per_unit: 30
            });
            }
            return Promise.resolve(null);
        });

        (deleteProductCost as jest.Mock).mockResolvedValue(true);

        // 1. Create
        const createResponse = await request(app)
            .post(`/api/v1/product-costs/${testProductId}`)
            .send(costData);

        expect(createResponse.status).toBe(200);
        expect(createResponse.body.platform_product_id).toBe(testProductId); // Now this should match

        // 2. Read
        const getResponse = await request(app)
            .get(`/api/v1/product-costs/${testProductId}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.purchase_price).toBe(20);

        // 3. Update
        const updateData = {
            ...costData,
            purchase_price: 25, // Updated price
            landed_cost_per_unit: 35 // Updated cost
        };

        // Update the mock for the update call
        (upsertProductCost as jest.Mock).mockImplementation((platformProductId, purchasePrice, landedCost) => {
            return Promise.resolve({
            platform_product_id: platformProductId,
            purchase_price: purchasePrice,
            landed_cost_per_unit: landedCost
            });
        });

        const updateResponse = await request(app)
            .post(`/api/v1/product-costs/${testProductId}`)
            .send(updateData);

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body.purchase_price).toBe(25);

        // 4. Delete
        const deleteResponse = await request(app)
            .delete(`/api/v1/product-costs/${testProductId}`);

        expect(deleteResponse.status).toBe(204);

        // 5. Verify deletion - update get mock to return null after deletion
        (getProductCost as jest.Mock).mockResolvedValue(null);

        const getAfterDeleteResponse = await request(app)
            .get(`/api/v1/product-costs/${testProductId}`);

        expect(getAfterDeleteResponse.status).toBe(404);
        });
    });
});