// components/article/FAQ.tsx
// Pure CSS accordion — no JS, no hydration issues, fully performant.
// Uses checkbox hack: hidden checkbox drives open/close state via CSS :checked selector.
// Orange circular icon rotates 45deg on open via CSS transition.

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
          lineHeight: 1.6, color: '#6B7280', margin: '0',
          paddingTop: '4px',
        }}>
          The most common questions merchants ask when they realise Shopify is not managing their warehouse.
        </p>
      </div>

      {/* CSS for checkbox accordion */}
      <style>{`
        .faq-cb { display: none; }
        .faq-row { border-top: 1px solid #E8E6E0; border-bottom: 1px solid #E8E6E0; margin-bottom: -1px; }
        .faq-label {
          display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: center;
          padding: 20px 0; cursor: pointer; user-select: none;
          font-family: 'DM Sans', system-ui, sans-serif;
          font-size: 16px; font-weight: 500; line-height: 1.35; color: #0F0E0D;
          transition: color 0.15s;
        }
        .faq-label:hover { color: #FF6B2B; }
        .faq-plus {
          width: 30px; height: 30px; border-radius: 50%;
          background: #FFF0E8; border: 1.5px solid #FFDCCA;
          display: inline-flex; align-items: center; justify-content: center;
          color: #CC4A12; flex-shrink: 0;
          transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), background 0.15s, border-color 0.15s;
        }
        .faq-body {
          display: grid; grid-template-rows: 0fr;
          transition: grid-template-rows 0.3s cubic-bezier(0.4,0,0.2,1);
        }
        .faq-body-inner {
          overflow: hidden;
          font-family: 'DM Sans', system-ui, sans-serif;
          font-size: 15px; font-weight: 300; line-height: 1.7; color: #3A3835;
          max-width: 640px;
        }
        .faq-cb:checked ~ .faq-label .faq-plus {
          transform: rotate(45deg); background: #FFDCCA; border-color: #FF6B2B;
        }
        .faq-cb:checked ~ .faq-body { grid-template-rows: 1fr; }
        .faq-body-inner-pad { padding-bottom: 24px; }
        @media (prefers-color-scheme: dark) {
          .faq-row { border-color: rgba(255,255,255,0.08); }
          .faq-label { color: #F0EEE8; }
          .faq-plus { background: rgba(255,107,43,0.12); border-color: rgba(255,107,43,0.25); color: #FF8C5A; }
          .faq-cb:checked ~ .faq-label .faq-plus { background: rgba(255,107,43,0.2); border-color: #FF6B2B; }
          .faq-body-inner { color: #C8C4BB; }
        }
      `}</style>

      {/* FAQ list */}
      <div>
        {items.map((item, i) => (
          <div key={i} className="faq-row">
            <input
              type="checkbox"
              id={`faq-${i}`}
              className="faq-cb"
              defaultChecked={i === 0}
            />
            <label htmlFor={`faq-${i}`} className="faq-label">
              <span>{item.question}</span>
              <span className="faq-plus" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </span>
            </label>
            <div className="faq-body">
              <div className="faq-body-inner">
                <div className="faq-body-inner-pad">{item.answer}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}