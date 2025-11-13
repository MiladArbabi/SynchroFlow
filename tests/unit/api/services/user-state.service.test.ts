//tests/unit/api/services/user-state.service.test.ts
// tests/unit/api/services/user-state.service.test.ts
import { UserStateService } from 'api-src/services/user-state.service';
import db from 'api-src/db';

describe('UserStateService', () => {
  beforeEach(async () => {
    // Clear test data
    await db('user_milestones').delete();
    await db('users').delete();
  });

  describe('detectUserMode', () => {
    it('should return survival for user without shopify connection', async () => {
      // Arrange
      const user = await db('users').insert({
        email: 'test@example.com',
        password_hash: 'hash',
        shopify_connected: false,
        first_insight_delivered: false,
      }).returning('*');

      // Act
      const mode = await UserStateService.detectUserMode(user[0].id);

      // Assert
      expect(mode).toBe('survival');
    });

    it('should respect user preferred mode', async () => {
      // Arrange
      const user = await db('users').insert({
        email: 'test@example.com',
        password_hash: 'hash',
        preferred_mode: 'growth',
        shopify_connected: true,
        first_insight_delivered: true,
      }).returning('*');

      // Act
      const mode = await UserStateService.detectUserMode(user[0].id);

      // Assert
      expect(mode).toBe('growth');
    });

    it('should return survival for user without first insight', async () => {
      // Arrange
      const user = await db('users').insert({
        email: 'test@example.com',
        password_hash: 'hash',
        shopify_connected: true,
        first_insight_delivered: false,
      }).returning('*');

      // Act
      const mode = await UserStateService.detectUserMode(user[0].id);

      // Assert
      expect(mode).toBe('survival');
    });
  });
});