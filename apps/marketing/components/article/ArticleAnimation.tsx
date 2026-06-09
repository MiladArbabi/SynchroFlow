interface ArticleAnimationProps {
  src: string
  title: string
  caption?: string
}

export default function ArticleAnimation({ src, title, caption }: ArticleAnimationProps) {
  return (
    <figure className="reveal" style={{ margin: '36px -40px' }}>
      <div
        style={{
          aspectRatio: '16/9',
          border: '1px solid #E8E6E0',
          borderRadius: '12px',
          background: '#151D29',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <iframe
          src={src}
          title={title}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            border: 0,
            display: 'block',
            background: '#151D29',
          }}
        />
      </div>

      {caption && (
        <figcaption
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '13px',
            fontWeight: 300,
            color: '#6B7280',
            marginTop: '12px',
            textAlign: 'center',
            maxWidth: '640px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  )
}