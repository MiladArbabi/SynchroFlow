'use client'

import { usePostHog } from 'posthog-js/react'

export default function CompareCTA() {
  const ph = usePostHog()

  return (
    <a
      href="https://app.lasyncro.com"
      onClick={() => ph?.capture('compare_cta_clicked', { location: 'bottom_cta', cta_label: 'get_early_access' })}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '12px 24px', background: '#FF6B2B', color: '#fff',
        fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
        borderRadius: 6, textDecoration: 'none',
      }}
    >
      Get early access
    </a>
  )
}