// packages/integration-service/__tests__/server.test.ts
import request from 'supertest';
import app from '../../../packages/integration/src/server';
import { createHmac } from 'crypto';
import { fetchRecentOrders } from '../../../packages/integration/src/clients/shopify';

// --- Mocking Setup ---
// We mock the entire db module to control its behavior
const mockInsert = jest.fn().mockReturnThis(); // Mocks the .insert() call and allows chaining
const mockReturning = jest.fn().mockResolvedValue([{ id: 1 }]); // Mocks the .returning() call
jest.mock('../../../packages/integration/src/db', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    insert: mockInsert,
    returning: mockReturning,
  })),
}));

// We mock the queue module to control its behavior
const mockPublishToQueue = jest.fn();
jest.mock('../../../packages/integration/src/queue', () => ({
  __esModule: true,
  publishToQueue: (queueName: string, message: string) => mockPublishToQueue(queueName, message),
  // We also need a mock for connectToQueue so the server doesn't crash on startup
  connectToQueue: jest.fn(),
}));

// Shopify test mock
jest.mock('../../../packages/integration/src/clients/shopify');
const mockedFetchRecentOrders = fetchRecentOrders as jest.Mock;
// --- End Mocking Setup ---

beforeEach(() => {
  // Clear the history of all mocks before each test
  mockInsert.mockClear();
  mockReturning.mockClear();
  mockPublishToQueue.mockClear();
  mockedFetchRecentOrders.mockClear();
});

describe('Shopify Webhook Ingestion', () => {
  it('should return 200 OK, save to DB, and publish to queue for a valid webhook', async () => {
    const fakePayload = { order_id: 12345, customer: { email: 'test@example.com' }};
    const secret = 'my-shopify-webhook-secret';
    process.env.SHOPIFY_WEBHOOK_SECRET = secret;

    const hmac = createHmac('sha256', secret)
      .update(JSON.stringify(fakePayload), 'utf-8')
      .digest('base64');
    
    const response = await request(app)
      .post('/ingest/shopify/1/orders/create')
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(fakePayload);

    expect(response.status).toBe(200);

    // Now we can assert that our more accurate mock was called
    expect(mockInsert).toHaveBeenCalledWith({
      source_platform: 'shopify',
      event_type: 'orders/create',
      raw_payload: fakePayload,
      shop_id: 1 
    });
    
    expect(mockPublishToQueue).toHaveBeenCalledWith('events', JSON.stringify({ staged_event_id: 1 }));
  });

  it('should return 401 Unauthorized for an invalid webhook signature', async () => {
    const fakePayload = { order_id: 12345 };
    
    const response = await request(app)
      .post('/ingest/shopify/1/orders/create')
      .set('X-Shopify-Hmac-Sha256', 'an-invalid-signature')
      .send(fakePayload);

    expect(response.status).toBe(401);
  });
});

describe('POST /integrations/shopify/start-trial-sync', () => {
  it('should call fetchRecentOrders and push results into the pipeline', async () => {
    // 1. SETUP
    const fakeShopId = 1;
    const fakeShop = 'test-shop.myshopify.com';
    const fakeAccessToken = 'test-access-token';
    
    const fakeOrders = [
      { id: 'gid://shopify/Order/123', name: '#1001' },
      { id: 'gid://shopify/Order/124', name: '#1002' },
    ];
    
    // Tell our mocks what to return
    mockedFetchRecentOrders.mockResolvedValue(fakeOrders);

    // 2. EXECUTION
    const response = await request(app)
      .post('/integrations/shopify/start-trial-sync')
      .send({
        shopId: fakeShopId,
        shop: fakeShop,
        accessToken: fakeAccessToken
      });

    // 3. ASSERTION
    expect(response.status).toBe(202); // 202 Accepted is a good status for a long-running job
    expect(response.body).toEqual({ message: 'Scoped trial sync initiated for 2 orders.' });

    // Verify the core logic
    expect(mockedFetchRecentOrders).toHaveBeenCalledWith(fakeShop, fakeAccessToken);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockPublishToQueue).toHaveBeenCalledTimes(2);
  });
});