'use client'

import { usePostHog } from 'posthog-js/react'

interface Props {
  plan: string
  cta: string
  featured: boolean
  billingInterval: 'monthly' | 'annual'
}

export default function PricingPlanCTA({
  plan,
  cta,
  featured,
  billingInterval,
}: Props) {
  const ph = usePostHog()

  return (
    <a
      href="https://app.lasyncro.com"
      onClick={() =>
        ph?.capture('pricing_plan_cta_clicked', {
          plan: plan.toLowerCase(),
          cta_label: cta,
          billing_interval: billingInterval,
        })
      }
      style={{
        display: 'block',
        textAlign: 'center',
        fontFamily: 'var(--sans)',
        fontSize: 13,
        fontWeight: 500,
        color: featured ? 'var(--on-accent)' : 'var(--accent)',
        background: featured ? 'var(--accent)' : 'transparent',
        border: `1px solid ${
          featured ? 'var(--accent)' : 'var(--accent-border)'
        }`,
        borderRadius: 8,
        padding: '10px 0',
        textDecoration: 'none',
        letterSpacing: '0.02em',
      }}
    >
      {cta}
    </a>
  )
}