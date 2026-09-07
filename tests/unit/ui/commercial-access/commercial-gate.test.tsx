// tests/unit/ui/commercial-access/commercial-gate.test.tsx
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2B — TEST STRATEGY / RED
// ============================================================
// B9  — a reusable frontend route gate accepts a `capabilityId` and consumes
//       the SAME frontend decision source as nav/tabs:
//         allowed → render children
//         denied  → commercial denial / UpgradePrompt path (children NOT rendered)
// B10 — the gate is the mechanism the module route subtrees adopt.
//
// P0-A2B-VERIFY-CONTRACT-02: the decision-source mock MUST be registered
// BEFORE CommercialGate is first require()'d. A dynamic (non-literal)
// `jest.mock()` call is NOT hoisted by babel-plugin-jest-hoist — it only
// takes effect for `require()` calls that happen AFTER it executes in file
// order. CommercialGate.tsx imports `useCommercialAccess` from
// `runtime/commercialContext` at its own module-evaluation time, so the
// mock-registration loop must run before the component-probe loop requires
// CommercialGate — otherwise the real EntitlementsContext-backed hook binds
// and throws outside a provider.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { CAPABILITY_REQUIREMENTS, evaluateAccess, modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import type { AccessDecision } from '@lasyncro/commercial-policy';
import type { UpgradePromptProps } from 'components/UpgradePrompt';

const mockPromptProps = jest.fn();

jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));
// Neutralise the modal branch — not under test here.
jest.mock('components/UpgradePrompt', () => ({
  __esModule: true,
  UpgradePrompt: (props: UpgradePromptProps) => {
    mockPromptProps(props);
    return <div data-testid="upgrade-prompt" />;
  },
  default: () => <div data-testid="upgrade-prompt" />,
}));

// Mock the frontend decision source so allow/deny is deterministic. The gate
// MUST read its decision from a shared adapter — one of these names.
// Registered BEFORE the component probe below so it is in effect for
// CommercialGate's own require() of its decision source.
let mockAllowed = true;
let mockDecision: AccessDecision | undefined;
for (const rel of [
  'commercial/commercialContext',
  'commercial/commercialAccess',
  'navigation/commercialContext',
  'hooks/useCommercialAccess',
  'runtime/commercialContext',
]) {
  try {
    jest.mock(rel, () => ({
      __esModule: true,
      useCommercialAccess: () => ({
        decide: () => mockDecision ?? ({ allowed: mockAllowed, reason: mockAllowed ? 'ALLOWED' : 'TIER_TOO_LOW', requiredTier: 'growth' }),
        isResolved: true,
      }),
      buildCommercialContext: () => ({ tier: 'starter', modules: new Set<string>(), flags: new Set<string>() }),
      decideCapability: () => ({ allowed: mockAllowed, reason: mockAllowed ? 'ALLOWED' : 'TIER_TOO_LOW', requiredTier: 'growth' }),
    }), { virtual: true });
  } catch {
    /* alias not resolvable — harmless */
  }
}

// ---- resilient component probe (no hard import → no wrong-reason crash) ----
const GATE_CANDIDATES = [
  '../../../../apps/frontend/src/components/CommercialGate',
  '../../../../apps/frontend/src/runtime/CommercialGate',
  '../../../../apps/frontend/src/navigation/CommercialGate',
  '../../../../apps/frontend/src/lifecycle/CommercialGate',
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any = undefined;
for (const rel of GATE_CANDIDATES) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    mod = require(rel);
    if (mod) break;
  } catch {
    /* not this path */
  }
}
const CommercialGate = mod?.CommercialGate ?? mod?.default;

const READY = () => expect(typeof CommercialGate).toBe('function'); // RED gate — clean failure

describe('B9 — CommercialGate route gate', () => {
  it('EXPECTED RED: a CommercialGate component is exported from the frontend', () => {
    expect(typeof CommercialGate).toBe('function');
  });

  it('EXPECTED RED: allowed decision → children render', () => {
    READY();
    mockAllowed = true;
    render(
      <CommercialGate capabilityId="warehouse.operations">
        <div data-testid="protected">ok</div>
      </CommercialGate>,
    );
    expect(screen.queryByTestId('protected')).not.toBeNull();
  });

  it('EXPECTED RED: denied decision → children do NOT render, denial path shown', () => {
    READY();
    mockAllowed = false;
    render(
      <CommercialGate capabilityId="warehouse.analytics">
        <div data-testid="protected">ok</div>
      </CommercialGate>,
    );
    expect(screen.queryByTestId('protected')).toBeNull();
    expect(screen.queryByTestId('upgrade-prompt')).not.toBeNull();
  });
});

describe('COMM-TEASER-BENEFITS-02 — CommercialGate presentation inheritance', () => {
  beforeEach(() => {
    mockPromptProps.mockClear();
    mockDecision = undefined;
  });

  afterEach(() => {
    mockDecision = undefined;
  });

  it('denied Demand inherits the registry name and benefits and forwards the canonical AccessDecision', () => {
    READY();
    mockDecision = evaluateAccess(CAPABILITY_REQUIREMENTS['demand.forecasting'], {
      tier: 'core', modules: new Set(modulesForTier('core')), flags: new Set(flagsForTier('core')),
    });
    expect(mockDecision.allowed).toBe(false);
    render(
      <CommercialGate capabilityId="demand.forecasting">
        <div data-testid="protected">ok</div>
      </CommercialGate>,
    );
    const props: UpgradePromptProps = mockPromptProps.mock.calls[mockPromptProps.mock.calls.length - 1][0];
    expect(props.decision).toBe(mockDecision);
    expect(screen.queryByTestId('protected')).toBeNull();
    expect({ featureName: props.featureName, benefits: props.benefits }).toEqual({
      featureName: 'Demand',
      benefits: [
        'Identify SKUs at critical stockout risk',
        'Prioritize reorders using recent sales velocity and days of stock',
        'See suggested reorder quantities for urgent products',
        'Move from demand signals directly into purchasing and warehouse context',
      ],
    });
  });

  it('denied returns.analysis with explicit Supplier Ratings inherits the registry benefits', () => {
    READY();
    mockDecision = evaluateAccess(CAPABILITY_REQUIREMENTS['returns.analysis'], {
      tier: 'core', modules: new Set(modulesForTier('core')), flags: new Set(flagsForTier('core')),
    });
    expect(mockDecision.allowed).toBe(false);
    render(
      <CommercialGate capabilityId="returns.analysis" featureName="Supplier Ratings">
        <div data-testid="protected">ok</div>
      </CommercialGate>,
    );
    const props: UpgradePromptProps = mockPromptProps.mock.calls[mockPromptProps.mock.calls.length - 1][0];
    expect(props.decision).toBe(mockDecision);
    expect(screen.queryByTestId('protected')).toBeNull();
    expect(props.featureName).toBe('Supplier Ratings');
    expect(props.benefits).toEqual([
      'Compare suppliers by return rate across received stock',
      'Spot suspect batches with unusually high return rates',
      'See returned vs received units and affected SKUs',
      'Identify suppliers that may need a credit or quality review',
    ]);
  });

  it('denied returns.analysis with explicit Returns Analysis preserves that name without Supplier Ratings benefits', () => {
    READY();
    mockDecision = evaluateAccess(CAPABILITY_REQUIREMENTS['returns.analysis'], {
      tier: 'core', modules: new Set(modulesForTier('core')), flags: new Set(flagsForTier('core')),
    });
    expect(mockDecision.allowed).toBe(false);
    render(
      <CommercialGate capabilityId="returns.analysis" featureName="Returns Analysis">
        <div data-testid="protected">ok</div>
      </CommercialGate>,
    );
    const props: UpgradePromptProps = mockPromptProps.mock.calls[mockPromptProps.mock.calls.length - 1][0];
    expect(props.decision).toBe(mockDecision);
    expect(screen.queryByTestId('protected')).toBeNull();
    expect(props.featureName).toBe('Returns Analysis');
    expect(props.benefits).toBeUndefined();
  });
});
