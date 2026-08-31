import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'
import PricingPlans from '@/components/pricing/PricingPlans'

export const metadata: Metadata = {
  title: 'Pricing — LaSyncro',
  description:
    'Pricing that scales with your warehouse. Start with the core warehouse workflow, then add capacity and intelligence as you grow.',
  alternates: { canonical: 'https://www.lasyncro.com/pricing' },
}

const W = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 5vw',
} as const

const pricingSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://www.lasyncro.com/pricing',
  url: 'https://www.lasyncro.com/pricing',
  name: 'Pricing — LaSyncro',
  publisher: { '@id': 'https://www.lasyncro.com/#organization' },
}

export default function PricingPage() {
  return (
    <>
      <Schema data={pricingSchema} />

      <header style={{ ...W, padding: '88px 5vw 48px' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--accent)',
            marginBottom: 22,
            fontFamily: 'var(--sans)',
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
              background: 'var(--accent)',
              display: 'inline-block',
            }}
          />
          Pricing
        </div>

        <h1
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 'clamp(38px, 5vw, 64px)',
            fontWeight: 650,
            lineHeight: 1.05,
            letterSpacing: '-0.045em',
            color: 'var(--ink)',
            margin: '0 0 22px',
            maxWidth: 760,
          }}
        >
          Pricing that scales with your warehouse.
        </h1>

        <p
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.65,
            color: 'var(--ink-2)',
            margin: '0 0 12px',
            maxWidth: 620,
          }}
        >
          Start with the core warehouse workflow. Add capacity and intelligence
          as you grow.
        </p>

        <p
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.6,
            color: 'var(--ink-3)',
            margin: 0,
            maxWidth: 760,
          }}
        >
          Every new shop starts with a 14-day Growth trial. No credit card
          required. Switch or cancel anytime.
        </p>
      </header>

      <PricingPlans />
    </>
  )
}