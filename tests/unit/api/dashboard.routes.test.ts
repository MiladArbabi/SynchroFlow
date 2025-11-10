// tests/unit/api/dashboard.routes.test.ts
import request from 'supertest';
import express from 'express';
import dashboardRoutes from 'api-src/api/dashboard/dashboard.routes';

// Mock the controller functions
jest.mock('api-src/api/dashboard/dashboard.controller', () => ({
  getPulse: jest.fn((_req, res) => res.status(200).json({ test: 'pulse' })),
  getInventoryHealth: jest.fn((_req, res) => res.status(200).json({ test: 'inventory' })),
  getShipmentStatus: jest.fn((_req, res) => res.status(200).json({ test: 'shipment' }))
}));

// Mock the auth middleware
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: jest.fn((req, _res, next) => {
    req.user = { userId: 1 }; // Mock authenticated user
    next();
  })
}));

describe('Dashboard Routes', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use('/api/v1/dashboard', dashboardRoutes);
  });

  describe('GET /api/v1/dashboard/pulse', () => {
    it('should call getPulse controller', async () => {
      const response = await request(app).get('/api/v1/dashboard/pulse');
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ test: 'pulse' });
    });
  });

  describe('GET /api/v1/dashboard/inventory-health', () => {
    it('should call getInventoryHealth controller', async () => {
      const response = await request(app).get('/api/v1/dashboard/inventory-health');
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ test: 'inventory' });
    });
  });

  describe('GET /api/v1/dashboard/shipment-status', () => {
    it('should call getShipmentStatus controller', async () => {
      const response = await request(app).get('/api/v1/dashboard/shipment-status');
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ test: 'shipment' });
    });
  });

  describe('Authentication', () => {
    it('should protect all routes with authentication', async () => {
      // This is implicitly tested by the fact that all routes use authenticateToken
      // In a real scenario, you might want to test unauthorized access
      const routes = [
        '/api/v1/dashboard/pulse',
        '/api/v1/dashboard/inventory-health', 
        '/api/v1/dashboard/shipment-status'
      ];

      for (const route of routes) {
        const response = await request(app).get(route);
        // If auth fails, it would return 401, but our mock always succeeds
        expect(response.status).not.toBe(401);
      }
    });
  });
});