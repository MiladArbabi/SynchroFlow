import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const sitemap = fs.readFileSync(
  path.join(root, 'apps/marketing/app/sitemap.ts'),
  'utf8'
)

describe('AN-GSC-01 sitemap lastmod integrity', () => {
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
