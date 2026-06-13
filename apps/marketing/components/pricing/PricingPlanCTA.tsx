'use client'

import { usePostHog } from 'posthog-js/react'

interface Props {
  plan: string
  cta: string
  featured: boolean
}

export default function PricingPlanCTA({ plan, cta, featured }: Props) {
  const ph = usePostHog()

  return (
    <a
      href="https://app.lasyncro.com"
      onClick={() =>
        ph?.capture('pricing_plan_cta_clicked', {
          plan: plan.toLowerCase(),
          cta_label: cta,
        })
      }
      style={{
        display: 'block', textAlign: 'center',
        fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 500,
        color: featured ? '#fff' : '#FF6B2B',
        background: featured ? '#FF6B2B' : 'transparent',
        border: `1px solid ${featured ? '#FF6B2B' : '#FFD4BC'}`,
        borderRadius: 8, padding: '10px 0', textDecoration: 'none',
        letterSpacing: '0.02em',
      }}
    >
      {cta}
    </a>
  )
}