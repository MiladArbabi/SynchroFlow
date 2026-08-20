// components/article/ArticleImage.tsx
// Inline article image with styled placeholder grid pattern when src is absent.
// Standard: every article should have up to 3 ArticleImage slots.
// Images are served root-relative from the active Next.js app public directory.

interface ArticleImageProps {
  src?: string
  alt: string
  caption?: string
  priority?: boolean
  badge?: string
  variant?: 'legacy' | 'dark'
}

export default function ArticleImage({ src, alt, caption, priority = false, badge, variant = 'legacy' }: ArticleImageProps) {
    const isDark = variant === 'dark'
    const sans = isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif"
    const fullSrc = src ? `/${src.replace(/^\/+/, '')}` : null

  return (
    <figure className="reveal article-visual-breakout" style={{ marginTop: 36, marginBottom: 36 }}>
      <div style={{
        aspectRatio: '16/9',
        border: isDark ? '1px solid var(--rule)' : '1px solid #E8E6E0',
        borderRadius: '12px',
        background: isDark ? 'var(--bg-2)' : '#F3F2EF',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {fullSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fullSrc}
            alt={alt}
            loading={priority ? 'eager' : 'lazy'}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '10px', color: isDark ? 'var(--ink-3)' : '#9CA3AF',
            backgroundImage: isDark
              ? 'linear-gradient(var(--rule) 1px, transparent 1px), linear-gradient(90deg, var(--rule) 1px, transparent 1px)'
              : 'linear-gradient(#E8E6E0 1px, transparent 1px), linear-gradient(90deg, #E8E6E0 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}>
            {badge && (
              <span style={{
                padding: '6px 12px',
                background: isDark ? 'var(--surface)' : '#FFFFFF',
                border: isDark ? '1px solid var(--rule)' : '1px solid #E8E6E0',
                borderRadius: '100px',
                fontFamily: sans,
                fontSize: '11px', fontWeight: 500,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: isDark ? 'var(--ink-3)' : '#6B7280',
              }}>
                {badge}
              </span>
            )}
            <div style={{
              fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: '18px', fontWeight: 400,
              color: isDark ? 'var(--ink-2)' : '#6B7280', textAlign: 'center',
              maxWidth: '440px', padding: '0 24px', lineHeight: 1.3,
            }}>
              {alt}
            </div>
          </div>
        )}
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
