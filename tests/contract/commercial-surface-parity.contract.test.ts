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
    expect(scale).not.toMatch(/priority support/i);
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
    expect(billing).not.toMatch(/priority support/i);
    expect(billing).not.toMatch(/Paid plans aren't available yet/i);
    expect(billing).not.toMatch(/no Shopify-side paid plans exist yet/i);
    expect(billing).toMatch(/Plan changes for Shopify-billed stores are managed through Shopify/i);

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
    expect(postTrial).toMatch(/20,000 processed orders/i);
    expect(postTrial).toMatch(/25 seats/i);
    expect(postTrial).toMatch(/10 locations/i);
    expect(postTrial).toMatch(/730[- ]day history/i);
    expect(postTrial).not.toMatch(/priority support/i);
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

  it('obsolete allow_overage merchant API and writer are removed from production billing surfaces', () => {
    expect(billingRoutes).not.toMatch(/['"]\/overage['"]/);
    expect(billingRoutes).not.toMatch(/updateOveragePreference/);
    expect(billingController).not.toMatch(
      /export async function updateOveragePreference/
    );

    const start = billingController.indexOf('export async function getSubscription');
    const subscription = billingController.slice(start);

    expect(subscription).not.toMatch(/allow_overage/);
  });

  it('billing help describes processed-order usage, finite Scale, and no ingested-order allowance', () => {
    expect(help).not.toMatch(/\bunlimited\b/i);
    expect(help).not.toMatch(/orders ingested/i);
    expect(help).not.toMatch(/at the limit|hard limit|paused/i);
    expect(help).toMatch(/processed order/i);
    expect(help).not.toMatch(/priority support/i);
  });
});

describe('MON-REM-01B-FINAL-02 — current commercial truth residue', () => {
  const limits = read('packages/commercial-policy/src/limits.ts');
  const pricingConfig = read('packages/backend-core/src/config/pricing.config.ts');
  const llms = read('packages/landing-page/llms.txt');
  const playbook = read('docs/playbooks/monetization_billing_playbook.md');
  const shopifySubmission = read('docs/playbooks/shopify_submission_playbook.md');
  const billingController = read('apps/backend/src/api/billing/billing.controller.ts');
  const shopifyReporter = read('apps/backend/src/api/billing/shopify.events.service.ts');

  function section(src: string, start: string, end?: string): string {
    const from = src.indexOf(start);
    if (from < 0) throw new Error(`Section start not found: ${start}`);

    if (!end) return src.slice(from);

    const to = src.indexOf(end, from + start.length);
    return src.slice(from, to < 0 ? src.length : to);
  }

  it('canonical source comments describe finite self-service Scale, not private/contact Scale', () => {
    expect(limits).not.toMatch(
      /internal\/private commercial anchor|Contact\s*\/\s*negotiated/i
    );
    expect(limits).toMatch(/scale:\s*59900/);

    expect(pricingConfig).not.toMatch(
      /USD:\s*Core \$79\s*\/\s*Growth \$179\s*\/\s*Scale \$349/i
    );

    expect(pricingConfig).toMatch(
      /scale:[\s\S]{0,250}USD:\s*\{\s*monthly:\s*59900\b/
    );
  });

  it('public llms pricing matches the finite $99 / $249 / $599 PLG model', () => {
    const pricing = section(llms, '## Pricing', '## Key pages');

    expect(pricing).toMatch(/Core:\s*\$99\/month/i);
    expect(pricing).toMatch(/Growth:\s*\$249\/month/i);
    expect(pricing).toMatch(/Scale:\s*\$599\/month/i);

    expect(pricing).toMatch(/20,000[\s\S]{0,100}processed orders/i);
    expect(pricing).toMatch(/25[\s-]*non-owner seats/i);
    expect(pricing).toMatch(/10 locations/i);
    expect(pricing).toMatch(/730[- ]day history/i);
    expect(pricing).not.toMatch(/Priority support/i);

    expect(pricing).not.toMatch(/\bunlimited\b/i);
    expect(pricing).not.toMatch(/dedicated support/i);
    expect(pricing).not.toMatch(/\$79|\$179|\$349/);
  });

  it('current playbook tier architecture reflects the canonical finite commercial model', () => {
    const current = section(
      playbook,
      '## 1. Tier Architecture',
      '## 1.1 MON-REM-01A'
    );

    expect(current).toMatch(/\$99/);
    expect(current).toMatch(/\$249/);
    expect(current).toMatch(/\$599/);

    expect(current).toMatch(/Core[\s\S]{0,160}3 non-owner seats/i);
    expect(current).toMatch(/Growth[\s\S]{0,160}10 non-owner seats/i);
    expect(current).toMatch(/Scale[\s\S]{0,160}25 non-owner seats/i);

    expect(current).toMatch(/Starter[\s\S]{0,200}0[\s\S]{0,120}processed/i);
    expect(current).toMatch(/Core[\s\S]{0,200}2,000[\s\S]{0,120}processed/i);
    expect(current).toMatch(/Growth[\s\S]{0,200}7,500[\s\S]{0,120}processed/i);
    expect(current).toMatch(/Scale[\s\S]{0,200}20,000[\s\S]{0,120}processed/i);

    expect(current).toMatch(/30[- ]day history/i);
    expect(current).toMatch(/90[- ]day history/i);
    expect(current).toMatch(/365[- ]day history/i);
    expect(current).toMatch(/730[- ]day history/i);

    expect(current).not.toMatch(/\bunlimited\b/i);
    expect(current).not.toMatch(/\$79|\$179|\$349/);
  });

  it('playbook current architecture no longer presents Starter PPO as active commercial truth', () => {
    const current = section(
      playbook,
      '## 1. Tier Architecture',
      '## 1.1 MON-REM-01A'
    );
    const backendFlow = section(
      playbook,
      '## 5. Backend Data Flow',
      '## 6. Shopify App Store Billing Path'
    );
    const ppo03 = section(
      playbook,
      '### MON-PPO-03',
      '### MON-PPO-03 runtime proof'
    );
    const monAllow04 = section(
      playbook,
      '## 29. MON-ALLOW-04',
      '## 30.'
    );

    expect(current).toMatch(/Starter[\s\S]{0,200}0[\s\S]{0,120}processed/i);
    expect(current).toMatch(/Core[\s\S]{0,200}2,000[\s\S]{0,120}processed/i);
    expect(current).toMatch(/Growth[\s\S]{0,200}7,500[\s\S]{0,120}processed/i);
    expect(current).toMatch(/Scale[\s\S]{0,200}20,000[\s\S]{0,120}processed/i);
    expect(current).toMatch(/\$99/);
    expect(current).toMatch(/\$249/);
    expect(current).toMatch(/\$599/);
    expect(current).not.toMatch(/\bunlimited\b/i);

    expect(backendFlow).toMatch(/Historical Pay-Per-Order Setup[\s\S]{0,120}RETIRED by MON-REM-01B/i);
    expect(backendFlow).toMatch(/POST \/api\/v1\/billing\/setup-payment-method no longer enables Starter PPO/i);
    expect(backendFlow).toMatch(/Starter has no WMS processed-order allowance/i);
    expect(backendFlow).toMatch(/paid tiers continue above allowance using automatic overage economics/i);
    expect(backendFlow).not.toMatch(/Starter is the primary caller/i);
    expect(backendFlow).not.toMatch(/Enable pay-per-order/i);
    expect(backendFlow).not.toMatch(/PPO continues/i);

    expect(ppo03).toMatch(/HISTORICAL[\s\S]{0,80}SUPERSEDED/i);
    expect(ppo03).toMatch(/MON-PPO-03[\s\S]{0,120}superseded by MON-ALLOW-04/i);
    expect(ppo03).toMatch(/MON-ALLOW-04[\s\S]{0,120}superseded by MON-REM-01B/i);
    expect(ppo03).toMatch(/Current commercial authority[\s\S]{0,120}MON-REM-01B/i);
    expect(ppo03).not.toMatch(/current contract is defined by MON-ALLOW-04/i);

    expect(monAllow04).toMatch(/SUPERSEDED by MON-REM-01B/i);
  });

  it('legacy MON-ALLOW-04 commercial values are explicitly superseded, not labelled current', () => {
    const legacy = section(
      playbook,
      '## 29. MON-ALLOW-04',
      '## 30.'
    );

    expect(legacy).toMatch(/SUPERSEDED[\s\S]{0,300}MON-REM-01B/i);
    expect(legacy).not.toMatch(/### Current commercial contract/i);
  });

  it('historical Shopify App Events commercial values are explicitly superseded', () => {
    const monetizationEvents = section(
      playbook,
      '## 27. Shopify App Events Usage Reporting',
      '## 28.'
    );

    const submissionEvents = section(
      shopifySubmission,
      '### Shopify App Events usage billing',
      '## Fly.io Deployment Notes'
    );

    expect(monetizationEvents).toMatch(
      /HISTORICAL[\s\S]{0,160}SUPERSEDED by MON-REM-01B/i
    );

    expect(submissionEvents).toMatch(
      /HISTORICAL[\s\S]{0,160}SUPERSEDED by MON-REM-01B/i
    );
  });

  it('GREEN CONTROL: runtime already supports self-service finite Scale and does not skip Scale overage', () => {
    const checkoutStart = billingController.indexOf(
      'export async function createCheckoutSession'
    );
    const checkoutEnd = billingController.indexOf(
      'export async function createSetupSession',
      checkoutStart
    );
    const checkout = billingController.slice(checkoutStart, checkoutEnd);

    expect(checkout).toMatch(/core[\s\S]{0,120}growth[\s\S]{0,120}scale/i);
    expect(checkout).not.toMatch(/tier\s*===\s*['"]scale['"]/);

    expect(shopifyReporter).not.toMatch(
      /context\.tier\s*===\s*['"]scale['"]/
    );
    expect(shopifyReporter).not.toContain(
      'scale_has_unlimited_shipped_orders'
    );
  });
});
