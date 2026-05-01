// components/article/QuickAnswer.tsx
// Renders the 40-60 word answer block at the top of every article.
// Visually distinct box — extracted by Google AI Overviews, ChatGPT, and Perplexity for citations.
// RULE: Every article MUST have a QuickAnswer. Never skip this component.

interface QuickAnswerProps {
  children: React.ReactNode
}

export default function QuickAnswer({ children }: QuickAnswerProps) {
  return (
    <aside
      aria-label="Quick answer"
      className="my-6 rounded-xl border border-orange-200 bg-orange-50 px-6 py-5 dark:border-orange-900 dark:bg-orange-950/30"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-orange-500 mb-2">
        Quick Answer
      </p>
      <div className="text-base leading-relaxed text-gray-800 dark:text-gray-200">
        {children}
      </div>
    </aside>
  )
}