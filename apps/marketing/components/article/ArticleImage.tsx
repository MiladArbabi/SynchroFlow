// components/article/ArticleImage.tsx
// Renders article images with SEO-optimised alt text and captions.
// If src is empty, renders a styled placeholder — drop in real src when ready.
// All images served from https://www.lasyncro.com/ (landing page static assets).

interface ArticleImageProps {
  src?: string
  alt: string
  caption?: string
  priority?: boolean
}

export default function ArticleImage({ src, alt, caption, priority = false }: ArticleImageProps) {
  const fullSrc = src ? `https://www.lasyncro.com/${src}` : null

  return (
    <figure style={{ margin: '32px 0' }}>
      {fullSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fullSrc}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: '10px',
            border: '1px solid #E8E6E0',
            display: 'block',
          }}
        />
      ) : (
        <div style={{
          width: '100%',
          aspectRatio: '16/9',
          borderRadius: '10px',
          border: '2px dashed #E8E6E0',
          background: '#F3F2EF',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '24px',
        }}>
          <span style={{ fontSize: '24px' }}>🖼</span>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#6B7280', textAlign: 'center' }}>
            {alt}
          </span>
          <span style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'center' }}>
            Image placeholder — add src prop to render
          </span>
        </div>
      )}
      {caption && (
        <figcaption style={{
          fontSize: '12px',
          color: '#9CA3AF',
          textAlign: 'center',
          marginTop: '8px',
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}