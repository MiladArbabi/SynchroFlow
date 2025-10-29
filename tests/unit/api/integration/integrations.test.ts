// packages/api/src/api/auth/auth.controller.ts
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

// Mock the layout controller to spy on its methods if needed (optional)
// jest.mock('api-src/api/layouts/layout.controller');

// Mock jsonwebtoken
jest.mock('jsonwebtoken');
const mockedJwt = jest.requireMock('jsonwebtoken')

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
    mockedBcrypt.hash.mockClear(); 
    mockedBcrypt.compare.mockClear();
    mockedJwt.verify.mockClear();
    mockedJwt.sign.mockClear()
    mockWhere.mockClear().mockReturnThis();
    mockFirst.mockClear();
    mockInsert.mockClear().mockReturnThis();
    mockReturning.mockClear();

    // Reset implementation for flexibility in tests
    (db as unknown as jest.Mock).mockImplementation(() => mockKnexChain);

    // Default mock for user lookup (needed for middleware pass-through)
    mockFirst.mockResolvedValue({ id: 1, shop_id: 5 }); // Default user
    mockedQueue.getQueueChannel.mockReturnValue({
      sendToQueue: mockSendToQueue,
    } as any);
  });

  describe('GET /api/v1/integrations/oauth/initiate', () => {
    it('should return 401 Unauthorized without a valid token', async () => {
      const res = await request(app).get(
        '/api/v1/integrations/oauth/initiate?platform=shopify&shop=my-store'
      );
      expect(res.statusCode).toBe(401);
    });

    it('should return 200 and store user_id in session with a valid token', async () => {
      // Mock JWT verify to pass and provide user ID
      const mockUserId = 5;
      mockedJwt.verify.mockImplementation((_token: any, _secret: any, callback: (arg0: null, arg1: { userId: number; }) => void) => {
        callback(null, { userId: mockUserId });
      });

      // Use agent to capture session changes
      const agent = request.agent(app);
      const res = await agent.get(
        '/api/v1/integrations/oauth/initiate?platform=shopify&shop=my-store'
      )
      .set('Authorization', 'Bearer fake_valid_token'); // Send token

       expect(res.statusCode).toBe(200);
       expect(res.body).toHaveProperty('authorizationUrl');
      // **RED ASSERTION:** We need to check the session, but supertest doesn't expose it directly.
      // We'll rely on the next step (callback) implicitly testing this was stored correctly.
     });
  });

describe('GET /api/v1/integrations/oauth/callback/shopify', () => {
    
    it('should fail with 403 Forbidden if state is invalid', async () => {
      // 1. Create an agent to persist session cookies
      const agent = request.agent(app);

      // 2. Mock JWT verification for the /initiate call
      const mockUserId = 1;
      mockedJwt.verify.mockImplementation((_token: any, _secret: any, callback: (arg0: null, arg1: { userId: number; }) => void) => {
        callback(null, { userId: mockUserId }); // Simulate successful verification
      });

      // 3. Call /initiate to set up a VALID session (with user_id and state)
      await agent
        .get('/api/v1/integrations/oauth/initiate?platform=shopify&shop=my-store')
        .set('Authorization', 'Bearer fake_valid_token')
        .expect(200);

      // 4. Call /callback with the valid session, but an INVALID state
      const res = await agent
        .get(
          `/api/v1/integrations/oauth/callback/shopify?code=test_code&state=THIS_IS_THE_WRONG_STATE&shop=my-store`
        );

      // 5. Assert it fails at the state check, not the user_id check
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Invalid CSRF state token.');
    });

    it('should succeed (302 Redirect) with a valid state and code', async () => {
      // 1. Create an agent to persist session cookies
      const agent = request.agent(app);

      // Mock JWT verification for the /initiate call
      const mockUserId = 1;
      const mockUserShopId = 5; // Give this user a shop ID
      mockFirst.mockResolvedValue({ id: mockUserId, shop_id: mockUserShopId }); // Mock user lookup for callback

      // Mock the user lookup in the callback
      mockFirst.mockImplementation(async () => ({
        id: mockUserId, shop_id: mockUserShopId
      }));

      mockedJwt.verify.mockImplementation((_token: any, _secret: any, callback: (arg0: null, arg1: { userId: number; }) => void) => {
        callback(null, { userId: mockUserId }); // Simulate successful verification
      });

      // 2. Call /initiate to populate the session
      const initRes = await agent
        .get('/api/v1/integrations/oauth/initiate?platform=shopify&shop=my-store')
        .set('Authorization', 'Bearer fake_valid_token')
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
      
      // --- THIS IS THE "GREEN" ASSERTION ---
      // We check that the 'insert' call now contains the user's *shop_id*
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        shop_id: mockUserShopId // Expecting shop_id: 5 (from our mock user)
      }));

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

  describe('POST /api/v1/auth/login', () => {
  const loginData = {
    email: 'test@example.com',
    password: 'password123',
  };
  const mockUser = {
    id: 1,
    email: loginData.email,
    password_hash: 'hashed_password',
  };

  beforeEach(() => {
    // Default: Mock finding the user
    mockFirst.mockResolvedValue(mockUser);
    // Default: Mock correct password
    mockedBcrypt.compare.mockResolvedValue(true);
    // Mock successful JWT signing (will be called twice)
    mockedJwt.sign
      .mockReturnValueOnce('fake_jwt_token') // First call is access token
      .mockReturnValueOnce('fake_refresh_token'); // Second call is refresh token
  });

  it('should login successfully with correct credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(loginData);

    expect(res.statusCode).toBe(200); // Should still be 200 OK
    expect(res.body).toHaveProperty('accessToken', 'fake_jwt_token'); // Expect access token in body
    expect(res.body).not.toHaveProperty('refreshToken'); // Refresh token should NOT be in body

    // --- RED ASSERTION: Check for HttpOnly cookie ---
    expect(res.headers['set-cookie']).toBeDefined();
    const cookieString = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'][0] : res.headers['set-cookie'];
    expect(cookieString).toMatch(/refreshToken=fake_refresh_token;/); // Check for cookie name and value
    expect(cookieString).toMatch(/HttpOnly/);
    expect(cookieString).toMatch(/SameSite=Strict/);
    // Note: 'Secure' flag might not be set in http test environment, depends on supertest/express setup

    // Verify db and bcrypt calls
    expect(db).toHaveBeenCalledWith('users');
    expect(mockWhere).toHaveBeenCalledWith({ email: loginData.email.toLowerCase() });
    expect(mockFirst).toHaveBeenCalled();
    expect(mockedBcrypt.compare).toHaveBeenCalledWith(loginData.password, mockUser.password_hash);
    // Check Access Token signing
    expect(mockedJwt.sign).toHaveBeenCalledWith({ userId: mockUser.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    // Check Refresh Token signing (assuming JWT_REFRESH_SECRET falls back to JWT_SECRET in test)
    expect(mockedJwt.sign).toHaveBeenCalledWith({ userId: mockUser.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  });

  it('should fail with 401 Unauthorized if user not found', async () => {
    mockFirst.mockResolvedValue(null); // Override mock: user doesn't exist
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(loginData);
    expect(res.statusCode).toBe(401);
  });

  it('should fail with 401 Unauthorized if password is incorrect', async () => {
    mockedBcrypt.compare.mockResolvedValue(false); // Override mock: wrong password
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(loginData);
    expect(res.statusCode).toBe(401);
    });
  });

  describe('Protected Routes Middleware', () => {
  // We'll use the layouts endpoint as our test case
  const layoutsUrl = '/api/v1/layouts/dashboard';
  const mockUserId = 1;
  const mockUserShopId = 5;
  const mockLayoutData = { layout: [{ i: 'a', x: 0, y: 0, w: 1, h: 1 }], activeWidgets: [{ instanceId: 'a', widgetId: 'b' }] };
  const mockIntegrationData = { id: 1, platform: 'shopify' };

  beforeEach(() => {
  // Reset mocks specifically for layout tests
    mockFirst.mockClear();
    mockWhere.mockClear().mockReturnThis();
    (db as unknown as jest.Mock).mockClear();

    // Mock JWT verification to succeed by default for these tests
    mockedJwt.verify.mockImplementation((_token: any, _secret: any, callback: (arg0: null, arg1: { userId: number; }) => void) => {
      callback(null, { userId: mockUserId });
    });

    // Mock the user lookup that happens first in the controller
    (db as unknown as jest.Mock).mockImplementation((tableName: string) => {
      if (tableName === 'users') {
        mockFirst.mockResolvedValueOnce({ id: mockUserId, shop_id: mockUserShopId });
      }
      return mockKnexChain;
    });
  });

  it('GET /layouts/dashboard should return 401 Unauthorized without a valid token', async () => {
    mockedJwt.verify.mockImplementation((_token: any, _secret: any, callback: (arg0: Error, arg1: undefined) => void) => {
       callback(new Error('test invalid token'), undefined); // Simulate JWT failure
    });

    const res = await request(app)
      .get(layoutsUrl);
    // This is the RED TEST - it will currently return 404 or 200, not 401
    expect(res.statusCode).toBe(401);
    // Note: Our middleware currently returns 403 on invalid token, test reflects that
    // expect(res.statusCode).toBe(401); // Or 403 depending on middleware exact logic
  });

    it('GET /layouts/dashboard should return 200 OK with layout data if found', async () => {
    // Mock finding the layout for the user's shop
    (db as unknown as jest.Mock).mockImplementation((tableName: string) => {
      if (tableName === 'users') mockFirst.mockResolvedValueOnce({ id: mockUserId, shop_id: mockUserShopId });
      if (tableName === 'layouts') mockFirst.mockResolvedValueOnce(mockLayoutData);
      return mockKnexChain;
    });

    const res = await request(app)
      .get(layoutsUrl)
      .set('Authorization', 'Bearer fake_valid_token');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(mockLayoutData);
    expect(db).toHaveBeenCalledWith('layouts');
    expect(mockWhere).toHaveBeenCalledWith({ shop_id: mockUserShopId, name: 'dashboard' });
  });

  it('GET /layouts/dashboard should return 200 OK (default) if layout NOT found but integrations EXIST', async () => {
    // Mock finding NO layout but YES integrations for the user's shop
    (db as unknown as jest.Mock).mockImplementation((tableName: string) => {
      if (tableName === 'users') mockFirst.mockResolvedValueOnce({ id: mockUserId, shop_id: mockUserShopId });
      if (tableName === 'layouts') mockFirst.mockResolvedValueOnce(null); // No layout
      if (tableName === 'integrations') mockFirst.mockResolvedValueOnce(mockIntegrationData); // Yes integration
      return mockKnexChain;
    });

    const res = await request(app)
      .get(layoutsUrl)
      .set('Authorization', 'Bearer fake_valid_token');

    expect(res.statusCode).toBe(200); // Expect 200 as per #379
    expect(res.body).toEqual({ layout: [], activeWidgets: [] }); // Expect default structure
    expect(db).toHaveBeenCalledWith('layouts');
    expect(db).toHaveBeenCalledWith('integrations');
    expect(mockWhere).toHaveBeenCalledWith({ shop_id: mockUserShopId }); // Check integration query
  });

  it('GET /layouts/dashboard should return 404 if layout AND integrations NOT found', async () => {
    // Mock finding NO layout AND NO integrations for the user's shop
    (db as unknown as jest.Mock).mockImplementation((tableName: string) => {
      if (tableName === 'users') mockFirst.mockResolvedValueOnce({ id: mockUserId, shop_id: mockUserShopId });
      if (tableName === 'layouts') mockFirst.mockResolvedValueOnce(null); // No layout
      if (tableName === 'integrations') mockFirst.mockResolvedValueOnce(null); // No integration
      return mockKnexChain;
    });

    // 1. Mock JWT verification to succeed
    const mockUserId = 1;
    mockedJwt.verify.mockImplementation((_token: any, _secret: any, callback: (arg0: null, arg1: { userId: number; }) => void) => {
      callback(null, { userId: mockUserId }); // Simulate successful verification
    });

    // 2. Make request with a dummy token (verification is mocked anyway)
    const res = await request(app)
      .get(layoutsUrl)
      .set('Authorization', 'Bearer fake_valid_token');

    // This is the RED TEST - Controller doesn't implement the logic yet
    expect(res.statusCode).toBe(404);
    expect(db).toHaveBeenCalledWith('layouts');
    expect(db).toHaveBeenCalledWith('integrations');;
    });
  });

  describe('POST /api/v1/auth/refresh_token', () => {
  const mockUserId = 1;
  const validRefreshToken = 'valid_refresh_token_value';
  const newAccessToken = 'new_access_token_value';

  beforeEach(() => {
    // Reset JWT mocks for refresh tests
    mockedJwt.verify.mockClear();
    mockedJwt.sign.mockReset();

    // Default: Mock successful refresh token verification
    mockedJwt.verify.mockImplementation((token: string, secret: any, callback: any) => {
      const expectedSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      if (token === validRefreshToken && secret === expectedSecret) {
        // Simulate sync version: return payload if valid, throw if invalid
        if (callback) callback(null, { userId: mockUserId }); // Handle if callback *is* provided
        return { userId: mockUserId }; // Return payload for sync usage
      } else {
        if (callback) callback(new Error('Invalid token'), undefined); // Handle if callback *is* provided
        throw new Error('Invalid token'); // Throw error for sync usage
      }
    });
    mockedJwt.sign.mockReturnValue(newAccessToken)
  });

  it('should return a new access token with a valid refresh token cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh_token')
      .set('Cookie', `refreshToken=${validRefreshToken}`); // Send valid cookie

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('accessToken', newAccessToken);

    // Verify JWT verify and sign calls
    expect(mockedJwt.verify).toHaveBeenCalledWith(
      validRefreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, // Use correct secret
    );
    expect(mockedJwt.sign).toHaveBeenCalledWith(
      { userId: mockUserId },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
  });

  it('should fail with 401 Unauthorized if no refresh token cookie is provided', async () => {
    const res = await request(app).post('/api/v1/auth/refresh_token');
    // Will fail 404 first
    expect(res.statusCode).toBe(401);
  });

  it('should fail with 403 Forbidden if refresh token is invalid/expired', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh_token')
      .set('Cookie', 'refreshToken=invalid_or_expired_token');
    // Now expects 403
    expect(res.statusCode).toBe(403);
    });
  });
});

describe('POST /api/v1/auth/logout', () => {
    it('should clear the refreshToken cookie and return 204 on success', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refreshToken=some_token'); // Send a cookie just in case

      // This is the RED TEST
      // Will fail 404 first
      expect(res.statusCode).toBe(204); // No Content
      // Check that the Set-Cookie header clears the token
      expect(res.headers['set-cookie']).toBeDefined();
      const cookieString = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'][0] : res.headers['set-cookie'];
      expect(cookieString).toMatch(/refreshToken=;/); // Check value is empty
      expect(cookieString).toMatch(/Max-Age=0/); // Check Max-Age is 0
      // Optionally check Expires, though Max-Age=0 is usually sufficient
      // expect(cookieString).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});