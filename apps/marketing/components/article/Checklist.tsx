// components/article/Checklist.tsx
// Numbered evaluation checklist — orange prefix, bordered grid rows.
// Usage in MDX (string): <Checklist items="Does it connect via OAuth?|Is setup under 60 seconds?" />
// Usage in MDX (array):  <Checklist items={['Does it connect via OAuth?', 'Is setup under 60 seconds?']} />
interface ChecklistProps {
  items: string | string[]
}
export default function Checklist({ items }: ChecklistProps) {
  // Accept both pipe-delimited string and array
  const itemList = Array.isArray(items) ? items : items.split('|')
  return (
    <div style={{
      margin: '8px 0 22px',
      display: 'grid', gap: '1px',
      background: '#E8E6E0',
      border: '1px solid #E8E6E0',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      {itemList.map((item, i) => (
        <div key={i} style={{
          background: '#FFFFFF', padding: '14px 18px',
          display: 'grid', gridTemplateColumns: '24px 1fr',
          gap: '12px', alignItems: 'start',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', fontWeight: 400,
          lineHeight: 1.55, color: '#3A3835',
        }}>
          <span style={{ color: '#FF6B2B', fontWeight: 500 }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  )
}