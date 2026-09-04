import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

describe('AN-GSC-01 robots single source of truth', () => {
  it('does not allow the landing package to shadow /robots.txt', () => {
    expect(
      fs.existsSync(path.join(root, 'packages/landing-page/robots.txt'))
    ).toBe(false)
  })

  it('keeps /robots.txt proxied to the marketing app', () => {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(root, 'packages/landing-page/vercel.json'),
        'utf8'
      )
    )

    expect(config.rewrites).toContainEqual({
      source: '/robots.txt',
      destination: 'https://synchro-flow-marketing.vercel.app/robots.txt',
    })
  })

  it('preserves the crawler allowlist in the authoritative marketing source', () => {
    const robots = fs.readFileSync(
      path.join(root, 'apps/marketing/app/robots.ts'),
      'utf8'
    )

    for (const agent of [
      'Googlebot',
      'Google-Extended',
      'GPTBot',
      'ClaudeBot',
      'PerplexityBot',
      'Amazonbot',
      'cohere-ai',
      'FacebookBot',
    ]) {
      expect(robots).toContain(`userAgent: '${agent}'`)
    }

    expect(robots).toContain(
      "sitemap: 'https://www.lasyncro.com/sitemap.xml'"
    )
  })
})
