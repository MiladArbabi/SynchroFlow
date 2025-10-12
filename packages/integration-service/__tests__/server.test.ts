// packages/integration-service/__tests__/server.test.ts
import request from 'supertest';
import app from '../src/server';
import { createHmac } from 'crypto';

// --- Mocking Setup ---
// We mock the entire db module to control its behavior
const mockInsert = jest.fn().mockReturnThis(); // Mocks the .insert() call and allows chaining
const mockReturning = jest.fn().mockResolvedValue([{ id: 1 }]); // Mocks the .returning() call
jest.mock('../src/db', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    insert: mockInsert,
    returning: mockReturning,
  })),
}));

// We mock the queue module to control its behavior
const mockPublishToQueue = jest.fn();
jest.mock('../src/queue', () => ({
  __esModule: true,
  publishToQueue: (queueName: string, message: string) => mockPublishToQueue(queueName, message),
  // We also need a mock for connectToQueue so the server doesn't crash on startup
  connectToQueue: jest.fn(),
}));
// --- End Mocking Setup ---


describe('Shopify Webhook Ingestion', () => {

  it('should return 200 OK, save to DB, and publish to queue for a valid webhook', async () => {
    const fakePayload = { order_id: 12345, customer: { email: 'test@example.com' }};
    const secret = 'my-shopify-webhook-secret';
    process.env.SHOPIFY_WEBHOOK_SECRET = secret;

    const hmac = createHmac('sha256', secret)
      .update(JSON.stringify(fakePayload), 'utf-8')
      .digest('base64');
    
    const response = await request(app)
      .post('/ingest/shopify/orders/create')
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(fakePayload);

    expect(response.status).toBe(200);

    // Now we can assert that our more accurate mock was called
    expect(mockInsert).toHaveBeenCalledWith({
      source_platform: 'shopify',
      event_type: 'orders/create',
      raw_payload: fakePayload, // Check the parsed payload
    });
    
    expect(mockPublishToQueue).toHaveBeenCalledWith('events', JSON.stringify({ staged_event_id: 1 }));
  });

  it('should return 401 Unauthorized for an invalid webhook signature', async () => {
    const fakePayload = { order_id: 12345 };
    
    const response = await request(app)
      .post('/ingest/shopify/orders/create')
      .set('X-Shopify-Hmac-Sha256', 'an-invalid-signature')
      .send(fakePayload);

    expect(response.status).toBe(401);
  });
  
});