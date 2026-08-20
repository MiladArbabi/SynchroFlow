// components/article/NumberedH3.tsx
// Numbered section heading — serif italic number prefix matching design template.
// Usage in MDX: <NumberedH3 n="1" title="Section heading text" />
interface NumberedH3Props {
  n: string
  title: string
  variant?: 'legacy' | 'dark'
}
export default function NumberedH3({ n, title, variant = 'legacy' }: NumberedH3Props) {
  const isDark = variant === 'dark'

  return (
    <h3 style={{
      display: 'flex', alignItems: 'baseline', gap: '12px',
      fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
      fontSize: '18px', fontWeight: 500,
      lineHeight: 1.3, color: isDark ? 'var(--ink)' : '#0F0E0D',
      margin: '44px 0 14px',
    }}>
      <span style={{
        fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
        fontSize: '15px', fontWeight: 400,
        lineHeight: 1, color: isDark ? 'var(--accent)' : '#FF6B2B',
        fontStyle: 'italic', flexShrink: 0,
      }}>
        {n}.
      </span>
      <span>{title}</span>
    </h3>
  )
}
