import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'
import PricingPlanCTA from '@/components/pricing/PricingPlanCTA'

export const metadata: Metadata = {
  title: 'Pricing — LaSyncro',
  description: 'Simple, transparent pricing for warehouse teams of every size. Start free, scale when you\'re ready.',
  alternates: { canonical: 'https://www.lasyncro.com/pricing' },
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

const pricingSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://www.lasyncro.com/pricing',
  url: 'https://www.lasyncro.com/pricing',
  name: 'Pricing — LaSyncro',
  publisher: { '@id': 'https://www.lasyncro.com/#organization', },
}

const plans = [
  {
    tier: 'Starter',
    price: 'Free',
    period: '',
    desc: 'See what you\'ve been missing. Enough to understand LaSyncro, not enough to run on permanently.',
    features: ['Real-time inventory sync', 'Up to 100 orders/month', 'Basic pick and pack', '1 warehouse location', 'Email support'],
    featured: false,
    badge: null,
    cta: 'Start free',
  },
  {
    tier: 'Core',
    price: '79',
    period: '/mo',
    desc: 'Structured workflows for your first warehouse hire — without the full intelligence layer.',
    features: ['Everything in Starter', 'Unlimited orders', 'PO receiving', 'Supplier tracking', 'Up to 3 warehouse locations', 'Priority support'],
    featured: false,
    badge: null,
    cta: 'Start free trial',
  },
  {
    tier: 'Growth',
    price: '£179',
    period: '/mo',
    desc: 'Where intelligence unlocks. Where the product pays for itself.',
    features: ['Everything in Core', 'Demand intelligence', 'Supplier scorecards', 'Stock risk alerts', 'Unlimited locations', 'Barcode generation', 'Slack notifications'],
    featured: true,
    badge: 'Most merchants land here',
    cta: 'Start free trial',
  },
  {
    tier: 'Scale',
    price: '£349',
    period: '/mo',
    desc: 'Serious volume, no limits. For merchants doing £5M+ who need enterprise-grade reliability.',
    features: ['Everything in Growth', 'Floor planning', 'Multi-warehouse routing', 'Advanced RLS controls', 'Dedicated onboarding', 'SLA guarantee'],
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
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B2B', display: 'inline-block' }} />
          Pricing
        </div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 20px', maxWidth: 640 }}>
          Simple pricing.<br />Serious results.
        </h1>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 17, fontWeight: 300, lineHeight: 1.65, color: '#6B7280', margin: '0 0 12px', maxWidth: 480 }}>
          The Growth tier pays for itself the first time it prevents a stockout.
        </p>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 300, color: '#9CA3AF', margin: 0 }}>
          Annual billing saves 20% — two months free. All paid plans include a 14-day Growth trial. No credit card required.
        </p>
      </header>

      {/* Pricing grid */}
      <div style={{ ...W, padding: '0 5vw 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, alignItems: 'start' }}>
          {plans.map(plan => (
            <div key={plan.tier} style={{
              background: plan.featured ? '#FFF5F0' : '#FAFAF9',
              border: `1px solid ${plan.featured ? '#FFD4BC' : '#E8E6E0'}`,
              borderRadius: 16,
              padding: 28,
              position: 'relative',
            }}>
              {plan.badge && (
                <div style={{ display: 'inline-block', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF6B2B', background: '#fff', border: '1px solid #FFD4BC', borderRadius: 100, padding: '3px 10px', marginBottom: 12 }}>
                  {plan.badge}
                </div>
              )}
              <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: plan.featured ? '#FF6B2B' : '#9CA3AF', marginBottom: 8 }}>
                {plan.tier}
              </div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 36, fontWeight: 400, color: '#0F0E0D', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 12 }}>
                {plan.price}<span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: '#9CA3AF', letterSpacing: 0 }}>{plan.period}</span>
              </div>
              <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 300, lineHeight: 1.55, color: '#6B7280', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #E8E6E0' }}>
                {plan.desc}
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {plan.features.map(f => (
                  <li key={f} style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 300, color: '#3A3835', lineHeight: 1.4, paddingLeft: 16, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, top: 7, width: 4, height: 4, background: '#FF6B2B', borderRadius: '50%', opacity: 0.6, display: 'inline-block' }} />
                    {f}
                  </li>
                ))}
              </ul>
              <PricingPlanCTA plan={plan.tier} cta={plan.cta} featured={plan.featured} />
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div style={{ textAlign: 'center', marginTop: 48, padding: '32px 0', borderTop: '1px solid #E8E6E0' }}>
          <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 18, fontStyle: 'italic', color: '#6B7280', margin: '0 0 12px' }}>
            At £179/month, LaSyncro costs less per day than a single unplanned stockout.
          </p>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 300, color: '#9CA3AF', margin: 0 }}>
            Questions? <a href="mailto:contact@lasyncro.com" style={{ color: '#FF6B2B', textDecoration: 'none' }}>contact@lasyncro.com</a>
          </p>
        </div>
      </div>
    </>
  )
}