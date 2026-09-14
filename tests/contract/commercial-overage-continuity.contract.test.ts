// MON-REM-01B-2 — paid warehouse execution and provider-meter continuity.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string) =>
  fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('MON-REM-01B-2 — commercial overage continuity', () => {
  it('EXPECTED RED: paid WMS execution no longer throws because overage preference is disabled', () => {
    const src = read('apps/backend/src/api/wms/wms.controller.ts');
    expect(src).not.toMatch(/throw new OverageDisabledError/);
  });

  it('EXPECTED RED: missing Stripe/Shopify identity does not abort pack-complete', () => {
    const src = read('apps/backend/src/api/wms/wms.controller.ts');

    expect(src).not.toMatch(
      /if\s*\(\s*!stripeCustomerId\s*\)[\s\S]{0,180}?throw new OverageBillingUnavailableError/
    );

    expect(src).not.toMatch(
      /if\s*\(\s*!installation\?\.shop_gid\s*\)[\s\S]{0,180}?throw new OverageBillingUnavailableError/
    );
  });

  it('GREEN CONTROL: unsupported billing provider may still fail closed', () => {
    const src = read('apps/backend/src/api/wms/wms.controller.ts');
    expect(src).toMatch(
      /else\s*\{[\s\S]{0,180}?throw new OverageBillingUnavailableError/
    );
  });

  it('EXPECTED RED: Shopify reporter no longer treats Scale as unlimited', () => {
    const src = read('apps/backend/src/api/billing/shopify.events.service.ts');
    expect(src).not.toMatch(/context\.tier === ['"]scale['"]/);
    expect(src).not.toContain('scale_has_unlimited_shipped_orders');
  });

  it('GREEN CONTROL: Stripe reporter bases overage on the canonical finite allowance', () => {
    const src = read('apps/backend/src/api/billing/stripe.meter.service.ts');
    expect(src).toContain('shippedOrderCap');
    expect(src).not.toMatch(/tier\s*===\s*['"]scale['"]/);
  });
});
