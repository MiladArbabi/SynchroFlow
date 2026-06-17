//apps/backend/src/services/user-state.service.ts
import db from '@lasyncro/backend-core/db.js';
import { User, UserMilestone } from '../types.js';
import { LifecycleService } from '../services/lifecycle.service.js';
import { OnboardingReadinessService } from '../onboarding/readiness.service.js';
import { OnboardingReadinessSnapshot } from '@lasyncro/shared';

import { ConflictTypes, ResolutionStrategies } from '../conflict-resolution/conflict.types.js';
import { logConflictIgnored, logConflictResolved } from '../conflict-resolution/conflict.logger.js';

export type OnboardingTier = 'PCD_APPROVED' | 'PCD_PENDING' | 'BASIC_ACCESS';
export type PlatformConnection = 'shopify' | 'quickbooks' | 'stripe' | 'klaviyo' | 'google_analytics';
export type OrdersPerMonthSegment =
  | '1-50'
  | '51-200'
  | '201-500'
  | '501-1000'
  | '1000+';

export class UserStateService {

  /**
    * Detect user's onboarding tier based on PCD status and platform connections
    */
   static async detectOnboardingTier(userId: number): Promise<OnboardingTier> {
     const user = await db<User>('users').where({ id: userId }).first();
     
     if (!user) {
       return 'BASIC_ACCESS';
     }
 
     // Check if user has PCD-approved access (we'll need to implement this check)
     const hasPCDAccess = await this.checkPCDAccess(userId);
     
     if (hasPCDAccess) {
       return 'PCD_APPROVED';
     }
 
     // Check if user has attempted PCD access but is pending
     const hasPendingPCD = await this.hasPendingPCDAccess(userId);
     
     if (hasPendingPCD) {
       return 'PCD_PENDING';
     }
 
     return 'BASIC_ACCESS';
   }
 
   /**
    * Check if user has PCD-approved access
    */
   private static async checkPCDAccess(userId: number): Promise<boolean> {
     // For now, return false - we'll implement actual PCD check later
     // This would check if the Shopify app has PCD permissions
     return false;
   }
 
   /**
    * Check if user has pending PCD access
    */
   private static async hasPendingPCDAccess(userId: number): Promise<boolean> {
     // Check if user has Shopify connected but no PCD access yet
     const user = await db<User>('users').where({ id: userId }).first();
     return user?.shopify_connected === true;
   }
 
   /**
    * Get user's connected platforms
    */
   static async getConnectedPlatforms(userId: number): Promise<PlatformConnection[]> {
     const user = await db<User>('users').where({ id: userId }).first();
     const connected: PlatformConnection[] = [];
 
     if (user?.shopify_connected) {
       connected.push('shopify');
     }
     if (user?.stripe_connected) {
       connected.push('stripe');
     }
     // Add other platform checks as we implement them
 
     return connected;
   }
 
  static async getOnboardingProgress(userId: number) {
    const {
      lifecyclePhase,
      readinessSnapshot,
      userState,
    } = await this.getLifecycleContext(userId);

    return {
      lifecyclePhase,
      readiness: readinessSnapshot,
      userState,
    };
  }

 
   /**
    * Get recommended next steps based on current tier and platforms
    */
   private static getRecommendedNextSteps(tier: OnboardingTier, platforms: PlatformConnection[]) {
     const steps: string[] = [];
 
     if (tier === 'BASIC_ACCESS') {
       steps.push('Connect Shopify store to unlock order and customer data');
       if (!platforms.includes('shopify')) {
         steps.push('Complete Shopify app installation for PCD access');
       }
     }
 
     if (tier === 'PCD_PENDING') {
       steps.push('Request PCD access approval from Shopify');
       steps.push('Connect financial platforms (QuickBooks, Stripe) for profitability insights');
     }
 
     if (tier === 'PCD_APPROVED') {
       if (!platforms.includes('stripe')) {
         steps.push('Connect Stripe for payment analytics and fee tracking');
       }
       if (!platforms.includes('quickbooks')) {
         steps.push('Connect QuickBooks for true cost accounting');
       }
       steps.push('Explore advanced analytics and financial intelligence features');
     }
 
     return steps;
   }
 
   /**
    * Get unlocked features based on tier and platforms
    */
   private static getUnlockedFeatures(tier: OnboardingTier, platforms: PlatformConnection[]) {
     const features = [
       'Basic dashboard widgets',
       'Product inventory tracking'
     ];
 
     if (platforms.includes('shopify')) {
       features.push('Order management');
       features.push('Customer profiles (limited)');
     }
 
     if (tier === 'PCD_APPROVED') {
       features.push('Full customer intelligence');
       features.push('Cross-platform analytics');
     }
 
     if (platforms.includes('stripe')) {
       features.push('Payment analytics');
       features.push('Revenue tracking');
     }
 
     if (platforms.includes('quickbooks')) {
       features.push('True profitability');
       features.push('Cost accounting');
     }
 
     return features;
   }

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
      return {
        user: {
          id: userId,
          email: null,
          first_name: null,
          last_name: null,
          entry_channel: null,
          profile_prompt_dismissed_at: null,
          preferred_mode: null,
          detected_mode: 'survival',
          onboarding_tier: 'BASIC_ACCESS',
          connected_platforms: [],
          shopify_connected: false,
          stripe_connected: false,
          orders_per_month_segment: null,
        },
        milestones: [],
        current_mode: 'survival',
      };
    }

    const milestones = await db<UserMilestone>('user_milestones')
      .where({ user_id: userId })
      .orderBy('achieved_at', 'desc');

    const detectedMode = await this.detectUserMode(userId);
    const onboardingTier = await this.detectOnboardingTier(userId);
    const connectedPlatforms = await this.getConnectedPlatforms(userId);
    const ordersPerMonthSegment = await this.getOrdersPerMonthSegment(userId);


    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        entry_channel: user.entry_channel,
        profile_prompt_dismissed_at: user.profile_prompt_dismissed_at,
        preferred_mode: user.preferred_mode,
        detected_mode: detectedMode,
        onboarding_tier: onboardingTier,
        connected_platforms: connectedPlatforms,
        shopify_connected: user.shopify_connected,
        stripe_connected: user.stripe_connected,
        orders_per_month_segment: ordersPerMonthSegment,
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
   * Update user's first/last name and/or dismiss the skippable profile
   * prompt (App Store ghost users). Always stamps profile_prompt_dismissed_at
   * on call — both "save" and "skip" actions are terminal; the prompt
   * never reappears once acted on.
   */
  static async updateProfile(
    userId: number,
    fields: { firstName?: string; lastName?: string }
  ) {
    const update: Record<string, unknown> = {
      profile_prompt_dismissed_at: db.fn.now(),
      updated_at: db.fn.now(),
    };
    if (fields.firstName !== undefined) update.first_name = fields.firstName;
    if (fields.lastName !== undefined) update.last_name = fields.lastName;

    await db<User>('users')
      .where({ id: userId })
      .update(update);
  }



  /**
   * Record a milestone for a user
   */
  static async recordMilestone(userId: number, milestone: string) {
    // CONFLICT POLICY (EXPLICIT)
    // Type: DUPLICATE_EVENT (same milestone for user)
    // Strategy: IGNORE (idempotent write, no overwrite)
    const conflictType = ConflictTypes.DUPLICATE_EVENT;
    const resolutionStrategy = ResolutionStrategies.IGNORE;

    await db<UserMilestone>('user_milestones')
    .insert({
      user_id: userId,
      milestone,
      achieved_at: db.fn.now(),
    })
    .onConflict(['user_id', 'milestone'])
    .ignore()
    .then(() => {
      logConflictIgnored({
        entity: 'user_milestones',
        conflictKey: ['user_id', 'milestone'],
        note: 'Duplicate milestone ignored (idempotent insert)'
      });
    });
  }

  /**
   * Get the user's orders_per_month_segment from user_states
   */
  static async getOrdersPerMonthSegment(
    userId: number
  ): Promise<OrdersPerMonthSegment | null> {
    const row = await db('user_states')
      .where({ user_id: userId, key: 'orders_per_month_segment' })
      .first();

    if (!row) {
      return null;
    }

    const raw = row.value;

    if (raw == null) {
      return null;
    }

    // If stored as a plain string in JSONB
    if (typeof raw === 'string') {
      const allowed: OrdersPerMonthSegment[] = [
        '1-50',
        '51-200',
        '201-500',
        '501-1000',
        '1000+',
      ];
      return (allowed as string[]).includes(raw) ? (raw as OrdersPerMonthSegment) : null;
    }

    // If stored as an object like { segment: "51-200" } (future-proofing)
    if (typeof raw === 'object' && typeof (raw as any).segment === 'string') {
      const candidate = (raw as any).segment as string;
      const allowed: OrdersPerMonthSegment[] = [
        '1-50',
        '51-200',
        '201-500',
        '501-1000',
        '1000+',
      ];
      return (allowed as string[]).includes(candidate)
        ? (candidate as OrdersPerMonthSegment)
        : null;
    }

    // Unknown format → treat as unset
    return null;
  }

  /**
   * Update the user's orders_per_month_segment in user_states
   */
  static async updateOrdersPerMonthSegment(
    userId: number,
    segment: OrdersPerMonthSegment
  ): Promise<void> {
    const payload = { segment }; // valid JSON, plays nicely with jsonb

    await db('user_states')
      .insert({
        user_id: userId,
        key: 'orders_per_month_segment',
        value: payload,
        updated_at: db.fn.now(),
      })
      .onConflict(['user_id', 'key'])
      .merge({
        value: payload,
        updated_at: db.fn.now(),
      });
  }

  /**
   * Get user's product costs from user_state
   */
  static async getUserProductCosts(userId: number): Promise<Record<string, any>> {
    const userState = await db('user_states')
      .where({ user_id: userId, key: 'product_costs' })
      .first();
    
    if (!userState) {
      return {};
    }

    // Handle both stringified JSON and direct object storage
    if (typeof userState.value === 'string') {
      try {
        return JSON.parse(userState.value);
      } catch (error) {
        console.error('Error parsing user state JSON:', error);
        return {};
      }
    }
    
    // If it's already an object, return it directly
    return userState.value || {};
  }

  /**
   * Update user's product costs in user_state
   */
  static async updateUserProductCosts(userId: number, productCosts: Record<string, any>) {
    await db('user_states')
      .insert({
        user_id: userId,
        key: 'product_costs',
        value: productCosts, // Store as JSONB directly
        updated_at: db.fn.now()
      })
      .onConflict(['user_id', 'key'])
      .merge({
        value: productCosts, // Store as JSONB directly
        updated_at: db.fn.now()
    });
  }

  /**
   * Aggregate canonical lifecycle facts for the user.
   * Read-only. No derivation. No side effects.
   */
  static async getLifecycleContext(userId: number) {
    const lifecyclePhase = await LifecycleService.resolveForUser(userId);

    const userState = await this.getUserState(userId);

    const shopId =
      userState?.user && (userState.user as any).shop_id
        ? (userState.user as any).shop_id
        : null;

    let readinessSnapshot: OnboardingReadinessSnapshot | null = null;

    if (shopId) {
      const readinessService = new OnboardingReadinessService();
      readinessSnapshot = await readinessService.getSnapshot({ shopId, userId });
    }

    return {
      lifecyclePhase,
      readinessSnapshot,
      userState,
    };
  }
};