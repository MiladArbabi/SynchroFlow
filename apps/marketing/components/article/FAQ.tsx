'use client'
// components/article/FAQ.tsx
// Client-side accordion FAQ — full control over animation and styling.
// No native <details> — avoids browser/Tailwind preflight conflicts.

import { useState } from 'react'

interface FAQItem {
  question: string
  answer: string
}

interface FAQProps {
  items: FAQItem[]
}

function FAQItem({ question, answer, defaultOpen = false }: FAQItem & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{
      borderTop: '1px solid #E8E6E0',
      borderBottom: '1px solid #E8E6E0',
      marginBottom: '-1px',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '20px 0',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '20px',
          alignItems: 'center',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '16px',
          fontWeight: 500,
          lineHeight: 1.35,
          color: '#0F0E0D',
          textAlign: 'left',
          transition: 'color 0.15s',
        }}
        aria-expanded={open}
      >
        <span>{question}</span>
        {/* Orange circular icon — + spins to × on open */}
        <span style={{
          width: '30px',
          height: '30px',
          borderRadius: '50%',
          background: open ? '#FFDCCA' : '#FFF0E8',
          border: `1.5px solid ${open ? '#FF6B2B' : '#FFDCCA'}`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#CC4A12',
          flexShrink: 0,
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1), background 0.15s, border-color 0.15s',
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </span>
      </button>

      {/* Answer — smooth height transition via max-height */}
      <div style={{
        overflow: 'hidden',
        maxHeight: open ? '400px' : '0',
        transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{
          paddingBottom: '24px',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '15px',
          fontWeight: 300,
          lineHeight: 1.7,
          color: '#3A3835',
          maxWidth: '640px',
        }}>
          {answer}
        </div>
      </div>
    </div>
  )
}

export default function FAQ({ items }: FAQProps) {
  if (!items?.length) return null
  return (
    <section style={{ padding: '0 0 16px' }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 2fr',
        gap: '32px',
        alignItems: 'start',
        marginBottom: '40px',
      }}>
        <div>
          <div style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: '#FF6B2B', marginBottom: '14px',
          }}>FAQ</div>
          <h2 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: '36px', fontWeight: 400,
            letterSpacing: '-0.02em',
            margin: 0,
            color: '#0F0E0D', lineHeight: 1.2,
          }}>
            Common <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>questions.</em>
          </h2>
        </div>
        <p style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '16px', fontWeight: 300,
          lineHeight: 1.6, color: '#6B7280', margin: '0',
          paddingTop: '4px',
        }}>
          The most common questions merchants ask when they realise Shopify is not managing their warehouse.
        </p>
      </div>

      {/* FAQ list */}
      <div>
        {items.map((item, i) => (
          <FAQItem
            key={i}
            question={item.question}
            answer={item.answer}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </section>
  )
}