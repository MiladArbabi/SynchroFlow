// tests/unit/api/integration.routes.test.ts
import { Router } from 'express';

// Mock the controller and middleware
jest.mock('api-src/api/integrations/integration.controller', () => ({
  initiateOAuth: jest.fn(),
  handleOAuthCallback: jest.fn(), 
  getSyncStatus: jest.fn(),
  preFlightCheck: jest.fn()
}));

jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: jest.fn()
}));

// Import after mocking
import { 
  initiateOAuth, 
  handleOAuthCallback, 
  getSyncStatus ,
  preFlightCheck
} from 'api-src/api/integrations/integration.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';

// Define types for Express router internals
interface RouteLayer {
  route?: {
    path: string;
    methods: { [method: string]: boolean };
    stack: Array<{ handle: any }>;
  };
}

describe('Integration Routes', () => {
  let router: Router;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-import the routes to get a fresh router instance
    jest.isolateModules(() => {
      router = require('api-src/api/integrations/integration.routes').default;
    });
  });

  it('should configure GET /oauth/initiate with authenticateToken and initiateOAuth', () => {
    // Get the route stack and cast to our custom type
    const routeStack = router.stack as RouteLayer[];
    
    // Find the /oauth/initiate route
    const initiateRoute = routeStack.find(layer => 
      layer.route?.path === '/oauth/initiate' && 
      layer.route?.methods.get
    );
    
    expect(initiateRoute).toBeDefined();
    expect(initiateRoute?.route?.stack[0].handle).toBe(authenticateToken);
    expect(initiateRoute?.route?.stack[1].handle).toBe(initiateOAuth);
  });

  it('should configure GET /oauth/callback/:platform with handleOAuthCallback', () => {
    const routeStack = router.stack as RouteLayer[];
    
    const callbackRoute = routeStack.find(layer => 
      layer.route?.path === '/oauth/callback/:platform' && 
      layer.route?.methods.get
    );
    
    expect(callbackRoute).toBeDefined();
    expect(callbackRoute?.route?.stack[0].handle).toBe(handleOAuthCallback);
    // No authenticateToken middleware for callback (it's public)
    expect(callbackRoute?.route?.stack).toHaveLength(1);
  });

  it('should configure GET /sync-status with authenticateToken and getSyncStatus', () => {
    const routeStack = router.stack as RouteLayer[];
    
    const syncStatusRoute = routeStack.find(layer => 
      layer.route?.path === '/sync-status' && 
      layer.route?.methods.get
    );
    
    expect(syncStatusRoute).toBeDefined();
    expect(syncStatusRoute?.route?.stack[0].handle).toBe(authenticateToken);
    expect(syncStatusRoute?.route?.stack[1].handle).toBe(getSyncStatus);
  });

  it('should export a router instance', () => {
    expect(router).toBeInstanceOf(Function);
    expect(router.stack).toBeDefined();
  });

  it('should configure GET /pre-flight with authenticateToken and preFlightCheck', () => {
  const routeStack = router.stack as RouteLayer[];
  
  const preFlightRoute = routeStack.find(layer => 
    layer.route?.path === '/pre-flight' && 
    layer.route?.methods.get
  );
  
  expect(preFlightRoute).toBeDefined();
  expect(preFlightRoute?.route?.stack[0].handle).toBe(authenticateToken);
  expect(preFlightRoute?.route?.stack[1].handle).toBe(preFlightCheck);
  });

  it('should have exactly 4 routes configured', () => {
    const routeStack = router.stack as RouteLayer[];
    const routes = routeStack
      .filter(layer => layer.route)
      .map(layer => ({
        path: layer.route!.path,
        method: Object.keys(layer.route!.methods || {})[0]
      }));
    
    expect(routes).toHaveLength(4);
    expect(routes).toEqual(
      expect.arrayContaining([
        { path: '/oauth/initiate', method: 'get' },
        { path: '/oauth/callback/:platform', method: 'get' },
        { path: '/sync-status', method: 'get' },
        { path: '/pre-flight', method: 'get' }
      ])
    );
  });
});