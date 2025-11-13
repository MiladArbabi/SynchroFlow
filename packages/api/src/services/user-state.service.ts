//packages/api/src/services/user-state.service.ts
import db from '../db';
import { User, UserMilestone } from '../types';

export class UserStateService {
  /**
   * Detect the appropriate mode for a user based on their current state
   */
  static async detectUserMode(userId: number): Promise<'survival' | 'growth' | 'architect'> {
    const user = await db<User>('users')
      .where({ id: userId })
      .first();
    
    if (!user) {
      return 'survival';
    }

    // 1. Respect user preference first
    if (user.preferred_mode) {
      return user.preferred_mode;
    }

    // 2. Basic rules based on integration and data maturity
    if (!user.shopify_connected) {
      return 'survival';
    }

    if (!user.first_insight_delivered) {
      return 'survival';
    }

    // 3. Simple plan-based defaults (we'll enhance this later)
    // For now, all users get 'survival' until we have plan data
    return 'survival';
  }

  /**
   * Get complete user state including mode and milestones
   */
  static async getUserState(userId: number) {
    const user = await db<User>('users')
      .where({ id: userId })
      .first();
    
    if (!user) {
      throw new Error('User not found');
    }

    const milestones = await db<UserMilestone>('user_milestones')
      .where({ user_id: userId })
      .orderBy('achieved_at', 'desc');

    const detectedMode = await this.detectUserMode(userId);

    return {
      user: {
        id: user.id,
        email: user.email,
        preferred_mode: user.preferred_mode,
        detected_mode: detectedMode,
        shopify_connected: user.shopify_connected,
        stripe_connected: user.stripe_connected,
        first_insight_delivered: user.first_insight_delivered,
      },
      milestones,
      current_mode: user.preferred_mode || detectedMode,
    };
  }

  /**
   * Update user's preferred mode
   */
  static async updatePreferredMode(userId: number, mode: 'survival' | 'growth' | 'architect') {
    await db<User>('users')
      .where({ id: userId })
      .update({
        preferred_mode: mode,
        updated_at: db.fn.now(),
      });
  }

  /**
   * Record a milestone for a user
   */
  static async recordMilestone(userId: number, milestone: string) {
    await db<UserMilestone>('user_milestones').insert({
      user_id: userId,
      milestone,
      achieved_at: db.fn.now(),
    }).onConflict(['user_id', 'milestone']).ignore(); // Don't duplicate milestones
  }
}