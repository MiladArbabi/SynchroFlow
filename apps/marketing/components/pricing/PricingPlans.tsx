'use client'

import { useState } from 'react'
import PricingPlanCTA from './PricingPlanCTA'
import LaunchNotifyForm from '@/components/conversion/LaunchNotifyForm'

type BillingInterval = 'monthly' | 'annual'

interface Plan {
  tier: string
  monthly: number
  annual: number
  desc: string
  features: string[]
  featured: boolean
  badge: string | null
  cta: string
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

// Public Pricing currently displays USD.
// Annual totals mirror the canonical billing pricing configuration.
const plans: Plan[] = [
  {
    tier: 'Starter',
    monthly: 0,
    annual: 0,
    desc: 'For shops validating LaSyncro before committing to structured warehouse workflows.',
    features: [
      'Real-time inventory sync',
      'Up to 100 orders/month',
      'Orders & fulfillment queue',
      'Real-time stock alerts',
      '1 sales channel',
      'Email support',
    ],
    featured: false,
    badge: null,
    cta: 'Start free',
  },
  {
    tier: 'Core',
    monthly: 79,
    annual: 790,
    desc: 'Run your first structured warehouse workflow without the full intelligence layer.',
    features: [
      'Everything in Starter',
      'Unlimited orders',
      'PO receiving',
      'Pick / pack / stow',
      'Barcode scanning',
      'Returns management',
      'Product catalog',
      'Supplier tracking',
      '2 non-owner seats',
    ],
    featured: false,
    badge: null,
    cta: 'Start free trial',
  },
  {
    tier: 'Growth',
    monthly: 179,
    annual: 1718.4,
    desc: 'Where operational control turns into margin protection.',
    features: [
      'Everything in Core',
      'Demand intelligence',
      'Stock risk alerts',
      'Cash flow & runway',
      'Supplier scorecards',
      'Customer LTV',
      'Slack notifications',
      '5 non-owner seats',
    ],
    featured: true,
    badge: 'Most merchants land here',
    cta: 'Start free trial',
  },
  {
    tier: 'Scale',
    monthly: 349,
    annual: 3350.4,
    desc: 'For higher-volume teams that need control across people, places, and processes.',
    features: [
      'Everything in Growth',
      'Floor planning',
      'Multi-warehouse routing',
      'Role-based permissions',
      'AI operations intelligence',
      'Unlimited seats',
      'Priority support',
      'Dedicated onboarding',
    ],
    featured: false,
    badge: null,
    cta: 'Contact us',
  },
]

function formatUsd(amount: number): string {
  if (amount === 0) return 'Free'
  return Number.isInteger(amount)
    ? `$${amount.toFixed(0)}`
    : `$${amount.toFixed(2)}`
}

export default function PricingPlans() {
  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>('monthly')

  const isAnnual = billingInterval === 'annual'

  return (
    <div style={{ ...W, padding: '0 5vw 80px' }}>
      <style>{`
        .pricing-billing-option:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 3px;
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          marginBottom: 22,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink-3)',
            lineHeight: 1.5,
          }}
        >
          Prices shown in USD. Annual plans are billed once per year.
        </div>

        <div
          role="group"
          aria-label="Billing period"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'var(--bg-2)',
            border: '1px solid var(--rule)',
            borderRadius: 14,
            padding: 4,
          }}
        >
          {(['monthly', 'annual'] as const).map((interval) => {
            const active = billingInterval === interval

            return (
              <button
                key={interval}
                type="button"
                className="pricing-billing-option"
                aria-pressed={active}
                onClick={() => setBillingInterval(interval)}
                style={{
                  appearance: 'none',
                  border: active
                    ? '1px solid var(--rule-2)'
                    : '1px solid transparent',
                  borderRadius: 10,
                  padding: '8px 16px',
                  background: active ? 'var(--bg-3)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-3)',
                  fontFamily: 'var(--sans)',
                  fontSize: 13,
                  fontWeight: active ? 750 : 650,
                  cursor: 'pointer',
                }}
              >
                {interval === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            )
          })}
        </div>
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
          const monthlyEquivalent =
            plan.monthly === 0
              ? 0
              : isAnnual
                ? plan.annual / 12
                : plan.monthly

          const annualSavings =
            plan.monthly === 0
              ? 0
              : plan.monthly * 12 - plan.annual

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
                {formatUsd(monthlyEquivalent)}

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

              <div
                style={{
                  minHeight: 22,
                  marginBottom: 8,
                  fontFamily: 'var(--sans)',
                  fontSize: 11,
                  fontWeight: 500,
                  color: isAnnual
                    ? 'var(--accent)'
                    : 'var(--ink-4)',
                }}
              >
                {plan.monthly > 0 && isAnnual
                  ? `Billed ${formatUsd(plan.annual)}/year · Save ${formatUsd(annualSavings)}/year`
                  : '\u00A0'}
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
                billingInterval={billingInterval}
              />
            </div>
          )
        })}
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
          One prevented stockout, oversell, or missed fulfillment window can
          cover Growth for the month.
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