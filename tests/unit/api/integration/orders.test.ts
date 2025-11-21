// tests/e2e/orders.e2e.test.ts
import request from 'supertest';
import express from 'express';
import ordersRoutes from '../../../../packages/api/src/api/orders/orders.routes'

const app = express();
app.use(express.json());
app.use('/api/v1/orders', ordersRoutes);

describe('Orders API E2E Tests', () => {
  it('GET /api/v1/orders - should return list of orders', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
  });

  it('GET /api/v1/orders/:id - should return order details', async () => {
    // First get the list to find a valid order ID
    const listResponse = await request(app)
      .get('/api/v1/orders')
      .expect(200);

    if (listResponse.body.length === 0) {
      // If no orders, skip this test
      console.log('No orders available for details test');
      return;
    }

    // Use the first order's actual ID
    const validOrderId = listResponse.body[0].id;
    const response = await request(app)
      .get(`/api/v1/orders/${validOrderId}`)
      .expect(200);

    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('customer');
  });

  it('GET /api/v1/orders/:id - should return 404 for non-existent order', async () => {
    await request(app)
      .get('/api/v1/orders/non-existent-order-123')
      .expect(404);
  });

  it('GET /api/v1/orders/:id/profitability - should return profitability data', async () => {
    // First get the list to find a valid order ID
    const listResponse = await request(app)
      .get('/api/v1/orders')
      .expect(200);

    if (listResponse.body.length === 0) {
      // If no orders, skip this test
      console.log('No orders available for profitability test');
      return;
    }

    // Use the first order's actual ID
    const validOrderId = listResponse.body[0].id;
    const response = await request(app)
      .get(`/api/v1/orders/${validOrderId}/profitability`)
      .expect(200);

    expect(response.body).toHaveProperty('orderId');
    expect(response.body).toHaveProperty('margin');
  });
});