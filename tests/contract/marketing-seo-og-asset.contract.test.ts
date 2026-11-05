import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const staticAsset = path.join(root, 'packages/landing-page/og_image_lightmode.png')
const nextAsset = path.join(root, 'apps/marketing/public/og_image_lightmode.png')

describe('MARKETING-P2 canonical-host social preview asset', () => {
  it('publishes the approved PNG from the canonical static deployment root', () => {
    expect(fs.existsSync(staticAsset)).toBe(true)
    const published = fs.readFileSync(staticAsset)
    const approved = fs.readFileSync(nextAsset)
    expect(published.equals(approved)).toBe(true)
    expect(published.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )).toBe(true)
  })

  it('keeps the canonical social image referenced by the checklist and content pages', () => {
    const checklist = fs.readFileSync(
      path.join(root, 'packages/landing-page/checklist/index.html'),
      'utf8'
    )
    const comparison = fs.readFileSync(
      path.join(root, 'apps/marketing/app/compare/[slug]/page.tsx'),
      'utf8'
    )
    expect(checklist).toContain('https://www.lasyncro.com/og_image_lightmode.png')
    expect(comparison).toContain('https://www.lasyncro.com/og_image_lightmode.png')
  })
})
