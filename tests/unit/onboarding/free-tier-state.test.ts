// tests/unit/shared/free-tier-state.test.ts

import {
  computeModuleAccessState,
  MODULE_FREE_TIER_POLICIES,
  type ModuleAccessState,
  type ModuleEntitlementAccess
} from '@lasyncro/shared';

describe('computeModuleAccessState (FTEP v1.1)', () => {
  it('returns "visible" for platform when free tier is disabled', () => {
    const policy = MODULE_FREE_TIER_POLICIES['platform'];
    expect(policy.enabled).toBe(false);

    const { state, remaining } = computeModuleAccessState({
      moduleId: 'platform',
      usageCount: 0,
      entitlementAccess: 'free-tier'
    });

    expect(state).toBe<ModuleAccessState>('visible');
    expect(remaining).toBeNull();
  });

  it('returns "locked" when entitlementAccess is "locked"', () => {
    const { state, remaining } = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: 10,
      entitlementAccess: 'locked'
    });

    expect(state).toBe<ModuleAccessState>('locked');
    expect(remaining).toBe(0);
  });

  it('returns "free_tier_active" with remaining units for a free-tier module under quota', () => {
    const policy = MODULE_FREE_TIER_POLICIES['order-nexus'];
    expect(policy.maxUnits).toBe(50);

    const { state, remaining } = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: 10,
      entitlementAccess: 'free-tier'
    });

    expect(state).toBe<ModuleAccessState>('free_tier_active');
    expect(remaining).toBe(40);
  });

  it('returns "free_tier_exhausted" when usage reaches or exceeds maxUnits', () => {
    const policy = MODULE_FREE_TIER_POLICIES['order-nexus'];
    expect(policy.maxUnits).toBe(50);

    const { state, remaining } = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: 50,
      entitlementAccess: 'free-tier'
    });

    expect(state).toBe<ModuleAccessState>('free_tier_exhausted');
    expect(remaining).toBe(0);
  });

  it('treats "allowed" entitlements as fully open, ignoring free-tier limits', () => {
    const policy = MODULE_FREE_TIER_POLICIES['order-nexus'];
    expect(policy.maxUnits).toBe(50);

    const { state, remaining } = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: 9999,
      entitlementAccess: 'allowed'
    });

    // Paid plan → no gating
    expect(state).toBe<ModuleAccessState>('free_tier_active');
    expect(remaining).toBeNull();
  });

  it('clamps negative usage to zero internally', () => {
    const { state, remaining } = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: -5,
      entitlementAccess: 'free-tier'
    });

    expect(state).toBe<ModuleAccessState>('free_tier_active');
    // maxUnits is 50 → should treat usage as 0
    expect(remaining).toBe(50);
  });
});
