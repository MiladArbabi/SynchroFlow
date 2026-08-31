'use client'

import { usePostHog } from 'posthog-js/react'

interface Props {
  plan: string
  cta: string
  featured: boolean
  billingInterval: 'monthly' | 'annual'
  shopifyAvailable?: boolean
  installUrl?: string | null
}

export default function PricingPlanCTA({
  plan,
  cta,
  featured,
  billingInterval,
  shopifyAvailable = false,
  installUrl = null,
}: Props) {
  const ph = usePostHog()
  const waitingForLaunch = !shopifyAvailable || !installUrl
  const isScale = plan.toLowerCase() === 'scale'

  const resolvedCta = waitingForLaunch ? 'Notify me at launch' : cta
  const resolvedHref = waitingForLaunch
    ? '#launch-pricing'
    : isScale
      ? 'mailto:contact@lasyncro.com?subject=LaSyncro%20Scale%20plan'
      : installUrl ?? '#launch-pricing'
  const opensInstallUrl = !waitingForLaunch && !isScale

  return (
    <a
      href={resolvedHref}
      target={opensInstallUrl ? '_blank' : undefined}
      rel={opensInstallUrl ? 'noopener noreferrer' : undefined}
      onClick={() =>
        ph?.capture('pricing_plan_cta_clicked', {
          plan: plan.toLowerCase(),
          cta_label: resolvedCta,
          billing_interval: billingInterval,
          shopify_available: !waitingForLaunch,
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
      {resolvedCta}
    </a>
  )
}