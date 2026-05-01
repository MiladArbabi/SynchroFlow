// app/compare/page.tsx
// Comparison hub — links to all competitor comparison pages.
// Builds topical authority around alternatives. Add new comparisons to /content/compare/*.mdx.

import { Metadata } from 'next'
import { getAllContent } from '@/lib/mdx'

export const metadata: Metadata = {
  title: 'LaSyncro vs Alternatives — Compare Shopify Operations Tools',
  description: 'See how LaSyncro compares to Cin7, Linnworks, Brightpearl and other Shopify operations tools. Built for SMB merchants who need power without enterprise complexity.',
  alternates: { canonical: 'https://lasyncro.com/compare' },
}

export default function CompareIndex() {
  const pages = getAllContent('compare').sort(
    (a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

  return (
    <main style={{ maxWidth: '680px', margin: '0 auto', padding: '48px 0' }}>
      <h1 style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 400, color: 'var(--ink)', marginBottom: '8px' }}>
        LaSyncro vs Alternatives
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--ink-3)', marginBottom: '48px', lineHeight: 1.6 }}>
        How LaSyncro compares to enterprise WMS and operations tools — built for Shopify merchants who need operational intelligence without the enterprise price tag.
      </p>

      {pages.length === 0 && (
        <p style={{ color: 'var(--ink-4)' }}>Comparison pages coming soon.</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {pages.map((page) => (
          <li key={page.slug} style={{
            background: '#FFFFFF',
            border: '1px solid #E8E6E0',
            borderRadius: '12px',
            marginBottom: '16px',
            overflow: 'hidden',
          }}>
            <a href={`/compare/${page.slug}`} style={{
              textDecoration: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '24px 28px',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF6B2B' }}>
                {page.frontmatter.tags?.[0]}
              </span>
              <span style={{ fontSize: '18px', fontWeight: 500, color: '#0F0E0D', lineHeight: 1.4 }}>
                {page.frontmatter.title}
              </span>
              <span style={{ fontSize: '14px', color: '#6B7280', lineHeight: 1.6 }}>
                {page.frontmatter.description}
              </span>
              <span style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
                {page.frontmatter.date}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}