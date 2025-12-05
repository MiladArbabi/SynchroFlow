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
    describe('PATCH /api/v1/user-state/state', () => {
    it('should update orders_per_month_segment and return fresh user state', async () => {
      const mockState = {
        user: {
          id: 1,
          email: 'test@example.com',
          detected_mode: 'survival',
          orders_per_month_segment: '51-200',
        },
        milestones: [],
        current_mode: 'survival',
      };

      (UserStateService.updateOrdersPerMonthSegment as jest.Mock).mockResolvedValue(undefined);
      (UserStateService.getUserState as jest.Mock).mockResolvedValue(mockState);

      const response = await request(app)
        .patch('/api/v1/user-state/state')
        .set('Authorization', 'Bearer valid-token')
        .send({ orders_per_month_segment: '51-200' });

      expect(UserStateService.updateOrdersPerMonthSegment).toHaveBeenCalledWith(1, '51-200');
      expect(UserStateService.getUserState).toHaveBeenCalledWith(1);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockState);
    });

    it('should reject invalid orders_per_month_segment', async () => {
      const response = await request(app)
        .patch('/api/v1/user-state/state')
        .set('Authorization', 'Bearer valid-token')
        .send({ orders_per_month_segment: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid orders_per_month_segment');
      expect(UserStateService.updateOrdersPerMonthSegment).not.toHaveBeenCalled();
    });

    it('should handle errors when updateUserState fails', async () => {
      (UserStateService.updateOrdersPerMonthSegment as jest.Mock).mockRejectedValue(
        new Error('Database error'),
      );

      const response = await request(app)
        .patch('/api/v1/user-state/state')
        .set('Authorization', 'Bearer valid-token')
        .send({ orders_per_month_segment: '51-200' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to update user state' });
    });
  });
});