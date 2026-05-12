// components/article/FAQ.tsx
// Pure CSS accordion using checkbox hack — no JS, instant, performant.
// Styles inlined to avoid Tailwind purging. One open at a time via radio.

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
      <style dangerouslySetInnerHTML={{ __html: `
        input[type="radio"].faq-r { position:absolute; opacity:0; width:0; height:0; pointer-events:none; }
        .faq-row { border-top:1px solid #D1CFC8; border-bottom:1px solid #D1CFC8; margin-bottom:-1px; }
        label.faq-lbl {
          display:grid; grid-template-columns:1fr auto; gap:20px; align-items:center;
          padding:22px 0; cursor:pointer; user-select:none;
          font-family:'DM Sans',system-ui,sans-serif;
          font-size:16px; font-weight:500; line-height:1.35; color:#0F0E0D;
          transition:color 0.15s;
        }
        label.faq-lbl:hover { color:#FF6B2B; }
        .faq-ico {
          width:30px; height:30px; border-radius:50%;
          background:#FFF0E8; border:1.5px solid #FFDCCA;
          display:inline-flex; align-items:center; justify-content:center;
          color:#CC4A12; flex-shrink:0;
          transition:transform 0.25s cubic-bezier(0.4,0,0.2,1),background 0.15s,border-color 0.15s;
        }
        .faq-bd { display:grid; grid-template-rows:0fr; transition:grid-template-rows 0.3s cubic-bezier(0.4,0,0.2,1); }
        .faq-bd-i { overflow:hidden; }
        .faq-bd-t {
          padding-bottom:24px;
          font-family:'DM Sans',system-ui,sans-serif;
          font-size:15px; font-weight:300; line-height:1.75; color:#3A3835;
          max-width:640px;
        }
        input[type="radio"].faq-r:checked + label.faq-lbl .faq-ico {
          transform:rotate(45deg); background:#FFDCCA; border-color:#FF6B2B;
        }
        input[type="radio"].faq-r:checked ~ .faq-bd { grid-template-rows:1fr; }
      ` }} />

      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 2fr',
        gap: '32px', alignItems: 'start', marginBottom: '40px',
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
          lineHeight: 1.6, color: '#3A3835', margin: '0', paddingTop: '4px',
        }}>
          The most common questions merchants ask when they realise Shopify is not managing their warehouse.
        </p>
      </div>

      {/* FAQ items */}
      <div>
        {items.map((item, i) => (
          <div key={i} className="faq-row">
            <input
              type="radio"
              id={`faq-r-${i}`}
              name="faq-group"
              className="faq-r"
            />
            <label htmlFor={`faq-r-${i}`} className="faq-lbl">
              <span style={{ color: '#0F0E0D', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: '16px', fontWeight: 500 }}>
                {item.question}
              </span>
              <span className="faq-ico" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </span>
            </label>
            <div className="faq-bd">
              <div className="faq-bd-i">
                <div className="faq-bd-t" style={{ color: '#3A3835', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: '15px', fontWeight: 300 }}>
                  {item.answer}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}