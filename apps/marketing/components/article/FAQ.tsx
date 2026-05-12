// components/article/FAQ.tsx
// Accordion FAQ using <details>/<summary> — no JS required.
// Animated icon, FAQPage schema fed from frontmatter.

interface FAQItem {
  question: string
  answer: string
}

interface FAQProps {
  items: FAQItem[]
}

export default function FAQ({ items }: FAQProps) {
  if (!items?.length) return null
  return (
    <section style={{ borderTop: '1px solid var(--rule)', padding: '72px 0 16px' }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 2fr',
        gap: '32px', alignItems: 'start', marginBottom: '28px',
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
            letterSpacing: '-0.02em', margin: '0 0 8px',
            color: '#0F0E0D', lineHeight: 1.2,
          }}>
            Common <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>questions.</em>
          </h2>
        </div>
        <p style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '16px', fontWeight: 300,
          lineHeight: 1.6, color: '#6B7280', margin: '0',
        }}>
          The most common questions merchants ask when they realise Shopify isn´t managing their warehouse.
        </p>
      </div>

      {/* FAQ list */}
      <div style={{ borderTop: '1px solid var(--rule)' }}>
        {items.map((item, i) => (
          <details key={i} className="faq-item" open={i === 0}>
            <summary>
              {item.question}
              <span className="faq-icon" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </span>
            </summary>
            <div className="faq-answer">{item.answer}</div>
          </details>
        ))}
      </div>
    </section>
  )
}