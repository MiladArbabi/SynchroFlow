// tests/unit/ui/commercial-access/upgrade-prompt-decision.test.tsx
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2B — TEST STRATEGY / RED
// ============================================================
// B14 — UpgradePrompt gains an OPTIONAL decision-driven path. Legacy props may
//       stay for non-migrated P0-A3 callers; for a migrated surface the
//       supplied AccessDecision is authoritative and the ONLY source of the
//       required tier / reason.
// B13 — reason-specific denial rendering:
//        TIER_TOO_LOW        → upgrade CTA to the EXACT decision.requiredTier
//        MODULE_NOT_INCLUDED → no fabricated tier step (no decision.requiredTier)
//        ROLE_FORBIDDEN      → no billing / upgrade CTA
// B6  — no `?? 'Growth'` fabrication when a decision is present.
//
// EXPECTED RED: UpgradePrompt today has no `decision` prop — the object is
// ignored and `requiredTier` falls back to the hardcoded 'Growth' label.
// Every failure below is that missing decision path, not a plumbing issue.

import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ tier: 'starter', billingCurrency: 'USD' }),
}));
jest.mock('../../../../apps/frontend/src/analytics/adapter', () => ({ sendEvent: jest.fn() }));

import { UpgradePrompt } from 'components/UpgradePrompt';

type AccessDecision = {
  allowed: boolean;
  reason: 'TIER_TOO_LOW' | 'MODULE_NOT_INCLUDED' | 'FEATURE_NOT_INCLUDED' | 'ROLE_FORBIDDEN';
  requiredTier?: 'core' | 'growth' | 'scale';
  requiredModule?: string;
  requiredFeature?: string;
};

/** Render with ONLY a `decision` (no legacy requiredTier string prop). */
function renderWithDecision(decision: AccessDecision, mode: 'modal' | 'locked' = 'modal') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = { decision, mode, open: true, onClose: () => {} };
  return render(<UpgradePrompt {...props} />);
}

const count = (re: RegExp) => screen.queryAllByText(re).length;

describe('B14 — UpgradePrompt decision-driven path', () => {
  it('EXPECTED RED: TIER_TOO_LOW → requiredTier "core" renders Core, never Growth', () => {
    renderWithDecision({ allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'core' });
    expect(count(/\bCore\b/i)).toBeGreaterThan(0);
    expect(count(/\bGrowth\b/i)).toBe(0);
  });

  it('EXPECTED RED: TIER_TOO_LOW → requiredTier "scale" renders Scale, never Growth', () => {
    renderWithDecision({ allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'scale' });
    expect(count(/\bScale\b/i)).toBeGreaterThan(0);
    expect(count(/\bGrowth\b/i)).toBe(0);
  });

  it('EXPECTED RED: MODULE_NOT_INCLUDED (no requiredTier) → no fabricated tier step', () => {
    renderWithDecision({ allowed: false, reason: 'MODULE_NOT_INCLUDED', requiredModule: 'suppliers-portal' });
    expect(count(/Upgrade to Growth/i)).toBe(0);
    expect(count(/Growth plan required/i)).toBe(0);
    expect(count(/Growth required/i)).toBe(0);
  });

  it('EXPECTED RED: ROLE_FORBIDDEN → no billing / upgrade CTA at all', () => {
    renderWithDecision({ allowed: false, reason: 'ROLE_FORBIDDEN' });
    expect(count(/Upgrade to/i)).toBe(0);
    expect(count(/plan required/i)).toBe(0);
    expect(count(/See all plan features/i)).toBe(0);
  });
});

describe('B14 — legacy prop path still works for non-migrated P0-A3 callers (GREEN CONTROL)', () => {
  it('GREEN CONTROL: the legacy `requiredTier` string prop still renders its tier', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = { requiredTier: 'core', mode: 'modal', open: true, onClose: () => {} };
    render(<UpgradePrompt {...props} />);
    expect(count(/\bCore\b/i)).toBeGreaterThan(0);
  });

  it('GREEN CONTROL: UpgradePrompt still hardcodes a Growth fallback today (the A2B target removes this)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = { mode: 'modal', open: true, onClose: () => {} }; // no requiredTier at all
    render(<UpgradePrompt {...props} />);
    expect(count(/\bGrowth\b/i)).toBeGreaterThan(0); // documents the current fabrication
  });
});
