import fs from 'fs';
import path from 'path';

describe('Shopify Managed Pricing retired callback contract', () => {
  const routesPath = path.join(
    process.cwd(),
    'apps/backend/src/api/shopify/shopify.billing.routes.ts'
  );

  const routesSource = fs.readFileSync(routesPath, 'utf8');

  it('does not register the retired unauthenticated billing callback', () => {
    expect(routesSource).not.toMatch(
      /router\.get\(\s*['"]\/callback['"]\s*,\s*handleShopifyCallback\s*\)/
    );
  });

  it('does not import the retired callback handler into the active billing router', () => {
    expect(routesSource).not.toMatch(/\bhandleShopifyCallback\b/);
  });
});
