// components/article/ProductVisual.tsx
// CSS-drawn product feature visual — same style as HeroVisual but single-column.
// Used for "PRODUCT · [FEATURE]" callout sections within article body.
// Replaces inline images for key feature highlights.

interface ProductVisualProps {
  badge: string
  title: string
  caption?: string
  variant?: 'legacy' | 'dark'
}

export default function ProductVisual({ badge, title, caption, variant = 'legacy' }: ProductVisualProps) {
  const isDark = variant === 'dark'
  const sans = isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif"

  return (
    <figure className="reveal article-visual-breakout" style={{ marginTop: 36, marginBottom: 36 }}>
      <div style={{
        aspectRatio: '16/7',
        background: isDark ? 'var(--bg-2)' : '#F3F2EF',
        border: isDark ? '1px solid var(--rule)' : '1px solid #E8E6E0',
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '40px',
      }}>
        {/* Grid background */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: isDark
            ? 'linear-gradient(var(--rule) 1px, transparent 1px), linear-gradient(90deg, var(--rule) 1px, transparent 1px)'
            : 'linear-gradient(#E8E6E0 1px, transparent 1px), linear-gradient(90deg, #E8E6E0 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, #000 20%, transparent 80%)',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, #000 20%, transparent 80%)',
          opacity: 0.6,
          pointerEvents: 'none',
        }} />
        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 60% 55% at 50% 50%, rgba(255,107,43,0.05), transparent 70%)',
          pointerEvents: 'none',
        }} />
        {/* Badge */}
        <span style={{
          position: 'relative',
          padding: '6px 14px',
          background: isDark ? 'var(--surface)' : '#FFFFFF',
          border: isDark ? '1px solid var(--rule)' : '1px solid #E8E6E0',
          borderRadius: '100px',
          fontFamily: sans,
          fontSize: '11px', fontWeight: 500,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          color: isDark ? 'var(--ink-3)' : '#6B7280',
        }}>
          {badge}
        </span>
        {/* Title */}
        <p style={{
          position: 'relative',
          fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: '22px', fontWeight: 400,
          lineHeight: 1.3, color: isDark ? 'var(--ink-2)' : '#3A3835',
          textAlign: 'center',
          maxWidth: '480px', margin: 0,
        }}>
          {title}
        </p>
      </div>
      {caption && (
        <figcaption style={{
          fontFamily: sans,
          fontSize: '13px', fontWeight: 300,
          color: isDark ? 'var(--ink-3)' : '#6B7280', marginTop: '12px',
          textAlign: 'center', maxWidth: '640px',
          marginLeft: 'auto', marginRight: 'auto',
        }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
