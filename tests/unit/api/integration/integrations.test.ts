// tests/unit/api/integration/integrations.test.ts
import request from 'supertest';
import app from '../../../../packages/api/src/server';
import axios from 'axios';
import db from '../../../../packages/api/src/db';
// Mock the queue module to spy on sendToQueue
import * as queue from 'api-src/queue';;

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock the db
jest.mock('../../../../packages/api/src/db', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    insert: jest.fn(() => ({
      returning: jest.fn(() => Promise.resolve([{ id: 1 }]))
    })),
  }))
}));
const mockedDb = db as unknown as jest.Mock;

// Mock the queue module
const mockSendToQueue = jest.fn(() => true);
jest.mock('api-src/queue', () => ({
  ...jest.requireActual('api-src/queue'), // Keep actual connection logic
  getQueueChannel: jest.fn(),
}));
const mockedQueue = queue as jest.Mocked<typeof queue>;

describe('OAuth Integration Flow', () => {
  // Set mock env vars
  process.env.SHOPIFY_API_KEY = 'test_api_key';
  process.env.SHOPIFY_API_SECRET = 'test_api_secret';
  process.env.API_URL = 'http://localhost:3000';
  process.env.ENCRYPTION_KEY = 'test_encryption_key_32_chars_long';

  beforeEach(() => {
    mockedAxios.post.mockClear();
    mockedDb.mockClear();
    mockSendToQueue.mockClear();

    mockedQueue.getQueueChannel.mockReturnValue({
      sendToQueue: mockSendToQueue,
    } as any);
  });

  describe('GET /api/v1/integrations/oauth/initiate', () => {
    it('should return a 200 and an authorizationUrl for Shopify', async () => {
       const res = await request(app).get(
        '/api/v1/integrations/oauth/initiate?platform=shopify&shop=my-store'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('authorizationUrl');
    });
  });

describe('GET /api/v1/integrations/oauth/callback/shopify', () => {
    
    it('should fail with 403 Forbidden if state is invalid', async () => {
      // We call the callback directly with a bad state
      const res = await request(app)
        .get(
          '/api/v1/integrations/oauth/callback/shopify?code=test_code&state=invalid_state'
        );

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Invalid CSRF state token.');
    });

    it('should succeed (302 Redirect) with a valid state and code', async () => {
      // 1. Create an agent to persist session cookies
      const agent = request.agent(app);

      // 2. Call /initiate to populate the session
      const initRes = await agent
        .get('/api/v1/integrations/oauth/initiate?platform=shopify&shop=my-store')
        .expect(200);

      // 3. Extract the valid 'state' token from the URL
      const url = new URL(initRes.body.authorizationUrl.replace('{shop}', 'my-store'));
      const validState = url.searchParams.get('state');

      // 4. Mock the successful Shopify token exchange
      mockedAxios.post.mockResolvedValue({
        data: {
          access_token: 'fake_shopify_access_token'
        }
      });

      // 5. Call the /callback with the agent (which has the cookie) and valid state
      const callbackRes = await agent
        .get(
          `/api/v1/integrations/oauth/callback/shopify?code=test_code&state=${validState}&shop=my-store`
        );
      
      // 6. Assertions
      expect(callbackRes.statusCode).toBe(302); // 302 Redirect
      expect(callbackRes.headers.location).toBe('http://localhost:5173/dashboard?connect=success');

      // 7. Verify token exchange and DB insert happened
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://my-store/admin/oauth/access_token',
        {
          client_id: 'test_api_key',
          client_secret: 'test_api_secret',
          code: 'test_code',
        }
      );
      expect(mockedDb).toHaveBeenCalledWith('integrations');

      // --- THIS IS THE "RED" ASSERTION ---
      // 8. Verify it was queued
      expect(mockedQueue.getQueueChannel).toHaveBeenCalledWith('sync_jobs');
      expect(mockSendToQueue).toHaveBeenCalledWith(
        'sync_jobs',
        Buffer.from(JSON.stringify({ integrationId: 1 }))
      );
    });
  });
});