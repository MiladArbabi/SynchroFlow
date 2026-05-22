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
}

export default function InternalLinks({ links }: InternalLinksProps) {
  if (!links?.length) return null

  const kickers = ['Deeper dive', 'Related', 'Compare', 'Failure mode', 'Guide', 'Next step']

  return (
    <section className="reveal" style={{ borderTop: '1px solid var(--rule)', padding: '72px 0 96px' }}>
      <div style={{
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: '11px', fontWeight: 500,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: '#FF6B2B', marginBottom: '14px',
      }}>
        Keep reading
      </div>
      <h2 style={{
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        fontSize: '32px', fontWeight: 400,
        letterSpacing: '-0.02em', margin: '0 0 32px',
        color: '#0F0E0D', lineHeight: 1.12,
      }}>
        Related from the operator&apos;s library
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: links.length === 1 ? '1fr' : 'repeat(2, 1fr)',
        gap: '1px',
        border: '1px solid var(--rule)',
        borderRadius: '12px',
        overflow: 'hidden',
        background: 'var(--rule)',
      }}>
        {links.map((link, i) => (
          <a key={i} href={link.href} className="related-card" style={{
            display: 'block', padding: '24px 26px',
            background: '#FFFFFF', textDecoration: 'none',
            transition: 'background 0.15s',
          }}>
            <div style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: '11px', fontWeight: 500,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: '#9CA3AF', marginBottom: '10px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span>{link.kicker ?? kickers[i % kickers.length]}</span>
              <span style={{ color: '#FF6B2B' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
                </svg>
              </span>
            </div>
            <h4 style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: '20px', fontWeight: 400,
              letterSpacing: '-0.02em', color: '#0F0E0D',
              margin: '0 0 8px', lineHeight: 1.25,
            }}>
              {link.title}
            </h4>
            {link.description && (
              <p style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: '13px', fontWeight: 300,
                lineHeight: 1.7, color: '#6B7280', margin: 0,
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