import fs from 'node:fs'
import path from 'node:path'

const article = fs.readFileSync(
  path.resolve(__dirname, '../../apps/marketing/content/blog/best-wms-for-shopify-small-business.mdx'),
  'utf8'
)

describe('MARKETING-P3-A: contextual ecomPanda editorial reference', () => {
  const destination = 'https://www.ecompanda.co/blog/shopify-inventory-management-apps'
  const nativeStart = '<NumberedH3 n="6" title="Shopify native inventory — for early-stage operations" />'
  const stockyStart = '## What About Shopify Stocky?'

  it('places the approved comparison inside the native Shopify section, not unrelated sections', () => {
    const start = article.indexOf(nativeStart)
    const end = article.indexOf(stockyStart)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const section = article.slice(start, end)
    expect(section).toContain(`[Ecompanda's comparison of Shopify inventory management apps](${destination})`)
    expect(section).toContain('forecasting, purchasing, or stock syncing')
  })

  it('contains one natural reciprocal destination and retains the original section boundary', () => {
    expect(article.split(destination)).toHaveLength(2)
    expect(article).toContain(stockyStart)
    expect(article).not.toContain('https://www.ecompanda.co/blog/ecommerce-tools')
  })
})
