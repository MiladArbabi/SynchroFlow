'use client'

import { usePostHog } from 'posthog-js/react'

interface ArticleCTAProps {
  variant?: 'inline' | 'full'
  text?: string
  href?: string
}

export default function ArticleCTA({ variant = 'full', text, href }: ArticleCTAProps) {
  const ph = usePostHog()
  // Default keeps legacy CTAs safe; article frontmatter can override this per search intent.
  const targetHref = href ?? 'https://app.lasyncro.com'

  function handleClick() {
    ph?.capture('blog_cta_clicked', {
      variant,
      cta_label: variant === 'inline' ? 'start_free' : 'get_early_access',
      cta_href: targetHref,
      location: variant,
    })
  }

  if (variant === 'inline') {
    return (
      <div style={{
        margin: '40px 0 8px', display: 'flex', alignItems: 'center', gap: '16px',
        borderRadius: '8px', border: '1px solid #E8E6E0',
        background: '#F3F2EF', padding: '16px 20px',
      }}>
        <p style={{
          flex: 1, fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', color: '#3A3835', margin: 0, lineHeight: 1.6,
        }}>
          {text ?? 'LaSyncro handles this automatically — real-time, no manual work.'}
        </p>
        <a href={targetHref} onClick={handleClick} style={{
          flexShrink: 0, borderRadius: '6px', background: '#FF6B2B',
          padding: '8px 16px', fontSize: '13px', fontWeight: 500,
          color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>
          Start free
        </a>
      </div>
    )
  }

  return (
    <div style={{
      margin: '64px 0 8px', background: '#151D29', color: '#F0EEE8',
      borderRadius: '14px', padding: '36px 40px',
      display: 'grid', gridTemplateColumns: '1fr auto', gap: '28px', alignItems: 'center',
    }}>
      <div>
        <h3 style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: '26px', fontWeight: 400, lineHeight: 1.2,
          letterSpacing: '-0.02em', margin: '0 0 6px', color: '#F0EEE8',
        }}>
          {text ?? 'See your operation clearly for the first time.'}
        </h3>
        <p style={{
          margin: 0, fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '14px', fontWeight: 300, lineHeight: 1.6,
          color: 'rgba(240,238,232,0.7)', maxWidth: '460px',
        }}>
          Connect Shopify in 60 seconds. No credit card required.
        </p>
      </div>
      <a href={targetHref} onClick={handleClick} style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '12px 22px', background: '#FF6B2B', color: '#fff',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: '14px', fontWeight: 500,
        borderRadius: '8px', textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
        Start free
      </a>
    </div>
  )
}