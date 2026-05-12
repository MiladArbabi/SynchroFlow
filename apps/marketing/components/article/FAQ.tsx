// components/article/FAQ.tsx
// Pure CSS radio accordion — one open at a time, no JS, instant response.
// Radio inputs with same name group = only one open at a time.
// All closed by default — click open item again to close (using :checked toggle trick).

interface FAQItem {
  question: string
  answer: string
}

interface FAQProps {
  items: FAQItem[]
}

export default function FAQ({ items }: FAQProps) {
  if (!items?.length) return null

  const groupName = 'faq-group'

  return (
    <section style={{ padding: '0 0 16px' }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 2fr',
        gap: '32px',
        alignItems: 'start',
        marginBottom: '40px',
      }}>
        <div>
          <div style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: '#FF6B2B', marginBottom: '14px',
          }}>FAQ</div>
          <h2 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: '36px', fontWeight: 400,
            letterSpacing: '-0.02em', margin: 0,
            color: '#0F0E0D', lineHeight: 1.2,
          }}>
            Common <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>questions.</em>
          </h2>
        </div>
        <p style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '16px', fontWeight: 300,
          lineHeight: 1.6, color: '#3A3835', margin: '0',
          paddingTop: '4px',
        }}>
          The most common questions merchants ask when they realise Shopify is not managing their warehouse.
        </p>
      </div>

      <div>
        {items.map((item, i) => (
          <div key={i} className="faq-row">
            <input
              type="radio"
              id={`faq-${groupName}-${i}`}
              name={groupName}
              className="faq-radio"
            />
            <label htmlFor={`faq-${groupName}-${i}`} className="faq-label">
              <span>{item.question}</span>
              <span className="faq-plus" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </span>
            </label>
            <div className="faq-body">
              <div className="faq-body-inner">
                <div className="faq-body-text">{item.answer}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}