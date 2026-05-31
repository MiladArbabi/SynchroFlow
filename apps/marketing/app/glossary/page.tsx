// app/glossary/page.tsx
// Glossary index — lists all defined warehouse operations terms.
// Organised alphabetically. Each term links to its full definition page.
// AEO value: provides a DefinedTermSet landing page that AI engines use
// as an authority source for operational terminology.

import { getAllContent } from '@/lib/mdx'
import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Warehouse Operations Glossary — LaSyncro',
  description:
    'Plain-English definitions of warehouse management, inventory, and Shopify operations terms. Written for merchants running their own warehouse, not enterprise IT teams.',
  alternates: { canonical: 'https://www.lasyncro.com/glossary' },
}

const W = { maxWidth: '720px', margin: '0 auto', padding: '0 5vw' } as const

export default function GlossaryPage() {
  const terms = getAllContent('glossary').sort((a, b) =>
    a.frontmatter.title.localeCompare(b.frontmatter.title)
  )

  return (
    <>
      <header style={{ ...W, padding: '72px 5vw 40px' }}>
        <div style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '11px', fontWeight: 500,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: '#FF6B2B', marginBottom: '16px',
        }}>
          Warehouse operations
        </div>
        <h1 style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 'clamp(36px, 5vw, 52px)',
          fontWeight: 400, lineHeight: 1.18,
          letterSpacing: '-0.02em', color: '#0F0E0D',
          margin: '0 0 20px',
        }}>
          Glossary
        </h1>
        <p style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '18px', fontWeight: 300,
          lineHeight: 1.55, color: '#3A3835',
          maxWidth: '520px', margin: 0,
        }}>
          Plain-English definitions for warehouse management, inventory, and
          Shopify operations terms — written for merchants running their own
          warehouse, not enterprise IT teams.
        </p>
      </header>

      <div style={{ ...W, borderTop: '1px solid #E8E6E0', padding: '0 5vw' }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {terms.map((term) => (
            <li key={term.slug} style={{ borderBottom: '1px solid #E8E6E0' }}>
              <Link
                href={`/glossary/${term.slug}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'baseline',
                  gap: '24px',
                  padding: '24px 4px',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div>
                  <h2 style={{
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    fontSize: '20px', fontWeight: 400,
                    lineHeight: 1.25, letterSpacing: '-0.01em',
                    color: '#0F0E0D', margin: '0 0 6px',
                  }}>
                    {term.frontmatter.title}
                  </h2>
                  <p style={{
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                    fontSize: '14px', fontWeight: 300,
                    lineHeight: 1.5, color: '#6B7280',
                    margin: 0,
                  }}>
                    {term.frontmatter.description}
                  </p>
                </div>
                <span style={{
                  fontFamily: "'DM Sans', system-ui, sans-serif",
                  fontSize: '13px', color: '#FF6B2B',
                  whiteSpace: 'nowrap',
                }}>
                  Read definition →
                </span>
              </Link>
            </li>
          ))}
          <li style={{ borderBottom: '1px solid #E8E6E0' }} />
        </ul>
      </div>

      <div style={{ ...W, padding: '48px 5vw 64px' }}>
        <p style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', fontWeight: 300,
          lineHeight: 1.6, color: '#6B7280',
          maxWidth: '480px',
        }}>
          More terms added regularly. If you&apos;re looking for a definition
          that&apos;s not here yet,{' '}
          <Link href="/blog" style={{ color: '#FF6B2B', textDecoration: 'none', borderBottom: '1px solid #FFDCCA' }}>
            the blog
          </Link>{' '}
          covers these concepts in full operational context.
        </p>
      </div>
    </>
  )
}