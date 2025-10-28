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
// Define mock functions for Knex methods
const mockWhere = jest.fn().mockReturnThis();
const mockFirst = jest.fn();
const mockInsert = jest.fn().mockReturnThis();
const mockReturning = jest.fn();

const mockKnexChain = { // The object returned *after* db('tableName')
  where: mockWhere,
  first: mockFirst,
  insert: mockInsert,
  returning: mockReturning,
};

jest.mock('../../../../packages/api/src/db', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockKnexChain) // Mock db() call to return the chain
}));

// Mock bcrypt for password hashing in tests
jest.mock('bcrypt');
const mockedBcrypt = jest.requireMock('bcrypt');

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
    (db as unknown as jest.Mock).mockClear();
    mockSendToQueue.mockClear();
    mockedBcrypt.hash.mockClear(); // Clear bcrypt mock
    mockWhere.mockClear().mockReturnThis();
    mockFirst.mockClear();
    mockInsert.mockClear().mockReturnThis();
    mockReturning.mockClear();

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

      mockReturning.mockResolvedValue([{ id: 1 }]);

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
      expect(db as unknown as jest.Mock).toHaveBeenCalledWith('integrations');

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

// --- ADD THIS NEW BLOCK ---
describe('POST /api/v1/auth/register', () => {
  const userData = {
    email: 'test@example.com',
    password: 'password123',
  };

  beforeEach(() => {
    mockFirst.mockResolvedValue(null);
    // Mock successful insert returning the new user
    // Default for 'users' table: Mock successful insert returning the new user
    mockReturning.mockImplementation(async () => [{ // Use implementation for flexibility
        id: 1, email: userData.email, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }]);
    // **SPECIFIC MOCK FOR INTEGRATIONS TABLE:** Ensure it returns an array for destructuring
    (db as unknown as jest.Mock).mockImplementation((tableName: string) => {
      if (tableName === 'integrations') {
        mockReturning.mockResolvedValueOnce([{ id: 1 }]); // Return specific shape for integration insert
      }
      return mockKnexChain; // Return the chain for other tables ('users')
    });

    // Mock successful hashing
    mockedBcrypt.hash.mockResolvedValue('hashed_password');
  });

  it('should register a new user successfully', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(userData);

    // --- Assertions for Green Test ---
    expect(res.statusCode).toBe(201); // 201 Created
    expect(res.body).toHaveProperty('id');
    expect(res.body.email).toBe(userData.email);
    expect(res.body).not.toHaveProperty('password_hash'); // Ensure hash isn't returned

    // Verify db interaction
    expect(db).toHaveBeenCalledWith('users'); // Use the imported 'db' which is the mock
    expect(mockWhere).toHaveBeenCalledWith({ email: userData.email.toLowerCase() }); // Check where clause
    expect(mockFirst).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        email: userData.email,
        password_hash: 'hashed_password'
    }));

    // Verify password hashing
    expect(mockedBcrypt.hash).toHaveBeenCalledWith(userData.password, 10);
  });

  it('should fail with 409 Conflict if email is already in use', async () => {
    // Mock db to return an existing user this time
    mockFirst.mockResolvedValue({ id: 2, email: userData.email });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(userData);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('Email already in use.');
  });
});