import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const landing = fs.readFileSync(
  path.join(root, 'packages/landing-page/index.html'),
  'utf8'
)

describe('AN-GSC-01 Getting Started internal navigation', () => {
  it('links directly to the canonical Help destination', () => {
    expect(landing).toContain('href="/help/getting-started"')
  })

  it('does not internally link to the redirecting legacy path', () => {
    expect(landing).not.toContain('href="/getting-started"')
  })
})
