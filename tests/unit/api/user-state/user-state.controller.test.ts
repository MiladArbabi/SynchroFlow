// tests/unit/api/user-state/user-state.controller.test.ts
import request from 'supertest';
import express from 'express';
import  userStateRoutes from 'api-src/api/user-state/user-state.routes.ts';
import { UserStateService } from 'api-src/services/user-state.service';

// Mock the service
jest.mock('api-src/services/user-state.service');
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: jest.fn((req, _res, next) => {
    req.user = { userId: 1 }; // Mock authenticated user
    next();
  })
}));

const app = express();
app.use(express.json());
app.use('/api/v1/user-state', userStateRoutes);

describe('UserState API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/user-state/state', () => {
    it('should return user state for authenticated user', async () => {
      const mockState = {
        user: { id: 1, email: 'test@example.com', detected_mode: 'survival' },
        milestones: [],
        current_mode: 'survival'
      };

      (UserStateService.getUserState as jest.Mock).mockResolvedValue(mockState);

      const response = await request(app)
        .get('/api/v1/user-state/state')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockState);
    });

    it('should handle errors when getting user state fails', async () => {
      (UserStateService.getUserState as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/user-state/state')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get user state' });
    });
  });

  describe('PUT /api/v1/user-state/mode', () => {
    it('should update user mode', async () => {
      (UserStateService.updatePreferredMode as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/v1/user-state/mode')
        .set('Authorization', 'Bearer valid-token')
        .send({ mode: 'growth' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Mode updated successfully' });
    });

    it('should reject invalid mode', async () => {
      const response = await request(app)
        .put('/api/v1/user-state/mode')
        .set('Authorization', 'Bearer valid-token')
        .send({ mode: 'invalid-mode' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid mode' });
    });

    it('should handle errors when updating mode fails', async () => {
      (UserStateService.updatePreferredMode as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .put('/api/v1/user-state/mode')
        .set('Authorization', 'Bearer valid-token')
        .send({ mode: 'growth' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to update user mode' });
    });
  });
});