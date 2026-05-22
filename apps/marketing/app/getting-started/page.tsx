import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'

export const metadata: Metadata = {
  title: 'Getting Started — LaSyncro',
  description: 'How to set up LaSyncro for your warehouse. Connect your store, configure locations, and run your first pick in under an hour.',
  alternates: { canonical: 'https://www.lasyncro.com/getting-started' },
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

const steps = [
  {
    n: '01',
    title: 'Create your account',
    body: 'Go to app.lasyncro.com and sign up with your email. No credit card required. You\'ll be in the app in under 60 seconds.',
  },
  {
    n: '02',
    title: 'Connect your store',
    body: 'Click "Connect your store", enter your store URL, and complete the OAuth flow. LaSyncro will immediately begin syncing your products, orders, inventory levels, and locations. This typically takes 2–5 minutes for stores with up to 10,000 SKUs.',
  },
  {
    n: '03',
    title: 'Set up your warehouse locations',
    body: 'Create your warehouse zones, aisles, and bins in LaSyncro. Assign each product a home location. You don\'t need to do this all at once — start with your top 20% of SKUs by order volume and expand from there.',
  },
  {
    n: '04',
    title: 'Run your first pick list',
    body: 'When an order comes in, LaSyncro creates a pick list automatically. Open the mobile interface, follow the bin locations, and scan each item as you pick it. Wrong item? LaSyncro flags it before it goes in the box. Inventory updates in real time.',
  },
  {
    n: '05',
    title: 'Receive your first supplier delivery',
    body: 'When a delivery arrives, open a receive job in LaSyncro and scan each unit as it comes off the pallet. LaSyncro compares what arrived against your purchase order and flags any discrepancy. Inventory updates at point of scan — not end of day.',
  },
  {
    n: '06',
    title: 'Review your stock risk dashboard',
    body: 'LaSyncro shows you days of stock remaining per SKU at current sales velocity. Review this daily — it\'s the number that tells you what to reorder before it becomes urgent. Set up supplier contacts so you can act on it immediately.',
  },
]

const gsSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to set up LaSyncro for your warehouse',
  description: 'Connect your store, configure locations, and run your first pick in under an hour.',
  step: steps.map(s => ({
    '@type': 'HowToStep',
    name: s.title,
    text: s.body,
  })),
}

export default function GettingStartedPage() {
  return (
    <>
      <Schema data={gsSchema} />

      <header style={{ ...W, padding: '96px 5vw 64px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B2B', display: 'inline-block' }} />
          Getting Started
        </div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 20px', maxWidth: 640 }}>
          From zero to running<br />in under an hour.
        </h1>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 17, fontWeight: 300, lineHeight: 1.65, color: '#6B7280', margin: 0, maxWidth: 520 }}>
          No implementation timeline. No IT team. No CSV imports. Just connect and go.
        </p>
      </header>

      <div style={{ ...W, padding: '0 5vw 96px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '2vw', padding: '40px 0', borderBottom: i < steps.length - 1 ? '1px solid #E8E6E0' : 'none' }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 48, fontWeight: 400, color: '#E8E6E0', lineHeight: 1, paddingTop: 4 }}>
                {step.n}
              </div>
              <div>
                <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, color: '#0F0E0D', margin: '0 0 12px', lineHeight: 1.2 }}>
                  {step.title}
                </h2>
                <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.75, color: '#3A3835', margin: 0 }}>
                  {step.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 64, padding: '40px', background: '#FFF5F0', borderRadius: 16, border: '1px solid #FFD4BC', display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 24 }}>
          <div>
            <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 22, color: '#0F0E0D', margin: '0 0 6px' }}>
              Ready to connect your store?
            </p>
            <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, color: '#6B7280', margin: 0 }}>
              Free to start. No credit card required.
            </p>
          </div>
          <a href="https://app.lasyncro.com" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 500, color: '#fff', background: '#FF6B2B', borderRadius: 8, padding: '12px 28px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Get started free
          </a>
        </div>
      </div>
    </>
  )
}