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
  contentDriven?: boolean
  variant?: 'legacy' | 'dark'
}

export default function HeroVisual({
  leftLabel, leftHeading, leftItems,
  rightLabel, rightHeading, rightItems,
  caption,
  contentDriven = false,
  variant = 'legacy',
}: HeroVisualProps) {
  const leftList = leftItems.split('|')
  const rightList = rightItems.split('|')
  const isDark = variant === 'dark'
  const sans = isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif"
  const primary = isDark ? 'var(--ink)' : '#0F0E0D'
  const secondary = isDark ? 'var(--ink-2)' : '#3A3835'
  const muted = isDark ? 'var(--ink-3)' : '#6B7280'
  const faint = isDark ? 'var(--ink-4)' : '#9CA3AF'
  const rule = isDark ? 'var(--rule)' : '#E8E6E0'
  const ruleStrong = isDark ? 'var(--rule-2)' : '#D1CFC8'
  const surface = isDark ? 'var(--bg-2)' : '#F3F2EF'
  const accent = isDark ? 'var(--accent)' : '#FF6B2B'
  const accentGhost = isDark ? 'var(--accent-ghost)' : '#FFF0E8'
  const accentBorder = isDark ? 'var(--accent-border)' : '#FFDCCA'

  return (
    <figure
      className={contentDriven ? 'reveal blog-hero-visual-content-driven' : 'reveal article-visual-breakout article-visual-breakout--hero'}
      style={contentDriven ? { margin: '36px 0' } : { marginTop: 44, marginBottom: 40 }}
    >
      <div className={contentDriven ? undefined : 'article-visual-breakout-hero-frame'} style={{
        aspectRatio: contentDriven ? undefined : undefined,
        width: contentDriven ? '100%' : undefined,
        minHeight: contentDriven ? 300 : undefined,
        background: surface,
        border: `1px solid ${rule}`,
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: contentDriven ? 'minmax(0, 1fr) auto minmax(0, 1fr)' : undefined,
        alignItems: 'stretch',
      }}>
        {/* Grid background */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(${rule} 1px, transparent 1px), linear-gradient(90deg, ${rule} 1px, transparent 1px)`,
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
        <div className={contentDriven ? 'hero-visual-panel' : 'article-visual-breakout-hero-panel article-visual-breakout-hero-panel--left'} style={{
          position: 'relative', padding: contentDriven ? '36px 40px' : undefined,
          minWidth: contentDriven ? 0 : undefined,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '18px',
        }}>
          <span style={{
            fontFamily: sans,
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: muted,
          }}>{leftLabel}</span>
          <h4 style={{
            fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: '24px', fontWeight: 400,
            lineHeight: 1.15, letterSpacing: '-0.02em',
            margin: 0, color: primary,
          }} dangerouslySetInnerHTML={{ __html: leftHeading }} />
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: '8px' }}>
            {leftList.map((item, i) => (
              <li key={i} style={{
                fontFamily: sans,
                fontSize: '13px', fontWeight: 300,
                lineHeight: 1.7, color: secondary,
                display: 'flex', alignItems: 'center', gap: '10px',
              }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: faint, flexShrink: 0 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Gap / arrow */}
        <div className={contentDriven ? 'hero-visual-divider' : 'article-visual-breakout-hero-divider'} style={{
          position: 'relative',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: contentDriven ? '0 28px' : undefined,
        }}>
          <div className={contentDriven ? 'hero-visual-divider-line' : 'article-visual-breakout-hero-divider-line'} style={{
            position: 'absolute', top: 0, bottom: 0, left: '50%', width: '1px',
            background: `linear-gradient(180deg, transparent, ${ruleStrong} 20%, ${ruleStrong} 80%, transparent)`,
          }} />
          <span className={contentDriven ? 'hero-visual-arrow' : undefined} style={{
            width: '44px', height: '44px', borderRadius: '50%',
            background: accentGhost, border: `1px solid ${accentBorder}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: accent, position: 'relative', zIndex: 1, flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
            </svg>
          </span>
        </div>

        {/* Right column — WMS */}
        <div className={contentDriven ? 'hero-visual-panel' : 'article-visual-breakout-hero-panel article-visual-breakout-hero-panel--right'} style={{
          position: 'relative', padding: contentDriven ? '36px 40px' : undefined,
          minWidth: contentDriven ? 0 : undefined,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '18px',
        }}>
          <span style={{
            fontFamily: sans,
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: accent,
          }}>{rightLabel}</span>
          <h4 style={{
            fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: '24px', fontWeight: 400,
            lineHeight: 1.15, letterSpacing: '-0.02em',
            margin: 0, color: primary,
          }} dangerouslySetInnerHTML={{ __html: rightHeading }} />
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: '8px' }}>
            {rightList.map((item, i) => (
              <li key={i} style={{
                fontFamily: sans,
                fontSize: '13px', fontWeight: 300,
                lineHeight: 1.7, color: secondary,
                display: 'flex', alignItems: 'center', gap: '10px',
              }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: accent, flexShrink: 0 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {caption && (
        <figcaption style={{
          fontFamily: sans,
          fontSize: '13px', fontWeight: 300,
          color: muted, marginTop: '14px',
          textAlign: 'center', maxWidth: '640px',
          marginLeft: 'auto', marginRight: 'auto',
        }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
