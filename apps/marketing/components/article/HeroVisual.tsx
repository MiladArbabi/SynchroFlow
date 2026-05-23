// components/article/HeroVisual.tsx
// CSS-drawn comparison diagram — used as hero on pillar pages.
// Shows two-column contrast: left (what Shopify tracks) vs right (what a WMS adds).
// No image required — pure CSS/HTML, always crisp.

interface HeroVisualProps {
  leftLabel: string
  leftHeading: string
  leftItems: string
  rightLabel: string
  rightHeading: string
  rightItems: string
  caption?: string
}

export default function HeroVisual({
  leftLabel, leftHeading, leftItems,
  rightLabel, rightHeading, rightItems,
  caption
}: HeroVisualProps) {
  const leftList = leftItems.split('|')
  const rightList = rightItems.split('|')
  return (
    <figure className="reveal" style={{ margin: '44px -40px 40' }}>
      <div style={{
        aspectRatio: '16/7',
        background: '#F3F2EF',
        border: '1px solid #E8E6E0',
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'stretch',
      }}>
        {/* Grid background */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(#E8E6E0 1px, transparent 1px), linear-gradient(90deg, #E8E6E0 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
          opacity: 0.5,
          pointerEvents: 'none',
        }} />
        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 70% 55% at 50% 40%, rgba(255,107,43,0.04), transparent 75%)',
          pointerEvents: 'none',
        }} />

        {/* Left column — Shopify */}
        <div style={{
          position: 'relative', padding: '44px 56px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '18px',
        }}>
          <span style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: '#6B7280',
          }}>{leftLabel}</span>
          <h4 style={{
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: '24px', fontWeight: 400,
            lineHeight: 1.15, letterSpacing: '-0.02em',
            margin: 0, color: '#0F0E0D',
          }} dangerouslySetInnerHTML={{ __html: leftHeading }} />
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: '8px' }}>
            {leftList.map((item, i) => (
              <li key={i} style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: '13px', fontWeight: 300,
                lineHeight: 1.7, color: '#3A3835',
                display: 'flex', alignItems: 'center', gap: '10px',
              }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#9CA3AF', flexShrink: 0 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Gap / arrow */}
        <div style={{
          position: 'relative',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 28px',
        }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: '50%', width: '1px',
            background: 'linear-gradient(180deg, transparent, #D1CFC8 20%, #D1CFC8 80%, transparent)',
          }} />
          <span style={{
            width: '44px', height: '44px', borderRadius: '50%',
            background: '#FFF0E8', border: '1px solid #FFDCCA',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#FF6B2B', position: 'relative', zIndex: 1, flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
            </svg>
          </span>
        </div>

        {/* Right column — WMS */}
        <div style={{
          position: 'relative', padding: '36px 40px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '18px',
        }}>
          <span style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: '#FF6B2B',
          }}>{rightLabel}</span>
          <h4 style={{
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: '24px', fontWeight: 400,
            lineHeight: 1.15, letterSpacing: '-0.02em',
            margin: 0, color: '#0F0E0D',
          }} dangerouslySetInnerHTML={{ __html: rightHeading }} />
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: '8px' }}>
            {rightList.map((item, i) => (
              <li key={i} style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: '13px', fontWeight: 300,
                lineHeight: 1.7, color: '#3A3835',
                display: 'flex', alignItems: 'center', gap: '10px',
              }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#FF6B2B', flexShrink: 0 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {caption && (
        <figcaption style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '13px', fontWeight: 300,
          color: '#6B7280', marginTop: '14px',
          textAlign: 'center', maxWidth: '640px',
          marginLeft: 'auto', marginRight: 'auto',
        }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}