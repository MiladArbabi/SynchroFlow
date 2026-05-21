import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'

export const metadata: Metadata = {
  title: 'FAQ — LaSyncro',
  description: 'Frequently asked questions about LaSyncro warehouse management. Setup, pricing, integrations, and more.',
  alternates: { canonical: 'https://www.lasyncro.com/faq' },
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

const faqs = [
  {
    q: 'How long does setup take?',
    a: 'Most merchants are fully connected in under 60 seconds. Connect your store, complete OAuth, and LaSyncro syncs your products, orders, and inventory automatically. No CSV imports, no manual data entry, no IT team required.',
  },
  {
    q: 'Do I need technical knowledge to use LaSyncro?',
    a: 'No. LaSyncro is built for warehouse operators and merchant owners — not developers. If you can use a smartphone, you can use LaSyncro. The mobile scan interface works with any Bluetooth barcode scanner or your phone camera.',
  },
  {
    q: 'What store size is LaSyncro designed for?',
    a: 'LaSyncro is designed for merchants doing £500K–£10M in annual revenue with 1–30 warehouse staff. If you\'re still fulfilling from a spare room, you might not need it yet. If you\'re managing a team and losing track of what\'s where, you probably do.',
  },
  {
    q: 'How does inventory sync work?',
    a: 'Every scan — pick, pack, receive — updates your store\'s inventory count in real time. There is no end-of-day reconciliation, no batch sync window, and no lag. When your warehouse team scans a unit out, your store reflects that immediately.',
  },
  {
    q: 'Can LaSyncro handle multiple warehouse locations?',
    a: 'Yes. LaSyncro supports multiple warehouse locations with bin-level tracking. Every product has a precise location — bin, zone, aisle — so any team member can pick correctly on day one.',
  },
  {
    q: 'What is demand intelligence?',
    a: 'Demand intelligence shows you days of stock remaining at current sales velocity — not just raw unit counts. A product with 200 units sounds safe. At 40 units per day with an 18-day supplier lead time, it\'s a stockout in 5 days. LaSyncro tells you today.',
  },
  {
    q: 'How does PO receiving work?',
    a: 'When a delivery arrives, your team scans each unit against the open purchase order. LaSyncro compares what arrived against what was ordered and flags any discrepancy — short shipments, wrong SKUs, damaged units. Inventory updates at point of scan.',
  },
  {
    q: 'What data does LaSyncro access from my store?',
    a: 'LaSyncro accesses orders, products, inventory levels, and locations via OAuth. We use this data exclusively to operate the service. We do not sell, share, or use your store data for any purpose other than running LaSyncro on your behalf. See our privacy policy for full details.',
  },
  {
    q: 'Is there a free plan?',
    a: 'Yes. The Starter plan is free and gives you enough to understand LaSyncro and evaluate whether it fits your operation. All paid plans include a 14-day Growth trial — no credit card required.',
  },
  {
    q: 'What happens if I disconnect my store?',
    a: 'You can disconnect at any time. Your LaSyncro account and historical data are retained for 30 days, after which they are permanently deleted on request. We do not hold your data hostage.',
  },
  {
    q: 'Does LaSyncro work on mobile?',
    a: 'Yes. The pick and pack interface is designed for mobile use. It works with any Bluetooth barcode scanner or your phone camera. Warehouse operators can work entirely from a phone or tablet — no desktop required for day-to-day operations.',
  },
  {
    q: 'What is the 2D/3D warehouse map?',
    a: 'LaSyncro generates a visual map of your warehouse layout based on your bin and zone configuration. Every product is locatable on the map. New staff can navigate to any product without knowing the layout — the map tells them where to go.',
  },
]

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function FaqPage() {
  return (
    <>
      <Schema data={faqSchema} />

      <header style={{ ...W, padding: '96px 5vw 64px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B2B', display: 'inline-block' }} />
          FAQ
        </div>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 20px', maxWidth: 640 }}>
          Common questions,<br />straight answers.
        </h1>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 17, fontWeight: 300, lineHeight: 1.65, color: '#6B7280', margin: 0, maxWidth: 480 }}>
          Everything you need to know before connecting your store.
        </p>
      </header>

      <div style={{ ...W, padding: '0 5vw 96px' }}>
        <div style={{ borderTop: '1px solid #E8E6E0' }}>
          {faqs.map((faq, i) => (
            <div key={i} style={{ borderBottom: '1px solid #E8E6E0', padding: '32px 0', display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '2vw' }}>
              <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 20, fontWeight: 400, color: '#0F0E0D', margin: 0, lineHeight: 1.3 }}>
                {faq.q}
              </h2>
              <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.7, color: '#3A3835', margin: 0 }}>
                {faq.a}
              </p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 64, padding: '40px', background: '#FFF5F0', borderRadius: 16, border: '1px solid #FFD4BC', textAlign: 'center' }}>
          <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 20, color: '#0F0E0D', margin: '0 0 8px' }}>
            Still have questions?
          </p>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, color: '#6B7280', margin: '0 0 20px' }}>
            We reply to every email within one business day.
          </p>
          <a href="mailto:contact@lasyncro.com" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 500, color: '#fff', background: '#FF6B2B', borderRadius: 8, padding: '10px 24px', textDecoration: 'none', display: 'inline-block' }}>
            contact@lasyncro.com
          </a>
        </div>
      </div>
    </>
  )
}