import fs from 'fs';
import path from 'path';

describe('Shopify App Events billing transport hardening', () => {
  const source = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'apps/backend/src/api/billing/shopify.events.service.ts'
    ),
    'utf8'
  );

  it('pins billing events to the stable 2026-07 App Events API', () => {
    expect(source).toContain(
      "https://api.shopify.com/app/2026-07/events"
    );
    expect(source).not.toContain(
      "https://api.shopify.com/app/unstable/events"
    );
  });

  it('requires the App Events write scope before accepting a minted token', () => {
    expect(source).toContain(
      "write_global_api_app_events"
    );

    expect(source).toMatch(
      /scope[\s\S]{0,500}write_global_api_app_events[\s\S]{0,500}throw new Error/
    );
  });
});
