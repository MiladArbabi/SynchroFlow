// tests/unit/api/integration/product-costs.e2e.test.ts
import request from 'supertest';
import express from 'express';
import productCostsRoutes from '../../../../../packages/api/src/api/product-costs/product-costs.routes';

// Mock the authentication middleware
jest.mock('../../../../../packages/api/src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    // Mock user object with shopId
    req.user = { userId: 1, shopId: 1 };
    next();
  }
}));

// Mock the service
jest.mock('../../../../../packages/api/src/api/product-costs/product-costs.service', () => ({
  getProductCost: jest.fn(),
  upsertProductCost: jest.fn(),
  deleteProductCost: jest.fn()
}));

import {
  getProductCost,
  upsertProductCost,
  deleteProductCost
} from '../../../../../packages/api/src/api/product-costs/product-costs.service';

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
        landed_cost_per_unit: 30.00
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
        .get('/api/v1/product-costs/prod_999')
        .expect(404);
    });
  });

  describe('POST /api/v1/product-costs/:platformProductId', () => {
    it('should create or update product cost', async () => {
      // Arrange
      const mockCost = {
        platform_product_id: 'prod_123',
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00
      };
      (upsertProductCost as jest.Mock).mockResolvedValue(mockCost);

      // Act
      const response = await request(app)
        .post('/api/v1/product-costs/prod_123')
        .send({
          purchase_price: 25.50,
          landed_cost_per_unit: 30.00
        })
        .expect(200);

      // Assert
      expect(response.body).toEqual(mockCost);
      expect(upsertProductCost).toHaveBeenCalledWith('prod_123', 25.50, 30.00);
    });

    it('should return 400 for invalid cost data', async () => {
      // Act & Assert
      await request(app)
        .post('/api/v1/product-costs/prod_123')
        .send({
          purchase_price: -10,
          landed_cost_per_unit: 30.00
        })
        .expect(400);
    });
  });

  describe('DELETE /api/v1/product-costs/:platformProductId', () => {
    it('should delete product cost', async () => {
      // Arrange
      (deleteProductCost as jest.Mock).mockResolvedValue(true);

      // Act & Assert
      await request(app)
        .delete('/api/v1/product-costs/prod_123')
        .expect(204);

      expect(deleteProductCost).toHaveBeenCalledWith('prod_123');
    });

    it('should return 404 when product cost not found', async () => {
      // Arrange
      (deleteProductCost as jest.Mock).mockResolvedValue(false);

      // Act & Assert
      await request(app)
        .delete('/api/v1/product-costs/prod_999')
        .expect(404);
    });
  });
});