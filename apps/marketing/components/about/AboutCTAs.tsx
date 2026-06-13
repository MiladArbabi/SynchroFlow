'use client'

import { usePostHog } from 'posthog-js/react'
import Link from 'next/link'

export default function AboutCTAs() {
  const ph = usePostHog()

  return (
    <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 48, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <a
        href="https://app.lasyncro.com"
        onClick={() => ph?.capture('about_cta_clicked', { cta_label: 'get_early_access' })}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '12px 24px', background: '#FF6B2B', color: '#fff',
          fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
          borderRadius: 6, textDecoration: 'none',
        }}
      >
        Get early access
      </a>
      <Link
        href="/blog"
        onClick={() => ph?.capture('about_cta_clicked', { cta_label: 'read_blog' })}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
          color: '#0F0E0D', paddingBottom: 4, borderBottom: '1px solid #0F0E0D',
        }}
      >
        Read the operator&apos;s library
      </Link>
    </div>
  )
}