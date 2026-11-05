import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const route = read('apps/marketing/app/blog/[slug]/page.tsx')
const articles = {
  en: 'shopify-warehouse-management',
  sv: 'shopify-lagerhantering',
  da: 'shopify-lagerstyring',
} as const

describe('MARKETING-P2-C: localized warehouse guide boundaries', () => {
  it('defines one explicit reciprocal three-language family without applying it to all posts', () => {
    for (const [lang, slug] of Object.entries(articles)) {
      expect(route).toContain(`{ lang: '${lang}', slug: '${slug}'`)
    }
    expect(route).toContain('WMS_LANGUAGE_VERSIONS.find((version) => version.slug === slug)')
    expect(route).toContain('...(language ? { languages: WMS_LANGUAGE_ALTERNATES } : {})')
    expect(route).toContain('canonical: `https://www.lasyncro.com/blog/${slug}`')
  })

  it('includes navigable reciprocal links and scoped Swedish/Danish article semantics', () => {
    expect(route).toContain('aria-label="Article language"')
    expect(route).toContain('hrefLang={version.lang}')
    expect(route).toContain("aria-current={language.lang === version.lang ? 'page' : undefined}")
    expect(route).toContain('lang={language?.lang}')
    expect(route).toContain('contentLanguage={language?.lang}')
  })

  it.each(['sv', 'da'] as const)('keeps %s localized claims aligned with prelaunch and sync truth', (lang) => {
    const mdx = read(`apps/marketing/content/blog/${articles[lang]}.mdx`)
    expect(mdx).toContain('lastReviewed: "2026-11-05"')
    expect(mdx).not.toMatch(/60 sekunder|4 minutter|4 minuter|operationelt samme dag|Operativt samma dag/i)
    expect(mdx).not.toMatch(/eliminerar avvikelse|eliminerer afvigelse/i)
    expect(mdx).not.toMatch(/(?:realtid från varje skanning|realtid fra hver skanning)/i)
    expect(mdx).toMatch(/synkronisering/i)
    expect(mdx).toContain('https://app.lasyncro.com/register')
  })

  it('keeps the English guide available as the canonical language-family member', () => {
    const en = read('apps/marketing/content/blog/shopify-warehouse-management.mdx')
    expect(en).toContain('Shopify Warehouse Management: Where Shopify Stops and a WMS Starts')
    expect(en).toContain('join the launch list')
  })
})
