// components/article/QuickAnswer.tsx
// 40-60 word answer block at top of every article.
// Visually distinct — extracted by Google AI Overviews, ChatGPT, and Perplexity for citations.

interface QuickAnswerProps {
  children: React.ReactNode
  variant?: 'legacy' | 'dark'
}

export default function QuickAnswer({ children, variant = 'legacy' }: QuickAnswerProps) {
  const isDark = variant === 'dark'

  return (
    <aside
      aria-label="Quick answer"
      style={{
        margin: '64px auto 0',
        borderRadius: '12px',
        border: isDark ? '1px solid var(--accent-border)' : '1px solid #FFDCCA',
        background: isDark ? 'var(--accent-ghost)' : '#FFF0E8',
        padding: '20px 24px',
      }}
    >
      <p style={{ fontFamily: isDark ? 'var(--sans)' : undefined, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: isDark ? 'var(--accent)' : '#FF6B2B', marginBottom: '8px' }}>
        Quick Answer
      </p>
      <div style={{ fontFamily: isDark ? 'var(--sans)' : undefined, fontSize: '15px', lineHeight: 1.7, color: isDark ? 'var(--ink-2)' : '#3A3835' }}>
        {children}
      </div>
    </aside>
  )
}
