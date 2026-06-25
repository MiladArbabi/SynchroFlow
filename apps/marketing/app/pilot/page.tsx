// apps/marketing/app/pilot/page.tsx
// AUD-1023 slice 1/5: route scaffold + hero + problem section.
// Remaining slices (best-fit/not-a-fit, pilot focus/included/commitment/metrics/pricing,
// application form, FAQ + final CTA, nav/footer/llms.txt wiring) land in follow-up edits —
// do not treat this file as complete.
import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'
import PilotApplicationForm from '@/components/pilot/PilotApplicationForm'

export const metadata: Metadata = {
  title: 'Apply for the 5-Merchant Warehouse Accuracy Pilot — LaSyncro',
  description: 'We are onboarding 5 Shopify merchants to test LaSyncro in real warehouse workflows — receiving, stock movement, pick/pack verification, and inventory accuracy.',
  alternates: { canonical: 'https://www.lasyncro.com/pilot' },
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

const pilotSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: '5-Merchant Warehouse Accuracy Pilot',
  provider: { '@id': 'https://www.lasyncro.com/#organization' },
  description: 'A hands-on, limited 30-day onboarding pilot for Shopify merchants with in-house warehouse or stockroom operations, focused on receiving, stock movement, pick/pack verification, and inventory accuracy.',
}

const pilotFaqs = [
  {
    q: 'Is this a free trial?',
    a: 'No. This is a hands-on pilot for qualified Shopify merchants with in-house warehouse or stockroom operations.',
  },
  {
    q: 'Do we need to use Stocky?',
    a: 'No. Stocky users are a strong fit, but merchants using spreadsheets, Shopify native inventory, barcode tools, or manual workflows may also qualify.',
  },
  {
    q: 'Do we need a warehouse?',
    a: 'You need some form of in-house fulfillment, stockroom, storage area, or warehouse workflow. Pure dropshipping is not a fit.',
  },
  {
    q: 'How long does the pilot take?',
    a: 'Usually 30 days.',
  },
  {
    q: 'What workflow do we start with?',
    a: 'We choose one primary workflow first, such as receiving, stock movement, pick/pack verification, or inventory mismatch investigation.',
  },
  {
    q: 'Will LaSyncro replace all of Stocky?',
    a: 'Not necessarily. The pilot is designed to identify which Stocky or warehouse workflows matter most and whether LaSyncro is a fit for those workflows.',
  },
  {
    q: 'What happens after the pilot?',
    a: 'If there is a fit, we agree on the next workflow, subscription scope, and rollout plan.',
  },
]

const pilotFaqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: pilotFaqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function PilotPage() {
  return (
    <>
      <Schema data={pilotSchema} />
      <Schema data={pilotFaqSchema} />


      <header style={{ ...W, padding: '96px 5vw 64px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B2B', display: 'inline-block' }} />
          Pilot program
        </div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 20px', maxWidth: 720 }}>
          Apply for the 5-Merchant Warehouse Accuracy Pilot
        </h1>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 17, fontWeight: 300, lineHeight: 1.65, color: '#6B7280', margin: '0 0 32px', maxWidth: 600 }}>
          We are onboarding 5 Shopify merchants to test LaSyncro in real warehouse workflows, focused on receiving, stock movement, pick/pack verification, and Shopify inventory accuracy.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <a href="#apply" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500, color: '#fff', background: '#FF6B2B', borderRadius: 8, padding: '12px 28px', textDecoration: 'none' }}>
            Apply for pilot access
          </a>
          <a href="https://app.lasyncro.com/book-audit" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500, color: '#0F0E0D', border: '1px solid #E8E6E0', borderRadius: 8, padding: '12px 28px', textDecoration: 'none' }}>
            Book a warehouse accuracy audit
          </a>
        </div>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 300, color: '#9CA3AF', margin: 0 }}>
          Limited to merchants with in-house fulfillment or stockroom operations.
        </p>
      </header>

      <div style={{ ...W, padding: '0 5vw 96px' }}>
        <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 56 }}>
          <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', lineHeight: 1.4, margin: '0 0 20px', maxWidth: 680 }}>
            Shopify says the item is in stock. The shelf says otherwise.
          </p>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: '#3A3835', margin: '0 0 16px', maxWidth: 680 }}>
            The team checks receiving records, shelf locations, stock adjustments, returns, and recent orders. Nobody is fully sure where the mismatch started.
          </p>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: '#3A3835', margin: 0, maxWidth: 680 }}>
            That is the problem LaSyncro is built around: making warehouse stock movement traceable before it becomes overselling, wrong picks, delayed orders, or manual reconciliation.
          </p>
        </div>

        <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 56, marginTop: 56, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4vw' }}>
          <div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 20px' }}>
              Best fit if you are
            </h2>
            <ul style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.9, color: '#3A3835', margin: 0, paddingLeft: 20 }}>
              <li>Shopify merchant</li>
              <li>Fulfilling from your own warehouse, stockroom, or backroom</li>
              <li>Shipping roughly 50+ orders/day, or growing toward that</li>
              <li>Managing many SKUs, variants, bundles, or locations</li>
              <li>Dealing with stock mismatch, manual adjustments, overselling, or picking issues</li>
              <li>Using Stocky, spreadsheets, barcode tools, Shopify native inventory, or manual processes</li>
              <li>Willing to involve at least one real operator/admin in the pilot</li>
            </ul>
          </div>
          <div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 20px' }}>
              Not a fit if you
            </h2>
            <ul style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.9, color: '#3A3835', margin: 0, paddingLeft: 20 }}>
              <li>Dropship everything</li>
              <li>Use a 3PL for all fulfillment</li>
              <li>Only need forecasting</li>
              <li>Ship very low volume</li>
              <li>Want a fully self-serve app with no onboarding</li>
              <li>Are not willing to share workflow details</li>
            </ul>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 56, marginTop: 56 }}>
          <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 16px' }}>
            What the pilot focuses on
          </h2>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: '#3A3835', margin: '0 0 24px', maxWidth: 680 }}>
            Each pilot focuses on one primary workflow first. We do not try to rebuild your whole warehouse in week one.
          </p>
          <ul style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.9, color: '#3A3835', margin: 0, paddingLeft: 20, columns: 2, maxWidth: 680 }}>
            <li>Receiving accuracy</li>
            <li>Barcode-based stock movement</li>
            <li>Shelf/bin location visibility</li>
            <li>Pick verification</li>
            <li>Pack verification</li>
            <li>Shopify inventory sync</li>
            <li>Stock mismatch investigation</li>
            <li>Stocky migration workflow audit</li>
          </ul>
        </div>

        <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 56, marginTop: 56, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4vw' }}>
          <div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 20px' }}>
              What is included
            </h2>
            <ul style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.9, color: '#3A3835', margin: 0, paddingLeft: 20 }}>
              <li>Shopify connection and initial setup</li>
              <li>Product/order/inventory review</li>
              <li>Warehouse workflow mapping</li>
              <li>One selected workflow configured</li>
              <li>Weekly check-in</li>
              <li>Operator/admin feedback session</li>
              <li>Pilot success review</li>
              <li>Recommendation for next step</li>
            </ul>
          </div>
          <div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 20px' }}>
              What we need from you
            </h2>
            <ul style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.9, color: '#3A3835', margin: 0, paddingLeft: 20 }}>
              <li>One decision-maker involved</li>
              <li>One operator/admin available for feedback</li>
              <li>Shopify access or test data access</li>
              <li>Current workflow walkthrough</li>
              <li>Agreement on one success metric</li>
              <li>30-day pilot commitment</li>
            </ul>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 56, marginTop: 56 }}>
          <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 20px' }}>
            What we measure
          </h2>
          <ul style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.9, color: '#3A3835', margin: 0, paddingLeft: 20, columns: 2, maxWidth: 680 }}>
            <li>Manual stock adjustments</li>
            <li>Orders delayed because stock could not be found</li>
            <li>Picking/packing mistakes</li>
            <li>Time spent reconciling inventory</li>
            <li>Stock mismatch incidents</li>
            <li>Receiving discrepancies</li>
            <li>Operator confidence in inventory data</li>
          </ul>
        </div>

        <div style={{ marginTop: 56, padding: '40px', background: '#FFF5F0', borderRadius: 16, border: '1px solid #FFD4BC' }}>
          <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 22, fontWeight: 400, color: '#0F0E0D', margin: '0 0 12px' }}>
            Pricing
          </h2>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.8, color: '#3A3835', margin: '0 0 8px', maxWidth: 600 }}>
            Pilot pricing depends on workflow scope and onboarding needs. Early pilot merchants receive hands-on onboarding and founder support.
          </p>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, lineHeight: 1.8, color: '#6B7280', margin: 0, maxWidth: 600 }}>
            Some early pilots may qualify for reduced pricing in exchange for deeper feedback, operator interviews, and a case study.
          </p>
        </div>

        <div id="apply" style={{ borderTop: '1px solid #E8E6E0', paddingTop: 56, marginTop: 56 }}>
          <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 24px' }}>
            Apply for pilot access
          </h2>
          <PilotApplicationForm />
        </div>

        <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 56, marginTop: 56 }}>
          <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 24px' }}>
            FAQ
          </h2>
          {pilotFaqs.map((faq, i) => (
            <div key={i} style={{ borderBottom: '1px solid #E8E6E0', padding: '24px 0', display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '2vw' }}>
              <h3 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 17, fontWeight: 400, color: '#0F0E0D', margin: 0, lineHeight: 1.3 }}>
                {faq.q}
              </h3>
              <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.7, color: '#3A3835', margin: 0 }}>
                {faq.a}
              </p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 56, padding: '40px', background: '#0F0E0D', borderRadius: 16, textAlign: 'center' }}>
          <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 22, color: '#fff', margin: '0 0 20px' }}>
            Apply before the 5 spots are filled
          </p>
          <a href="#apply" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500, color: '#0F0E0D', background: '#fff', borderRadius: 8, padding: '12px 28px', textDecoration: 'none', display: 'inline-block' }}>
            Apply for pilot access
          </a>
        </div>
      </div>
    </>
  )
}