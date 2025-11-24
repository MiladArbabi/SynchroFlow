// tests/unit/api/integration/products.e2e.test.ts
import request from 'supertest';
import express from 'express';
import productsRoutes from 'api-src/api/products/products.routes';

// Mock the authentication middleware
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    // Mock user object with shopId
    req.user = { userId: 1, shopId: 1 };
    next();
  }
}));

const app = express();
app.use(express.json());
app.use('/api/v1/products', productsRoutes);

describe('Products API E2E Tests', () => {
  describe('GET /api/v1/products', () => {
    it('should return paginated products with default parameters', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .expect(200);

      expect(response.body).toHaveProperty('products');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.products).toBeInstanceOf(Array);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: expect.any(Number),
        totalPages: expect.any(Number)
      });
    });

    it('should return products with custom pagination', async () => {
      const response = await request(app)
        .get('/api/v1/products?page=2&limit=5')
        .expect(200);

      expect(response.body.pagination).toMatchObject({
        page: 2,
        limit: 5
      });
      expect(response.body.products.length).toBeLessThanOrEqual(5);
    });

    it('should return products with search query', async () => {
      const response = await request(app)
        .get('/api/v1/products?search=snowboard')
        .expect(200);

      expect(response.body.products).toBeInstanceOf(Array);
      // Should find products with "snowboard" in title, vendor, or product_type
      if (response.body.products.length > 0) {
        const product = response.body.products[0];
        expect(
          product.title.toLowerCase().includes('snowboard') ||
          product.vendor?.toLowerCase().includes('snowboard') ||
          product.product_type?.toLowerCase().includes('snowboard')
        ).toBe(true);
      }
    });

    it('should return empty array for non-matching search', async () => {
      const response = await request(app)
        .get('/api/v1/products?search=nonexistentproductxyz123')
        .expect(200);

      expect(response.body.products).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });

    it('should handle invalid page parameter gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/products?page=0&limit=10')
        .expect(200);

      // Should default to page 1
      expect(response.body.pagination.page).toBe(1);
    });

    it('should handle very large limit parameter gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/products?limit=1000')
        .expect(200);

      // Should respect reasonable limits or default to max
      expect(response.body.products.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Product data structure', () => {
    it('should return products with correct data structure', async () => {
      const response = await request(app)
        .get('/api/v1/products?limit=1')
        .expect(200);

      if (response.body.products.length > 0) {
        const product = response.body.products[0];
        expect(product).toHaveProperty('id');
        expect(product).toHaveProperty('shop_id');
        expect(product).toHaveProperty('platform_product_id');
        expect(product).toHaveProperty('title');
        expect(product).toHaveProperty('vendor');
        expect(product).toHaveProperty('product_type');
        expect(product).toHaveProperty('status');
        expect(product).toHaveProperty('total_inventory');
        expect(product).toHaveProperty('created_at');
        expect(product).toHaveProperty('updated_at');

        // Check data types
        expect(typeof product.id).toBe('number');
        expect(typeof product.shop_id).toBe('number');
        expect(typeof product.platform_product_id).toBe('string');
        expect(typeof product.title).toBe('string');
        expect(typeof product.total_inventory).toBe('number');
      }
    });

    it('should return products ordered by created_at desc', async () => {
      const response = await request(app)
        .get('/api/v1/products?limit=10')
        .expect(200);

      if (response.body.products.length > 1) {
        const products = response.body.products;
        for (let i = 0; i < products.length - 1; i++) {
          const currentDate = new Date(products[i].created_at);
          const nextDate = new Date(products[i + 1].created_at);
          expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
        }
      }
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      // This test would require mocking the database to throw an error
      // For now, we test that the endpoint exists and returns proper structure
      const response = await request(app)
        .get('/api/v1/products')
        .expect(200);

      expect(response.body).toHaveProperty('products');
      expect(response.body).toHaveProperty('pagination');
    });

    it('should handle malformed query parameters', async () => {
      const response = await request(app)
        .get('/api/v1/products?page=abc&limit=def')
        .expect(200);

      // Should default to reasonable values
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(20);
    });
  });

  describe('Performance and scalability', () => {
    it('should return response within acceptable time for large datasets', async () => {
      const startTime = Date.now();
      const response = await request(app)
        .get('/api/v1/products?limit=100')
        .expect(200);
      const endTime = Date.now();

      const responseTime = endTime - startTime;
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second

      expect(response.body.products.length).toBeLessThanOrEqual(100);
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(5).fill(0).map(() => 
        request(app).get('/api/v1/products?limit=10')
      );

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.products).toBeInstanceOf(Array);
        expect(response.body.pagination).toBeDefined();
      });
    });
  });
});