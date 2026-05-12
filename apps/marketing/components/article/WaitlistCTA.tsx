// components/article/WaitlistCTA.tsx
// Inline (mid-article) and full (end-of-article) conversion blocks.
// Full variant uses dark space-1 background matching the design template.

interface WaitlistCTAProps {
  variant?: 'inline' | 'full'
  text?: string
}

export default function WaitlistCTA({ variant = 'full', text }: WaitlistCTAProps) {
  const href = 'https://www.lasyncro.com/#waitlist'

  if (variant === 'inline') {
    return (
      <div style={{
        margin: '40px 0 8px',
        display: 'flex', alignItems: 'center', gap: '16px',
        borderRadius: '8px', border: '1px solid #E8E6E0',
        background: '#F3F2EF', padding: '16px 20px',
      }}>
        <p style={{
          flex: 1, fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', color: '#3A3835', margin: 0, lineHeight: 1.6,
        }}>
          {text ?? 'LaSyncro handles this automatically — real-time, no manual work.'}
        </p>
        <a href={href} style={{
          flexShrink: 0, borderRadius: '6px', background: '#FF6B2B',
          padding: '8px 16px', fontSize: '13px', fontWeight: 500,
          color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>
          Start free
        </a>
      </div>
    )
  }

  return (
    <div className="reveal" id="cta" style={{
      margin: '64px 0 8px',
      background: '#151D29',
      color: '#F0EEE8',
      borderRadius: '14px',
      padding: '36px 40px',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '28px',
      alignItems: 'center',
    }}>
      <div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '11px', fontWeight: 500,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: '#FF6B2B', marginBottom: '12px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: '#FF6B2B', display: 'inline-block',
            animation: 'qa-blink 2.4s ease-in-out infinite',
          }} />
          Operational in 60 seconds
        </span>
        <h3 style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: '26px', fontWeight: 400, lineHeight: 1.2,
          letterSpacing: '-0.02em', margin: '0 0 6px', color: '#F0EEE8',
        }}>
          {text ?? 'A full warehouse management layer for Shopify.'}
        </h3>
        <p style={{
          margin: 0, fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', fontWeight: 300, lineHeight: 1.6,
          color: 'rgba(240,238,232,0.7)', maxWidth: '460px',
        }}>
          41 store owners already waiting. Connect Shopify in 60 seconds. No credit card required.
        </p>
      </div>
      <a href={href} style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '12px 22px', background: '#FF6B2B', color: '#fff',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: '14px', fontWeight: 500,
        borderRadius: '8px', textDecoration: 'none', whiteSpace: 'nowrap',
        transition: 'background 0.15s',
      }}>
        Get early access
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
        </svg>
      </a>
    </div>
  )
}