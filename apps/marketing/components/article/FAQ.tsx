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
      <h2 style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: '1.1rem', fontWeight: 500, color: '#0F0E0D', marginBottom: '24px', letterSpacing: 0 }}>
        Frequently Asked Questions
      </h2>
      <div>
        {items.map((item, i) => (
          <div key={i} style={{ borderBottom: '1px solid #E8E6E0', paddingBottom: '20px', marginBottom: '20px' }}>
            <h3 style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: '1rem', fontWeight: 500, color: '#0F0E0D', marginBottom: '8px', lineHeight: 1.5 }}>
              {item.question}
            </h3>
            <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: '1rem', lineHeight: 1.8, color: '#3A3835', margin: 0 }}>
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}