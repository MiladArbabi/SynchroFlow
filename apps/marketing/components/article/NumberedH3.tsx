// components/article/NumberedH3.tsx
// Numbered section heading — serif italic number prefix matching design template.
// Usage in MDX: <NumberedH3 num="01">Receiving workflows</NumberedH3>

interface NumberedH3Props {
  num: string
  children: React.ReactNode
}

export default function NumberedH3({ num, children }: NumberedH3Props) {
  return (
    <h3 style={{
      display: 'flex', alignItems: 'baseline', gap: '12px',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: '17px', fontWeight: 500,
      lineHeight: 1.3, color: '#0F0E0D',
      margin: '36px 0 12px',
    }}>
      <span style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontSize: '14px', fontWeight: 400,
        lineHeight: 1, color: '#FF6B2B',
        fontStyle: 'italic', flexShrink: 0,
      }}>
        {num}
      </span>
      <span>{children}</span>
    </h3>
  )
}