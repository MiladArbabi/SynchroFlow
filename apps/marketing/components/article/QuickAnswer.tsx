// components/article/QuickAnswer.tsx
// 40-60 word answer block at top of every article.
// Visually distinct — extracted by Google AI Overviews, ChatGPT, and Perplexity for citations.

interface QuickAnswerProps {
  children: React.ReactNode
}

export default function QuickAnswer({ children }: QuickAnswerProps) {
  return (
    <aside
      aria-label="Quick answer"
      style={{
        margin: '64px auto 0',
        borderRadius: '12px',
        border: '1px solid #FFDCCA',
        background: '#FFF0E8',
        padding: '20px 24px',
      }}
    >
      <p style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF6B2B', marginBottom: '8px' }}>
        Quick Answer
      </p>
      <div style={{ fontSize: '15px', lineHeight: 1.7, color: '#3A3835' }}>
        {children}
      </div>
    </aside>
  )
}