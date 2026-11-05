import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const sitemap = fs.readFileSync(
  path.join(root, 'apps/marketing/app/sitemap.ts'),
  'utf8'
)

describe('AN-GSC-01 sitemap lastmod integrity', () => {
  it('reports truthful dates for static pages changed in the November 5 marketing release', () => {
    const routes = [
      'url: BASE_URL,',
      'url: `${BASE_URL}/about`,',
      'url: `${BASE_URL}/privacy`,',
      'url: `${BASE_URL}/terms`,',
      'url: `${BASE_URL}/pricing`,',
      'url: `${BASE_URL}/faq`,',
    ]

    for (const route of routes) {
      const start = sitemap.indexOf(route)
      expect(start).toBeGreaterThanOrEqual(0)
      const entryEnd = sitemap.indexOf('},', start)
      expect(entryEnd).toBeGreaterThan(start)
      const entry = sitemap.slice(start, entryEnd)
      expect(entry).toContain("lastModified: new Date('2026-11-05')")
    }
  })

  it('never uses deployment time as sitemap freshness', () => {
    expect(sitemap).not.toMatch(/lastModified:\s*new Date\(\)/)
    expect(sitemap).not.toContain('Date.now()')
  })

  it('derives hub freshness from child content dates', () => {
    expect(sitemap).toContain('lastModified: blogLastModified')
    expect(sitemap).toContain('lastModified: compareLastModified')
    expect(sitemap).toContain('lastModified: helpLastModified')
  })

  it('derives Help category freshness from articles in that category', () => {
    expect(sitemap).toContain(
      ".filter((article) => article.category === category)"
    )
    expect(sitemap).toContain(
      '.map(({ frontmatter }) => contentDate(frontmatter))'
    )
  })

  it('uses metadata dates for dynamic content instead of build time', () => {
    expect(sitemap).toMatch(
      /lastModified:\s*contentDate\(frontmatter\)/
    )
    expect(sitemap).toContain(
      "const raw = frontmatter.lastReviewed ?? frontmatter.date"
    )
  })
})
