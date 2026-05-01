// components/article/FAQ.tsx
// Renders FAQ section from frontmatter faq[] array.
// Feeds FAQPage schema automatically via generateFAQSchema() in the parent page.
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
    <section aria-label="Frequently asked questions" className="mt-12">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        Frequently Asked Questions
      </h2>
      <div className="space-y-6">
        {items.map((item, i) => (
          <div key={i} className="border-b border-gray-200 dark:border-gray-700 pb-6">
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-2">
              {item.question}
            </h3>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}