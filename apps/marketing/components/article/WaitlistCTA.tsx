// components/article/WaitlistCTA.tsx
// Conversion block — mid-article (inline) and end-of-article (full).
// Uses hardcoded hex values to avoid CSS variable resolution issues.

interface WaitlistCTAProps {
  variant?: 'inline' | 'full'
  text?: string
}

export default function WaitlistCTA({ variant = 'full', text }: WaitlistCTAProps) {
  const href = 'https://lasyncro.com/#waitlist'

  if (variant === 'inline') {
    return (
      <div style={{
        margin: '32px 0',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        borderRadius: '8px',
        border: '1px solid #E8E6E0',
        background: '#F3F2EF',
        padding: '16px 20px',
      }}>
        <p style={{ flex: 1, fontSize: '14px', color: '#3A3835', margin: 0, lineHeight: 1.6 }}>
          {text ?? 'LaSyncro handles this automatically — real-time, no manual work.'}
        </p>
        <a
          href={href}
          style={{
            flexShrink: 0,
            borderRadius: '6px',
            background: '#FF6B2B',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#fff',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Start free
        </a>
      </div>
    )
  }

  return (
    <div style={{
      margin: '48px 0',
      borderRadius: '12px',
      border: '1px solid #FFDCCA',
      background: '#FFF0E8',
      padding: '40px 32px',
      textAlign: 'center',
    }}>
      <p style={{ fontSize: '18px', fontWeight: 500, color: '#0F0E0D', marginBottom: '8px' }}>
        {text ?? 'See your operation clearly for the first time.'}
      </p>
      <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '24px', lineHeight: 1.6 }}>
        41 store owners already waiting. Connect Shopify in 60 seconds. No credit card required.
      </p>
      <a
        href={href}
        style={{
          display: 'inline-block',
          borderRadius: '6px',
          background: '#FF6B2B',
          padding: '12px 24px',
          fontSize: '14px',
          fontWeight: 500,
          color: '#fff',
          textDecoration: 'none',
        }}
      >
        Reserve my spot — it&apos;s free
      </a>
    </div>
  )
}