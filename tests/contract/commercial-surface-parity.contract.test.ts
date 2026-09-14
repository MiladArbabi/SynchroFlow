import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function planBlock(src: string, tier: string, nextTier?: string): string {
  const start = src.indexOf(`tier: '${tier}'`);
  if (start < 0) throw new Error(`Plan ${tier} not found`);

  const end = nextTier ? src.indexOf(`tier: '${nextTier}'`, start + 1) : src.length;
  return src.slice(start, end < 0 ? src.length : end);
}

describe('MON-REM-01B-4 — commercial surface parity', () => {
  const marketing = read('apps/marketing/components/pricing/PricingPlans.tsx');
  const billing = read('apps/frontend/src/pages/account-settings/BillingSettings.tsx');
  const postTrial = read('apps/frontend/src/components/PostTrialInterstitial.tsx');
  const shippedBanner = read('apps/frontend/src/components/ShippedOrderCapBanner.tsx');
  const pricingDisplay = read('apps/frontend/src/config/pricingDisplay.ts');
  const billingController = read('apps/backend/src/api/billing/billing.controller.ts');
  const billingRoutes = read('apps/backend/src/api/billing/billing.routes.ts');
  const help = read('apps/marketing/content/help/billing/manage-plan-usage-and-payments.mdx');

  it('public pricing matches the ratified monthly USD PLG model', () => {
    const starter = planBlock(marketing, 'Starter', 'Core');
    const core = planBlock(marketing, 'Core', 'Growth');
    const growth = planBlock(marketing, 'Growth', 'Scale');
    const scale = planBlock(marketing, 'Scale');

    expect(starter).toMatch(/monthly:\s*0/);
    expect(starter).toMatch(/owner only/i);
    expect(starter).toMatch(/1 location/i);
    expect(starter).toMatch(/30[- ]day history/i);
    expect(starter).not.toMatch(/50 warehouse-processed orders/i);

    expect(core).toMatch(/monthly:\s*99/);
    expect(core).toMatch(/2,000 warehouse-processed orders/i);
    expect(core).toMatch(/\$0\.08 per additional processed order/i);
    expect(core).toMatch(/3 non-owner seats/i);
    expect(core).toMatch(/1 location/i);
    expect(core).toMatch(/90[- ]day history/i);

    expect(growth).toMatch(/monthly:\s*249/);
    expect(growth).toMatch(/7,500 warehouse-processed orders/i);
    expect(growth).toMatch(/\$0\.06 per additional processed order/i);
    expect(growth).toMatch(/10 non-owner seats/i);
    expect(growth).toMatch(/3 locations/i);
    expect(growth).toMatch(/365[- ]day history/i);

    expect(scale).toMatch(/monthly:\s*599/);
    expect(scale).toMatch(/20,000 warehouse-processed orders/i);
    expect(scale).toMatch(/\$0\.04 per additional processed order/i);
    expect(scale).toMatch(/25 non-owner seats/i);
    expect(scale).toMatch(/10 locations/i);
    expect(scale).toMatch(/730[- ]day history/i);
    expect(scale).toMatch(/priority support/i);
  });

  it('public pricing is monthly-only and never markets unlimited capacity', () => {
    expect(marketing).not.toMatch(/\bunlimited\b/i);
    expect(marketing).not.toMatch(/billingInterval/i);
    expect(marketing).not.toMatch(/annual:\s*[0-9]/i);
    expect(marketing).not.toMatch(/Annual plans are billed/i);
  });

  it('frontend monthly USD display anchors match $99 / $249 / $599', () => {
    expect(pricingDisplay).toMatch(/core[\s\S]{0,500}USD:\s*\{\s*monthly:\s*99\b/);
    expect(pricingDisplay).toMatch(/growth[\s\S]{0,500}USD:\s*\{\s*monthly:\s*249\b/);
    expect(pricingDisplay).toMatch(/scale[\s\S]{0,500}USD:\s*\{\s*monthly:\s*599\b/);
  });

  it('Billing Settings reflects finite Growth/Scale capacity and no unlimited claims', () => {
    expect(billing).not.toMatch(/\bunlimited\b/i);
    expect(billing).toMatch(/growth:\s*['"][^'"]*10 non-owner seats/i);
    expect(billing).toMatch(/scale:\s*['"][^'"]*25 non-owner seats/i);
    expect(billing).toMatch(/priority support/i);

    // New self-service purchase selection is monthly-only.
    expect(billing).not.toMatch(/<BillingToggle\b/);
  });

  it('existing subscription display does not fabricate its charged amount from new-plan display pricing', () => {
    expect(billing).not.toMatch(
      /monthlyPrice[\s\S]{0,500}PEGGED_DISPLAY_PRICES|PEGGED_DISPLAY_PRICES[\s\S]{0,500}monthlyPrice/
    );
  });

  it('post-trial PLG surface uses Growth 10 seats and finite Scale positioning', () => {
    expect(postTrial).not.toMatch(/\bunlimited\b/i);
    expect(postTrial).not.toMatch(/\b5 seats\b/i);
    expect(postTrial).toMatch(/\b10 seats\b/i);
    expect(postTrial).toMatch(/priority support/i);
  });

  it('processed-order usage UX never claims paid fulfillment is paused or requires opt-in overage', () => {
    expect(shippedBanner).not.toMatch(
      /paused|blocked|enable pay-per-order|setup-payment-method|avoid an interruption/i
    );
    expect(shippedBanner).not.toMatch(/tier\s*===\s*['"]scale['"]/);
    expect(shippedBanner).toMatch(/overage/i);
  });

  it('ingested order telemetry is not a merchant commercial gating surface', () => {
    const frontendRoot = path.join(ROOT, 'apps/frontend/src');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;

        const rel = path.relative(ROOT, full).replace(/\\/g, '/');
        if (rel.endsWith('/OrderCapBanner.tsx')) continue;

        const src = fs.readFileSync(full, 'utf8');

        // Count only an actual rendered commercial surface. Comments,
        // ShippedOrderCapBanner, helper references, etc. are not violations.
        if (/<OrderCapBanner(?:\s|\/|>)/.test(src)) offenders.push(rel);
      }
    };

    walk(frontendRoot);
    expect(offenders).toEqual([]);
  });

  it('new Stripe self-service checkout remains Scale-capable but USD-monthly only', () => {
    const start = billingController.indexOf('export async function createCheckoutSession');
    const end = billingController.indexOf(
      'export async function createSetupSession',
      start
    );
    const checkout = billingController.slice(start, end);

    expect(checkout).toMatch(/core[\s\S]{0,100}growth[\s\S]{0,100}scale/i);
    expect(checkout).not.toMatch(/tier\s*===\s*['"]scale['"]/);

    expect(checkout).toMatch(/interval\s*!==\s*['"]monthly['"]/);
    expect(checkout).not.toMatch(/interval\s*!==\s*['"]annual['"]/);

    expect(checkout).toMatch(
      /billingCurrency[\s\S]{0,250}(?:!==|!=)\s*['"]USD['"]/
    );
  });

  it('legacy provider recognition remains separate from new self-service checkout ownership', () => {
    const providerResolver = read(
      'apps/backend/src/services/billing/providerPriceResolver.service.ts'
    );

    // Existing provider contracts must remain recognizable.
    expect(providerResolver).toMatch(/\bPRICE_ID_ENV_KEYS\b/);

    // New checkout must not reuse the generic legacy forward resolver.
    const start = billingController.indexOf('export async function createCheckoutSession');
    const end = billingController.indexOf(
      'export async function createSetupSession',
      start
    );
    const checkout = billingController.slice(start, end);

    expect(checkout).not.toMatch(/\bgetStripePriceId\s*\(/);
  });

  it('obsolete allow_overage merchant API is removed from subscription and routing surfaces', () => {
    expect(billingRoutes).not.toMatch(/['"]\/overage['"]/);
    expect(billingRoutes).not.toMatch(/updateOveragePreference/);

    const start = billingController.indexOf('export async function getSubscription');
    const end = billingController.indexOf(
      'export async function updateOveragePreference',
      start
    );
    const subscription = billingController.slice(start, end);

    expect(subscription).not.toMatch(/allow_overage/);
  });

  it('billing help describes processed-order usage, finite Scale, and no ingested-order allowance', () => {
    expect(help).not.toMatch(/\bunlimited\b/i);
    expect(help).not.toMatch(/orders ingested/i);
    expect(help).not.toMatch(/at the limit|hard limit|paused/i);
    expect(help).toMatch(/processed order/i);
    expect(help).toMatch(/priority support/i);
  });
});
