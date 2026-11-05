import fs from 'fs'
import path from 'path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('MARKETING-P1: buyer-facing messaging agrees with product contracts', () => {
  test('privacy disclosures reflect consent-based analytics identifiers and transmission boundary', () => {
    const policy = source('apps/marketing/app/privacy/page.tsx')
    expect(policy).toContain('Google Analytics')
    expect(policy).toContain('Cookie preferences')
    expect(policy).toContain('pseudonymous PostHog identifier')
    expect(policy).toContain('PostHog events recorded while consent was granted')
    expect(policy).not.toContain('We do not use advertising cookies or tracking cookies')
    expect(policy).not.toContain('This data is not linked to personally identifiable information')
  })

  test('terms reflect actual Shopify write scopes and free Starter availability', () => {
    const terms = source('apps/marketing/app/terms/page.tsx')
    const scopes = source('apps/backend/src/services/shopify/shopifyScopes.ts')
    expect(scopes).toContain("'write_inventory'")
    expect(scopes).toContain("'write_fulfillments'")
    expect(terms).toContain('writing inventory and fulfillment updates')
    expect(terms).toContain('free Starter tier')
    expect(terms).not.toContain('read-only mode by default')
    expect(terms).not.toContain('requests read-only access')
    expect(terms).not.toContain('After the trial, continued use requires a paid subscription')
  })

  test('public FAQs do not promise an inventory push on every scan', () => {
    const faq = source('apps/marketing/app/faq/page.tsx')
    expect(faq).toContain('A scan does not guarantee an immediate Shopify stock change')
    expect(faq).toContain('Shopify inventory updates happen at defined workflow points')
    expect(faq).not.toContain('There is no end-of-day reconciliation, no batch sync window, and no lag')
  })

  test('public launch CTA uses the existing availability gate', () => {
    const article = source('apps/marketing/components/article/ArticleCTA.tsx')
    const compare = source('apps/marketing/components/compare/CompareCTA.tsx')
    const gate = source('apps/marketing/app/api/shopify-availability/route.ts')
    expect(gate).toContain("process.env.SHOPIFY_APP_AVAILABLE === 'true'")
    expect(article).toContain('useShopifyAvailability')
    expect(article).toContain("'/pricing#launch-pricing'")
    expect(compare).toContain('useShopifyAvailability')
    expect(compare).toContain("'/pricing#launch-pricing'")
  })

  test('published LaSyncro paid starting price matches canonical Core economics', () => {
    const limits = source('packages/commercial-policy/src/limits.ts')
    expect(limits).toContain('core: 9900')
    for (const file of [
      'apps/marketing/content/compare/brightpearl-alternative.mdx',
      'apps/marketing/content/compare/cin7-alternative.mdx',
      'apps/marketing/content/compare/linnworks-alternative.mdx',
      'apps/marketing/content/blog/best-wms-for-shopify-small-business.mdx',
    ]) {
      const content = source(file)
      expect(content).toMatch(/\$99\/month/)
      expect(content).not.toMatch(/LaSyncro[^\n]{0,120}\$79\/month/i)
    }
  })
})
