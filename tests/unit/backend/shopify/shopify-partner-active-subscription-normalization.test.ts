type Normalized = {
  tier: string;
  status: string;
  isEntitled: boolean;
  planHandle: string | null;
};

type Normalizer = (activeSubscription: unknown) => Normalized;

function loadNormalizer(): Normalizer {
  // Dynamic require keeps this RED contract loadable before the future export
  // exists; failures point at the missing boundary rather than import syntax.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('api-src/services/shopify/shopifyBillingReconciliation.service');
  if (typeof mod.normalizePartnerActiveSubscriptionToBillingState !== 'function') {
    throw new Error(
      '[MON-REM-01B-4] missing Partner API normalization boundary: ' +
        'normalizePartnerActiveSubscriptionToBillingState(activeSubscription)',
    );
  }
  return mod.normalizePartnerActiveSubscriptionToBillingState;
}

function activeSubscription(handles: string[]) {
  return {
    id: 'gid://shopify/AppSubscription/123',
    status: 'ACTIVE',
    currentPeriodEnd: '2099-01-01T00:00:00Z',
    lineItems: handles.map((handle, i) => ({
      id: `gid://shopify/AppSubscriptionLineItem/${i + 1}`,
      plan: {
        pricingDetails: {
          __typename: i === 0 ? 'AppRecurringPricing' : 'AppUsagePricing',
          planHandle: handle,
          interval: i === 0 ? 'EVERY_30_DAYS' : undefined,
          price: i === 0 ? { amount: '249.00', currencyCode: 'USD' } : undefined,
          cappedAmount: i === 0 ? undefined : { amount: '999.00', currencyCode: 'USD' },
        },
      },
    })),
  };
}

describe('MON-REM-01B-4 — Partner API activeSubscription normalization', () => {
  it('normalizes growth plan item while ignoring shipped-order usage item', () => {
    const normalize = loadNormalizer();
    expect(normalize(activeSubscription(['growth', 'shipped-order']))).toMatchObject({
      tier: 'growth',
      status: 'active',
      isEntitled: true,
      planHandle: 'growth',
    });
  });

  it('normalizes canonical starter handle to starter', () => {
    const normalize = loadNormalizer();
    expect(normalize(activeSubscription(['starter']))).toMatchObject({
      tier: 'starter',
      planHandle: 'starter',
    });
  });

  // GH-1128: `early-access` was a pre-launch Shopify public plan, since
  // deleted from the Partner Dashboard (LaSyncro has not launched — there is
  // no customer-migration purpose to preserve). It must fail closed like any
  // other retired/unrecognized commercial handle, never silently normalize
  // to starter.
  it('fails closed for the retired early-access handle (GH-1128)', () => {
    const normalize = loadNormalizer();
    expect(() => normalize(activeSubscription(['early-access']))).toThrow();
  });

  it('fails closed for unknown commercial plan handles', () => {
    const normalize = loadNormalizer();
    expect(() => normalize(activeSubscription(['enterprise-2027', 'shipped-order']))).toThrow();
  });

  it('never treats shipped-order usage meter handle as a tier', () => {
    const normalize = loadNormalizer();
    expect(() => normalize(activeSubscription(['shipped-order']))).toThrow();
  });
});
