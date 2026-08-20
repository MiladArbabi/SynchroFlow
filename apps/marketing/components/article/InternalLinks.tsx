// components/article/InternalLinks.tsx
// Related articles grid — 2-column card layout with arrow hover effect.
// Matches the "Keep reading" section from the design template.

interface LinkItem {
  href: string
  title: string
  description?: string
  kicker?: string
}

interface InternalLinksProps {
  links: LinkItem[]
  variant?: 'legacy' | 'blogDark' | 'dark'
}

export default function InternalLinks({ links, variant = 'legacy' }: InternalLinksProps) {
  if (!links?.length) return null

  const isDark = variant === 'blogDark' || variant === 'dark'
  const kickers = ['Deeper dive', 'Related', 'Compare', 'Failure mode', 'Guide', 'Next step']

  return (
    <section
      className={isDark ? 'reveal blog-related-links' : 'reveal'}
      style={isDark
        ? {
            background: 'var(--bg-2)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-lg)',
            padding: '32px 36px',
          }
        : { borderTop: '1px solid var(--rule)', padding: '72px 0 96px' }}
    >
      <div style={{
        fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
        fontSize: '11px', fontWeight: 500,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: isDark ? 'var(--accent)' : '#FF6B2B', marginBottom: '14px',
      }}>
        Keep reading
      </div>
      <h2 style={{
        fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
        fontSize: '32px', fontWeight: 400,
        letterSpacing: isDark ? 'var(--ls-tight)' : '-0.02em', margin: '0 0 32px',
        color: isDark ? 'var(--ink)' : '#0F0E0D', lineHeight: 1.12,
      }}>
        Related from the operator&apos;s library
      </h2>

      <div className={isDark ? 'blog-related-link-grid' : undefined} style={{
        display: 'grid',
        gridTemplateColumns: links.length === 1 ? '1fr' : 'repeat(2, 1fr)',
        gap: '1px',
        border: '1px solid var(--rule)',
        borderRadius: isDark ? 'var(--r-md)' : '12px',
        overflow: 'hidden',
        background: 'var(--rule)',
      }}>
        {links.map((link, i) => (
          <a key={i} href={link.href} className={isDark ? 'blog-related-card' : 'related-card'} style={{
            display: 'block', padding: '24px 26px',
            background: isDark ? 'var(--surface)' : '#FFFFFF', textDecoration: 'none',
            border: isDark ? '1px solid transparent' : undefined,
            transition: isDark ? 'background 0.15s, border-color 0.15s' : 'background 0.15s',
          }}>
            <div style={{
              fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
              fontSize: '11px', fontWeight: 500,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: isDark ? 'var(--ink-3)' : '#9CA3AF', marginBottom: '10px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span>{link.kicker ?? kickers[i % kickers.length]}</span>
              <span className={isDark ? 'blog-related-arrow' : undefined} style={{ color: isDark ? 'var(--accent)' : '#FF6B2B' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
                </svg>
              </span>
            </div>
            <h4 style={{
              fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: '20px', fontWeight: 400,
              letterSpacing: isDark ? 'var(--ls-tight)' : '-0.02em', color: isDark ? 'var(--ink)' : '#0F0E0D',
              margin: '0 0 8px', lineHeight: 1.25,
            }}>
              {link.title}
            </h4>
            {link.description && (
              <p style={{
                fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
                fontSize: '13px', fontWeight: 300,
                lineHeight: 1.7, color: isDark ? 'var(--ink-2)' : '#6B7280', margin: 0,
              }}>
                {link.description}
              </p>
            )}
          </a>
        ))}
      </div>
    </section>
  )
}
