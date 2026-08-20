'use client'

import { usePostHog } from 'posthog-js/react'

interface ArticleCTAProps {
  variant?: 'inline' | 'full'
  theme?: 'legacy' | 'dark'
  text?: string
  href?: string
  label?: string
}

export default function ArticleCTA({ variant = 'full', theme = 'legacy', text, href, label }: ArticleCTAProps) {
  const ph = usePostHog()
  // Defaults keep legacy CTAs safe; article frontmatter can override destination and label per search intent.
  const targetHref = href ?? 'https://app.lasyncro.com'
  const targetLabel = label ?? 'Start free'
  const isDark = theme === 'dark'

  function handleClick() {
    ph?.capture('blog_cta_clicked', {
      variant,
      cta_label: targetLabel,
      cta_href: targetHref,
      location: variant,
    })
  }

  if (variant === 'inline') {
    return (
      <div style={{
        margin: '40px 0 8px', display: 'flex', alignItems: 'center', gap: '16px',
        borderRadius: '8px', border: isDark ? '1px solid var(--rule)' : '1px solid #E8E6E0',
        background: isDark ? 'var(--bg-2)' : '#F3F2EF', padding: '16px 20px',
      }}>
        <p style={{
          flex: 1, fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', color: isDark ? 'var(--ink-2)' : '#3A3835', margin: 0, lineHeight: 1.6,
        }}>
          {text ?? 'LaSyncro handles this automatically — real-time, no manual work.'}
        </p>
        <a href={targetHref} onClick={handleClick} style={{
          flexShrink: 0, borderRadius: '6px', background: isDark ? 'var(--accent)' : '#FF6B2B',
          padding: '8px 16px', fontSize: '13px', fontWeight: 500,
          color: isDark ? 'var(--on-accent)' : '#fff', textDecoration: 'none', whiteSpace: 'nowrap',
          fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
        }}>
          {targetLabel}
        </a>
      </div>
    )
  }

  return (
    <div style={{
      margin: '64px 0 8px', background: isDark ? 'var(--bg-2)' : '#151D29', color: isDark ? 'var(--ink)' : '#F0EEE8',
      border: isDark ? '1px solid var(--rule)' : undefined,
      borderRadius: '14px', padding: '36px 40px',
      display: 'grid', gridTemplateColumns: '1fr auto', gap: '28px', alignItems: 'center',
    }}>
      <div>
        <h3 style={{
          fontFamily: isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: '26px', fontWeight: 400, lineHeight: 1.2,
          letterSpacing: '-0.02em', margin: '0 0 6px', color: isDark ? 'var(--ink)' : '#F0EEE8',
        }}>
          {text ?? 'See your operation clearly for the first time.'}
        </h3>
        <p style={{
          margin: 0, fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', fontWeight: 300, lineHeight: 1.6,
          color: isDark ? 'var(--ink-2)' : 'rgba(240,238,232,0.7)', maxWidth: '460px',
        }}>
          Connect Shopify in 60 seconds. No credit card required.
        </p>
      </div>
      <a href={targetHref} onClick={handleClick} style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '12px 22px', background: isDark ? 'var(--accent)' : '#FF6B2B', color: isDark ? 'var(--on-accent)' : '#fff',
        fontFamily: isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif",
        fontSize: '14px', fontWeight: 500,
        borderRadius: '8px', textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
        {targetLabel}
      </a>
    </div>
  )
}
