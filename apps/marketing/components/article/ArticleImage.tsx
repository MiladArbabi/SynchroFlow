// components/article/ArticleImage.tsx
// Inline article image with styled placeholder grid pattern when src is absent.
// Standard: every article should have up to 3 ArticleImage slots.
// Images served from https://www.lasyncro.com/ (landing page static assets).

interface ArticleImageProps {
  src?: string
  alt: string
  caption?: string
  priority?: boolean
  badge?: string
}

export default function ArticleImage({ src, alt, caption, priority = false, badge }: ArticleImageProps) {
  const fullSrc = src ? `https://www.lasyncro.com/${src}` : null

  return (
    <figure className="reveal" style={{ margin: '36px -40px' }}>
      <div style={{
        aspectRatio: '16/9',
        border: '1px solid #E8E6E0',
        borderRadius: '12px',
        background: '#F3F2EF',
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
            gap: '10px', color: '#9CA3AF',
            backgroundImage: 'linear-gradient(#E8E6E0 1px, transparent 1px), linear-gradient(90deg, #E8E6E0 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}>
            {badge && (
              <span style={{
                padding: '6px 12px',
                background: '#FFFFFF',
                border: '1px solid #E8E6E0',
                borderRadius: '100px',
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: '11px', fontWeight: 500,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: '#6B7280',
              }}>
                {badge}
              </span>
            )}
            <div style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '18px', fontWeight: 400,
              color: '#6B7280', textAlign: 'center',
              maxWidth: '440px', padding: '0 24px', lineHeight: 1.3,
            }}>
              {alt}
            </div>
          </div>
        )}
      </div>
      {caption && (
        <figcaption style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '13px', fontWeight: 300,
          color: '#6B7280', marginTop: '12px',
          textAlign: 'center', maxWidth: '640px',
          marginLeft: 'auto', marginRight: 'auto',
        }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}