import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'
import PricingPlanCTA from '@/components/pricing/PricingPlanCTA'

export const metadata: Metadata = {
  title: 'Pricing — LaSyncro',
  description: 'Pricing that scales with your warehouse. Start free, add operational control when the work gets serious.',
  alternates: { canonical: 'https://www.lasyncro.com/pricing' },
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const
const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const pricingSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://www.lasyncro.com/pricing',
  url: 'https://www.lasyncro.com/pricing',
  name: 'Pricing — LaSyncro',
  publisher: { '@id': 'https://www.lasyncro.com/#organization' },
}

const plans = [
  {
    tier: 'Starter',
    price: 'Free',
    period: '',
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
    price: '$79',
    period: '/mo',
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
    price: '$179',
    period: '/mo',
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
    price: '$349',
    period: '/mo',
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

export default function PricingPage() {
  return (
    <>
      <Schema data={pricingSchema} />

      {/* Header */}
      <header style={{ ...W, padding: '96px 5vw 64px' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: '#FF6B2B',
            marginBottom: 22,
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#FF6B2B',
              display: 'inline-block',
            }}
          />
          Pricing
        </div>

        <h1
          style={{
            fontFamily: FONT,
            fontSize: 'clamp(38px, 5vw, 64px)',
            fontWeight: 650,
            lineHeight: 1.05,
            letterSpacing: '-0.045em',
            color: '#0F0E0D',
            margin: '0 0 22px',
            maxWidth: 760,
          }}
        >
          Pricing that scales with your warehouse.
        </h1>

        <p
          style={{
            fontFamily: FONT,
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.65,
            color: '#6B7280',
            margin: '0 0 12px',
            maxWidth: 620,
          }}
        >
          Start simple. Add operational control when the work gets serious.
        </p>

        <p
          style={{
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.6,
            color: '#9CA3AF',
            margin: 0,
            maxWidth: 760,
          }}
        >
          Annual billing saves 20%. Every paid plan includes a 14-day Growth trial. No credit card required.
          Switch or cancel anytime.
        </p>
      </header>

      {/* Pricing grid */}
      <div style={{ ...W, padding: '0 5vw 80px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
            alignItems: 'stretch',
          }}
        >
          {plans.map((plan) => (
            <div
              key={plan.tier}
              style={{
                background: plan.featured ? '#FFF5F0' : '#FAFAF9',
                border: `1px solid ${plan.featured ? '#FFD4BC' : '#E8E6E0'}`,
                borderRadius: 18,
                padding: 28,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 520,
                boxShadow: plan.featured ? '0 20px 60px rgba(255, 107, 43, 0.08)' : 'none',
              }}
            >
              {plan.badge && (
                <div
                  style={{
                    display: 'inline-block',
                    alignSelf: 'flex-start',
                    fontFamily: FONT,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: '#FF6B2B',
                    background: '#fff',
                    border: '1px solid #FFD4BC',
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
                  fontFamily: FONT,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: plan.featured ? '#FF6B2B' : '#9CA3AF',
                  marginBottom: 12,
                }}
              >
                {plan.tier}
              </div>

              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 40,
                  fontWeight: 650,
                  color: '#0F0E0D',
                  letterSpacing: '-0.045em',
                  lineHeight: 1,
                  marginBottom: 14,
                }}
              >
                {plan.price}
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#9CA3AF',
                    letterSpacing: 0,
                    marginLeft: 3,
                  }}
                >
                  {plan.period}
                </span>
              </div>

              <p
                style={{
                  fontFamily: FONT,
                  fontSize: 13,
                  fontWeight: 450,
                  lineHeight: 1.6,
                  color: '#6B7280',
                  margin: '0 0 18px',
                  paddingBottom: 18,
                  borderBottom: '1px solid #E8E6E0',
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
                      fontFamily: FONT,
                      fontSize: 13,
                      fontWeight: 450,
                      color: '#3A3835',
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
                        background: '#FF6B2B',
                        borderRadius: '50%',
                        opacity: 0.7,
                        display: 'inline-block',
                      }}
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <PricingPlanCTA plan={plan.tier} cta={plan.cta} featured={plan.featured} />
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div
          style={{
            textAlign: 'center',
            marginTop: 52,
            padding: '34px 0 0',
            borderTop: '1px solid #E8E6E0',
          }}
        >
          <p
            style={{
              fontFamily: FONT,
              fontSize: 18,
              fontWeight: 550,
              color: '#6B7280',
              margin: '0 0 12px',
            }}
          >
            One prevented stockout, oversell, or missed fulfillment window can cover Growth for the month.
          </p>

          <p
            style={{
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 500,
              color: '#9CA3AF',
              margin: 0,
            }}
          >
            Questions?{' '}
            <a
              href="mailto:contact@lasyncro.com"
              style={{
                color: '#FF6B2B',
                textDecoration: 'none',
                fontWeight: 650,
              }}
            >
              contact@lasyncro.com
            </a>
          </p>
        </div>
      </div>
    </>
  )
}