'use client'

import { captureMarketingEvent } from '../PostHogProvider'

interface Props {
  plan: string
  cta: string
  featured: boolean
  shopifyAvailable?: boolean
  installUrl?: string | null
}

export default function PricingPlanCTA({
  plan,
  cta,
  featured,
  shopifyAvailable = false,
  installUrl = null,
}: Props) {
  const waitingForLaunch = !shopifyAvailable || !installUrl

  const resolvedCta = waitingForLaunch ? 'Notify me at launch' : cta
  const resolvedHref = waitingForLaunch
    ? '#launch-pricing'
    : installUrl ?? '#launch-pricing'
  const opensInstallUrl = !waitingForLaunch

  return (
    <a
      href={resolvedHref}
      target={opensInstallUrl ? '_blank' : undefined}
      rel={opensInstallUrl ? 'noopener noreferrer' : undefined}
      onClick={() =>
        captureMarketingEvent('pricing_plan_cta_clicked', {
          plan: plan.toLowerCase(),
          cta_label: resolvedCta,
          billing_interval: 'monthly',
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