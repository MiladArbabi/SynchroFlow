'use client'

import PricingPlanCTA from './PricingPlanCTA'
import LaunchNotifyForm, { useShopifyAvailability } from '@/components/conversion/LaunchNotifyForm'

interface Plan {
  tier: string
  monthly: number
  desc: string
  features: string[]
  featured: boolean
  badge: string | null
  cta: string
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

// Public Pricing currently displays USD.
// Annual totals mirror the canonical billing pricing configuration.
// Usage allowances mirror packages/backend-core/src/config/tiers.ts.
const plans: Plan[] = [
  {
    tier: 'Starter',
    monthly: 0,
    desc: 'Inventory visibility for shops getting operational control.',
    features: [
      'Real-time inventory sync',
      'Real-time stock alerts',
      'Owner only',
      '1 location',
      '30-day history',
    ],
    featured: false,
    badge: null,
    cta: 'Start free',
  },
  {
    tier: 'Core',
    monthly: 99,
    desc: 'Run structured warehouse execution with barcode workflows.',
    features: [
      'Everything in Starter',
      '2,000 warehouse-processed orders / month included',
      '$0.08 per additional processed order',
      '3 non-owner seats included',
      '1 location',
      '90-day history',
      'Receive / stow / pick / pack / ship',
      'Barcode scanning',
    ],
    featured: false,
    badge: null,
    cta: 'Start free trial',
  },
  {
    tier: 'Growth',
    monthly: 249,
    desc: 'More capacity and operational intelligence for growing teams.',
    features: [
      'Everything in Core',
      '7,500 warehouse-processed orders / month included',
      '$0.06 per additional processed order',
      '10 non-owner seats included',
      '3 locations',
      '365-day history',
      'Demand forecasting',
      'Floor planning',
    ],
    featured: true,
    badge: 'Recommended',
    cta: 'Start free trial',
  },
  {
    tier: 'Scale',
    monthly: 599,
    desc: 'High-capacity warehouse operations with priority support.',
    features: [
      'Everything in Growth',
      '20,000 warehouse-processed orders / month included',
      '$0.04 per additional processed order',
      '25 non-owner seats included',
      '10 locations',
      '730-day history',
      'Priority support',
    ],
    featured: false,
    badge: null,
    cta: 'Choose Scale',
  },
]

function formatUsd(amount: number): string {
  if (amount === 0) return 'Free'
  return Number.isInteger(amount)
    ? `$${amount.toFixed(0)}`
    : `$${amount.toFixed(2)}`
}

export default function PricingPlans() {
  const shopifyAvailability = useShopifyAvailability()

  return (
    <div style={{ ...W, padding: '0 5vw 80px' }}>
      <div
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink-3)',
          lineHeight: 1.5,
          marginBottom: 22,
        }}
      >
        Prices shown in USD. Monthly billing.
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
          alignItems: 'stretch',
        }}
      >
        {plans.map((plan) => {
          return (
            <div
              key={plan.tier}
              style={{
                background: plan.featured
                  ? 'var(--accent-ghost)'
                  : 'var(--surface)',
                border: `1px solid ${
                  plan.featured
                    ? 'var(--accent-border)'
                    : 'var(--rule)'
                }`,
                borderRadius: 18,
                padding: 28,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 520,
                boxShadow: plan.featured
                  ? '0 20px 60px rgba(255,107,43,0.08)'
                  : 'none',
              }}
            >
              {plan.badge && (
                <div
                  style={{
                    display: 'inline-block',
                    alignSelf: 'flex-start',
                    fontFamily: 'var(--sans)',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                    background: 'var(--bg)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: 100,
                    padding: '4px 11px',
                    marginBottom: 14,
                  }}
                >
                  {plan.badge}
                </div>
              )}

              <div
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: plan.featured
                    ? 'var(--accent)'
                    : 'var(--ink-3)',
                  marginBottom: 12,
                }}
              >
                {plan.tier}
              </div>

              <div
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 40,
                  fontWeight: 650,
                  color: 'var(--ink)',
                  letterSpacing: '-0.045em',
                  lineHeight: 1,
                  marginBottom: 8,
                }}
              >
                {formatUsd(plan.monthly)}

                {plan.monthly > 0 && (
                  <span
                    style={{
                      fontFamily: 'var(--sans)',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--ink-3)',
                      letterSpacing: 0,
                      marginLeft: 3,
                    }}
                  >
                    /mo
                  </span>
                )}
              </div>

              <p
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 13,
                  fontWeight: 450,
                  lineHeight: 1.6,
                  color: 'var(--ink-2)',
                  margin: '0 0 18px',
                  paddingBottom: 18,
                  borderBottom: '1px solid var(--rule)',
                  minHeight: 84,
                }}
              >
                {plan.desc}
              </p>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  flex: 1,
                }}
              >
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    style={{
                      fontFamily: 'var(--sans)',
                      fontSize: 13,
                      fontWeight: 450,
                      color: 'var(--ink-2)',
                      lineHeight: 1.45,
                      paddingLeft: 16,
                      position: 'relative',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 8,
                        width: 4,
                        height: 4,
                        background: 'var(--accent)',
                        borderRadius: '50%',
                        opacity: 0.7,
                        display: 'inline-block',
                      }}
                    />

                    {feature}
                  </li>
                ))}
              </ul>

              <PricingPlanCTA
                plan={plan.tier}
                cta={plan.cta}
                featured={plan.featured}
                shopifyAvailable={shopifyAvailability.available}
                installUrl={shopifyAvailability.installUrl}
              />
            </div>
          )
        })}
      </div>

      <div
        style={{
          maxWidth: 860,
          margin: '24px auto 0',
          padding: '18px 20px',
          border: '1px solid var(--rule)',
          borderRadius: 14,
          background: 'var(--surface)',
          fontFamily: 'var(--sans)',
          fontSize: 12,
          lineHeight: 1.65,
          color: 'var(--ink-3)',
        }}
      >
        <strong style={{ color: 'var(--ink-2)' }}>How usage is counted:</strong>{' '}
        Shopify orders always continue syncing into LaSyncro and are not a
        commercial allowance. A processed order is counted when warehouse
        execution reaches Pack complete. Core, Growth, and Scale continue above
        their included monthly volume automatically at the per-order rate shown
        for each plan.
      </div>

      <div
        id="launch-pricing"
        style={{ maxWidth: 720, margin: '52px auto 0' }}
      >
        <LaunchNotifyForm source="launch_pricing" />
      </div>

      <div
        style={{
          textAlign: 'center',
          marginTop: 52,
          padding: '34px 0 0',
          borderTop: '1px solid var(--rule)',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 18,
            fontWeight: 550,
            color: 'var(--ink-2)',
            margin: '0 0 12px',
          }}
        >
          Built to reduce the operational mistakes that cost growing warehouses
          time and margin.
        </p>

        <p
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink-3)',
            margin: 0,
          }}
        >
          Questions?{' '}
          <a
            href="mailto:contact@lasyncro.com"
            style={{
              color: 'var(--accent)',
              textDecoration: 'none',
              fontWeight: 650,
            }}
          >
            contact@lasyncro.com
          </a>
        </p>
      </div>
    </div>
  )
}
