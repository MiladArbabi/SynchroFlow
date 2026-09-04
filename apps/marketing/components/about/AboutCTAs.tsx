'use client'

import { captureMarketingEvent } from '../PostHogProvider'
import Link from 'next/link'

export default function AboutCTAs() {

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexWrap: 'wrap',
      }}
    >
      <Link
        href="/blog"
        onClick={() =>
          captureMarketingEvent('about_cta_clicked', { cta_label: 'read_blog' })
        }
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--sans)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--accent)',
          paddingBottom: 4,
          borderBottom: '1px solid var(--accent-border)',
          textDecoration: 'none',
        }}
      >
        Read the operator&apos;s library
      </Link>
    </div>
  )
}
