import { UserStateService } from 'api-src/services/user-state.service';

// Mock the database
const mockDbInstance = {
   where: jest.fn().mockReturnThis(),
   first: jest.fn(),
   insert: jest.fn().mockReturnThis(),
   onConflict: jest.fn().mockReturnThis(),
   ignore: jest.fn().mockReturnThis(),
   update: jest.fn().mockReturnThis(),
   orderBy: jest.fn(),
 };

jest.mock('api-src/db', () => ({
  fn: { now: jest.fn() },
  // Mock the chain: db('users').where().first()
  __esModule: true,
  default: jest.fn(() => mockDbInstance)
}));

describe('UserStateService - Tiered Onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
        // Reset all mock implementations
        Object.values(mockDbInstance).forEach(mock => mock.mockClear?.());
        mockDbInstance.where.mockReturnValue(mockDbInstance);
        mockDbInstance.insert.mockReturnValue(mockDbInstance);
        mockDbInstance.onConflict.mockReturnValue(mockDbInstance);
        mockDbInstance.ignore.mockReturnValue(mockDbInstance);
        mockDbInstance.update.mockReturnValue(mockDbInstance);
  });

  describe('detectOnboardingTier', () => {
    test('returns BASIC_ACCESS for non-existent user', async () => {
      mockDbInstance.first.mockResolvedValue(null);
      
      const result = await UserStateService.detectOnboardingTier(999);
      expect(result).toBe('BASIC_ACCESS');
    });

    test('returns PCD_PENDING for user with Shopify connected', async () => {
      mockDbInstance.first.mockResolvedValue({ 
        id: 1, 
        shopify_connected: true 
      });
      
      const result = await UserStateService.detectOnboardingTier(1);
      expect(result).toBe('PCD_PENDING');
    });

    test('returns BASIC_ACCESS for user without Shopify', async () => {
      mockDbInstance.first.mockResolvedValue({ 
        id: 1, 
        shopify_connected: false 
      });
      
      const result = await UserStateService.detectOnboardingTier(1);
      expect(result).toBe('BASIC_ACCESS');
    });
  });

  describe('getConnectedPlatforms', () => {
    test('returns empty array for user without platforms', async () => {
      mockDbInstance.first.mockResolvedValue({  
        id: 1, 
        shopify_connected: false,
        stripe_connected: false
      });
      
      const result = await UserStateService.getConnectedPlatforms(1);
      expect(result).toEqual([]);
    });

    test('returns platforms for connected user', async () => {
       mockDbInstance.first.mockResolvedValue({ 
        id: 1, 
        shopify_connected: true,
        stripe_connected: true
      });
      
      const result = await UserStateService.getConnectedPlatforms(1);
      expect(result).toEqual(['shopify', 'stripe']);
    });
  });

  describe('getOnboardingProgress', () => {
    test('returns complete onboarding progress', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        preferred_mode: 'survival',
        shopify_connected: true,
        stripe_connected: false,
        first_insight_delivered: false
      };

      mockDbInstance.first
        .mockResolvedValueOnce(mockUser) // For detectOnboardingTier
        .mockResolvedValueOnce(mockUser) // For getConnectedPlatforms
        .mockResolvedValueOnce(mockUser); // For getUserState

      mockDbInstance.orderBy.mockResolvedValueOnce([]); // Empty milestoness

      const result = await UserStateService.getOnboardingProgress(1);
      
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('connectedPlatforms');
      expect(result).toHaveProperty('recommendedNextSteps');
      expect(result).toHaveProperty('unlockedFeatures');
      expect(result).toHaveProperty('userState');
      expect(Array.isArray(result.recommendedNextSteps)).toBe(true);
      expect(Array.isArray(result.unlockedFeatures)).toBe(true);
    });
  });

  describe('getRecommendedNextSteps', () => {
    test('returns basic steps for BASIC_ACCESS tier', () => {
      const steps = (UserStateService as any).getRecommendedNextSteps('BASIC_ACCESS', []);
      
      expect(steps).toContain('Connect Shopify store to unlock order and customer data');
      expect(steps).toContain('Complete Shopify app installation for PCD access');
    });

    test('returns PCD steps for PCD_PENDING tier', () => {
      const steps = (UserStateService as any).getRecommendedNextSteps('PCD_PENDING', ['shopify']);
      
      expect(steps).toContain('Request PCD access approval from Shopify');
      expect(steps).toContain('Connect financial platforms (QuickBooks, Stripe) for profitability insights');
    });

    test('returns advanced steps for PCD_APPROVED tier', () => {
      const steps = (UserStateService as any).getRecommendedNextSteps('PCD_APPROVED', ['shopify']);
      
      expect(steps).toContain('Connect Stripe for payment analytics and fee tracking');
      expect(steps).toContain('Connect QuickBooks for true cost accounting');
      expect(steps).toContain('Explore advanced analytics and financial intelligence features');
    });
  });

  describe('getUnlockedFeatures', () => {
    test('returns basic features for all tiers', () => {
      const features = (UserStateService as any).getUnlockedFeatures('BASIC_ACCESS', []);
      
      expect(features).toContain('Basic dashboard widgets');
      expect(features).toContain('Product inventory tracking');
    });

    test('includes order management for Shopify users', () => {
      const features = (UserStateService as any).getUnlockedFeatures('PCD_PENDING', ['shopify']);
      
      expect(features).toContain('Order management');
      expect(features).toContain('Customer profiles (limited)');
    });

    test('includes full intelligence for PCD_APPROVED', () => {
      const features = (UserStateService as any).getUnlockedFeatures('PCD_APPROVED', ['shopify']);
      
      expect(features).toContain('Full customer intelligence');
      expect(features).toContain('Cross-platform analytics');
    });

    test('includes payment analytics for Stripe users', () => {
      const features = (UserStateService as any).getUnlockedFeatures('PCD_APPROVED', ['shopify', 'stripe']);
      
      expect(features).toContain('Payment analytics');
      expect(features).toContain('Revenue tracking');
    });
  });

  describe('getUserState with onboarding data', () => {
    test('includes onboarding tier and platforms in user state', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        preferred_mode: 'survival',
        shopify_connected: true,
        stripe_connected: false,
        first_insight_delivered: false
      };

      mockDbInstance.first.mockResolvedValue(mockUser);
      mockDbInstance.orderBy.mockResolvedValue([]);

      const result = await UserStateService.getUserState(1);
      
      expect(result.user).toHaveProperty('onboarding_tier');
      expect(result.user).toHaveProperty('connected_platforms');
      expect(Array.isArray(result.user.connected_platforms)).toBe(true);
    });
  });
});