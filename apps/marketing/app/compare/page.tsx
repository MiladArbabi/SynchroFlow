// app/compare/page.tsx
// Comparison hub — links to all competitor comparison pages.
// Builds topical authority around alternatives. Add new comparisons to /content/compare/*.mdx.
// IMPORTANT: No font: shorthand in inline styles — CSS vars don't resolve in font shorthand.

import { Metadata } from 'next'
import { getAllContent } from '@/lib/mdx'

export const metadata: Metadata = {
  title: 'LaSyncro vs Alternatives — Compare Shopify Operations Tools',
  description: 'See how LaSyncro compares to Cin7, Linnworks, Brightpearl and other Shopify operations tools. Built for SMB merchants who need power without enterprise complexity.',
  alternates: { canonical: 'https://www.lasyncro.com/compare' },
  openGraph: {
    title: 'LaSyncro vs Alternatives — Compare Shopify Operations Tools',
    description: 'See how LaSyncro compares to Cin7, Linnworks, Brightpearl and other Shopify operations tools.',
    url: 'https://www.lasyncro.com/compare',
    type: 'website',
    images: [{ url: 'https://www.lasyncro.com/og_image_lightmode.png', width: 1200, height: 630 }],
  },
}

function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
    </svg>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

export default function CompareIndex() {
  const pages = getAllContent('compare').sort(
    (a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

  return (
    <>
      <style>{`
        a { color: inherit; text-decoration: none; }
        .compare-row:hover { background: #F3F2EF !important; }
        .compare-row:hover .compare-title { color: #FF6B2B !important; }
        .compare-row:hover .compare-arrow { color: #FF6B2B !important; transform: translateX(4px); }
        .compare-arrow { transition: color .15s, transform .15s; }
        .compare-title { transition: color .15s; }
        @media (max-width: 720px) {
          .compare-row-grid { grid-template-columns: 1fr !important; }
          .compare-arrow-col { display: none !important; }
        }
      `}</style>

      {/* ── Page header ───────────────────────────────────────────── */}
      <header style={{ ...W, padding: '96px 5vw 56px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B2B', display: 'inline-block' }} />
          Operator-honest comparisons
        </div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 64, fontWeight: 400, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 32px', maxWidth: 820 }}>
          LaSyncro vs{' '}
          <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>the alternatives.</em>
        </h1>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 18, fontWeight: 300, lineHeight: 1.55, color: '#3A3835', maxWidth: 560, margin: 0 }}>
          How LaSyncro compares to enterprise WMS and operations tools — built for Shopify merchants who need operational intelligence without the enterprise price tag.
        </p>
      </header>

      {/* ── Filter strip ──────────────────────────────────────────── */}
      <div style={{ ...W, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 5vw', borderTop: '1px solid #E8E6E0', borderBottom: '1px solid #E8E6E0' }}>
        <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 400, color: '#6B7280' }}>
          All comparisons
        </span>
        <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 400, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 16, color: '#0F0E0D', fontStyle: 'italic' }}>
            {pages.length}
          </span>
          tools compared
        </div>
      </div>

      {/* ── Compare list ──────────────────────────────────────────── */}
      {pages.length === 0 && (
        <p style={{ ...W, padding: '24px 5vw', color: '#9CA3AF', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14 }}>
          Comparison pages coming soon.
        </p>
      )}
      <ul style={{ ...W, listStyle: 'none', padding: '0 5vw', margin: '0 auto' }}>
        {pages.map((page) => (
          <li key={page.slug} style={{ borderTop: '1px solid #E8E6E0' }}>
            <a href={`/compare/${page.slug}`} className="compare-row" style={{
              display: 'grid', gridTemplateColumns: '1fr 180px auto',
              gap: 28, alignItems: 'baseline', padding: '28px 4px', transition: 'padding .2s, background .15s',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#FF6B2B', flexShrink: 0 }} />
                  <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#FF6B2B' }}>
                    {page.frontmatter.tags?.[0]}
                  </span>
                </div>
                <h2 className="compare-title" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 22, fontWeight: 400, lineHeight: 1.25, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 6px' }}>
                  {page.frontmatter.title}
                </h2>
                <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, lineHeight: 1.55, color: '#6B7280', margin: 0, maxWidth: 560 }}>
                  {page.frontmatter.description}
                </p>
              </div>
              <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 400, color: '#6B7280', letterSpacing: '0.04em' }}>
                {formatDate(page.frontmatter.date)}
              </span>
              <span className="compare-arrow compare-arrow-col" style={{ color: '#9CA3AF', alignSelf: 'center' }}>
                <ArrowRight size={16} />
              </span>
            </a>
          </li>
        ))}
        <li style={{ borderTop: '1px solid #E8E6E0' }} />
      </ul>

      {/* ── Bottom CTA ────────────────────────────────────────────── */}
      <section style={{ ...W, padding: '80px 5vw 64px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 20 }}>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.6, color: '#6B7280', margin: 0, maxWidth: 480 }}>
          Don&apos;t see your current tool? Every comparison is operator-honest — we&apos;ll tell you when a competitor is a better fit.
        </p>
        <a href="https://lasyncro.com/#waitlist" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '12px 24px', background: '#FF6B2B', color: '#fff',
          fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
          borderRadius: 6, textDecoration: 'none',
        }}>
          Get early access
          <ArrowRight size={14} />
        </a>
      </section>
    </>
  )
}