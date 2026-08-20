// components/article/FAQ.tsx
// Pure CSS accordion using checkbox hack — no JS, instant, performant.
// Styles inlined to avoid Tailwind purging. One open at a time via radio.

interface FAQItem {
  question: string
  answer: string
}

interface FAQProps {
  items: FAQItem[]
  variant?: 'legacy' | 'dark'
}

export default function FAQ({ items, variant = 'legacy' }: FAQProps) {
  if (!items?.length) return null
  const isDark = variant === 'dark'
  const sans = isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif"
  const primary = isDark ? 'var(--ink)' : '#0F0E0D'
  const secondary = isDark ? 'var(--ink-2)' : '#3A3835'
  const rule = isDark ? 'var(--rule)' : '#D1CFC8'
  const accent = isDark ? 'var(--accent)' : '#FF6B2B'
  const iconBg = isDark ? 'var(--accent-ghost)' : '#FFF0E8'
  const iconBorder = isDark ? 'var(--accent-border)' : '#FFDCCA'
  const iconColor = isDark ? 'var(--accent-hover)' : '#CC4A12'
  const checkedBg = isDark ? 'rgba(255,107,43,0.2)' : '#FFDCCA'

  return (
    <section style={{ padding: '0 0 16px' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        input[type="radio"].faq-r { position:absolute; opacity:0; width:0; height:0; pointer-events:none; }
        .faq-header {
          display:grid; grid-template-columns:1fr 2fr; gap:32px; align-items:start; margin-bottom:40px;
        }
        .faq-row { border-top:1px solid ${rule}; border-bottom:1px solid ${rule}; margin-bottom:-1px; }
        label.faq-lbl {
          display:grid; grid-template-columns:1fr auto; gap:20px; align-items:center;
          padding:22px 0; cursor:pointer; user-select:none;
          font-family:${sans};
          font-size:16px; font-weight:500; line-height:1.35; color:${primary};
          transition:color 0.15s;
        }
        label.faq-lbl:hover { color:${accent}; }
        .faq-ico {
          width:30px; height:30px; border-radius:50%;
          background:${iconBg}; border:1.5px solid ${iconBorder};
          display:inline-flex; align-items:center; justify-content:center;
          color:${iconColor}; flex-shrink:0;
          transition:transform 0.25s cubic-bezier(0.4,0,0.2,1),background 0.15s,border-color 0.15s;
        }
        .faq-bd { display:grid; grid-template-rows:0fr; transition:grid-template-rows 0.3s cubic-bezier(0.4,0,0.2,1); }
        .faq-bd-i { overflow:hidden; }
        .faq-bd-t {
          padding-bottom:24px;
          font-family:${sans};
          font-size:15px; font-weight:300; line-height:1.75; color:${secondary};
          max-width:640px;
        }
        input[type="radio"].faq-r:checked + label.faq-lbl .faq-ico {
          transform:rotate(45deg); background:${checkedBg}; border-color:${accent};
        }
        input[type="radio"].faq-r:checked ~ .faq-bd { grid-template-rows:1fr; }
        @media (max-width:720px) {
          .faq-header { grid-template-columns:1fr; gap:24px; }
        }
      ` }} />

      {/* Header */}
      <div className="faq-header">
        <div>
          <div style={{
            fontFamily: sans,
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: accent, marginBottom: '14px',
          }}>FAQ</div>
          <h2 style={{
            fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: '36px', fontWeight: 400,
            letterSpacing: '-0.02em', margin: 0,
            color: primary, lineHeight: 1.2,
          }}>
            Common <em style={{ color: accent, fontStyle: 'italic' }}>questions.</em>
          </h2>
        </div>
        <p style={{
          fontFamily: sans,
          fontSize: '16px', fontWeight: 300,
          lineHeight: 1.6, color: secondary, margin: '0', paddingTop: '4px',
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
              <span style={{ color: primary, fontFamily: sans, fontSize: '16px', fontWeight: 500 }}>
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
                <div className="faq-bd-t" style={{ color: secondary, fontFamily: sans, fontSize: '15px', fontWeight: 300 }}>
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
