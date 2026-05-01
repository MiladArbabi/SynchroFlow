// components/article/FAQ.tsx
// Renders FAQ section from frontmatter faq[] array.
// H3 headings are question-format — critical for AI Overview extraction.

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
    <section aria-label="Frequently asked questions" style={{ marginTop: '48px' }}>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 400, color: 'var(--ink)', marginBottom: '24px' }}>
        Frequently Asked Questions
      </h2>
      <div>
        {items.map((item, i) => (
          <div key={i} style={{ borderBottom: '1px solid var(--rule)', paddingBottom: '24px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)', marginBottom: '8px' }}>
              {item.question}
            </h3>
            <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--ink-3)', margin: 0 }}>
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}