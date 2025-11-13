// tests/unit/api/auth-verification.test.ts
import jwt from 'jsonwebtoken';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { loginUser } from 'api-src/api/auth/auth.controller';
import db from '../../../packages/api/src/db';

console.log('db type:', typeof db);
console.log('db keys:', Object.keys(db));
console.log('db is function?', typeof db === 'function');

jest.mock('../../../packages/api/src/db', () => {
  const mockQueryBuilder: any = {
    where: jest.fn(() => mockQueryBuilder),
    first: jest.fn(),
    insert: jest.fn(() => mockQueryBuilder),
    returning: jest.fn()
  };
  
  // Return the mock function directly
  const mockDb = jest.fn(() => mockQueryBuilder);
  return mockDb;
});

jest.mock('bcrypt');
jest.mock('jsonwebtoken');
import bcrypt from 'bcrypt';

describe('Authentication Flow Verification', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    nextFunction = jest.fn();
    
    mockRequest = {
      headers: {}
    };
    
    mockResponse = {
      status: mockStatus,
      json: mockJson,
      cookie: jest.fn()
    };

    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'test';
  });

  describe('JWT Middleware', () => {
    it('should return 401 when no token is provided', () => {
      authenticateToken(mockRequest, mockResponse, nextFunction);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Unauthorized: No token provided.' });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return 500 when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;
      mockRequest.headers.authorization = 'Bearer valid-token';

      authenticateToken(mockRequest, mockResponse, nextFunction);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Internal server error: JWT secret missing.' });
    });

    it('should return 403 when token is invalid', () => {
      mockRequest.headers.authorization = 'Bearer invalid-token';
      (jwt.verify as jest.Mock).mockImplementation((_token, _secret, callback) => {
        callback(new Error('Invalid token'), null);
      });

      authenticateToken(mockRequest, mockResponse, nextFunction);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Forbidden: Invalid token.' });
    });

    it('should call next and set user when token is valid', () => {
      const mockUser = { userId: 1 };
      mockRequest.headers.authorization = 'Bearer valid-token';
      (jwt.verify as jest.Mock).mockImplementation((_token, _secret, callback) => {
        callback(null, mockUser);
      });

      authenticateToken(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user).toEqual(mockUser);
    });
  });

  describe('Login Endpoint', () => {
    it('should return 400 when email or password is missing', async () => {
        mockRequest.body = { email: 'test@example.com' }; // Missing password

        await loginUser(mockRequest, mockResponse);

        expect(mockStatus).toHaveBeenCalledWith(400);
        expect(mockJson).toHaveBeenCalledWith({ error: 'Email and password are required.' });
    });

    it('should return 401 when user not found', async () => {
      mockRequest.body = { email: 'nonexistent@example.com', password: 'password' };
      
      // Create a fresh mock query builder for this test
      const mockQueryBuilder: any = {
        where: jest.fn(() => mockQueryBuilder),
        first: jest.fn()
      };
      
      // Set up the mock to return our query builder
      (db as jest.MockedFunction<typeof db>).mockImplementation(() => mockQueryBuilder as any);
      
      // Set the specific response for this test
      mockQueryBuilder.first.mockResolvedValue(null);

      await loginUser(mockRequest, mockResponse);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Invalid email or password.' });
      
      // Verify the query was built correctly
      expect(db).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith({ email: 'nonexistent@example.com' });
    });

    it('should return tokens on successful login', async () => {
        mockRequest.body = { email: 'test@example.com', password: 'password' };
        const mockUser = { 
        id: 1, 
        email: 'test@example.com', 
        password_hash: 'hashed_password',
        first_name: 'Test',
        last_name: 'User',
        shop_id: 1
        };
        
        // Mock cookie function
        mockResponse.cookie = jest.fn();
        
        (db().first as jest.Mock).mockResolvedValue(mockUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        (jwt.sign as jest.Mock).mockReturnValue('mock-token');

        await loginUser(mockRequest, mockResponse);

        // Fix: Match the actual response structure from controller
        expect(mockJson).toHaveBeenCalledWith({
        accessToken: 'mock-token',
        user: { 
            id: 1, 
            email: 'test@example.com',
            first_name: 'Test',
            last_name: 'User', 
            shop_id: 1
        }
        });
        
        // Verify cookie was set for refresh token
        expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'mock-token',
        expect.objectContaining({
            httpOnly: true,
            secure: false, // test environment
            sameSite: 'strict'
        })
        );
    });
    });

  describe('Protected Routes', () => {
    it('should reject unauthenticated requests to dashboard endpoints', async () => {
      // This would be tested via integration tests with the actual routes
      // For now, we verify the middleware blocks requests
      mockRequest.headers = {}; // No authorization header

      authenticateToken(mockRequest, mockResponse, nextFunction);

      expect(mockStatus).toHaveBeenCalledWith(401);
    });
  });
});