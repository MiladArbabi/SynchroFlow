import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'

export const metadata: Metadata = {
  title: 'FAQ — LaSyncro',
  description:
    'Frequently asked questions about LaSyncro warehouse management. Setup, pricing, integrations, and more.',
  alternates: { canonical: 'https://www.lasyncro.com/faq' },
}

const W = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 5vw',
} as const

const faqs = [
  {
    q: 'How long does setup take?',
    a: 'When public Shopify installation opens, connection will use Shopify OAuth. Initial product and inventory synchronization and warehouse configuration take additional time depending on store size and setup. A complete setup time is not guaranteed.',
  },
  {
    q: 'Do I need technical knowledge to use LaSyncro?',
    a: 'LaSyncro is designed for merchant owners and warehouse teams, with mobile-oriented workflows. Scanner compatibility depends on your device, browser, and barcode hardware; validate your setup before relying on a particular scanner.',
  },
  {
    q: 'What store size is LaSyncro designed for?',
    a: 'LaSyncro is designed for merchants doing $500K–$10M in annual revenue with 1–30 warehouse staff. If you\'re still fulfilling from a spare room, you might not need it yet. If you\'re managing a team and losing track of what\'s where, you probably do.',
  },
  {
    q: 'How does inventory sync work?',
    a: 'LaSyncro records supported warehouse operations when they are confirmed. Shopify inventory updates happen at defined workflow points, such as eligible stow confirmations, and depend on Shopify connectivity and synchronization success. A scan does not guarantee an immediate Shopify stock change.',
  },
  {
    q: 'Can LaSyncro handle multiple warehouse locations?',
    a: 'Paid plans support multiple warehouse locations: Growth includes three and Scale includes ten. Bin-level tracking depends on configured locations and confirmed stock placement; do not assume every product has an assigned bin before receiving and stowing.',
  },
  {
    q: 'What is demand intelligence?',
    a: 'Demand intelligence shows you days of stock remaining at current sales velocity — not just raw unit counts. A product with 200 units sounds safe. At 40 units per day with an 18-day supplier lead time, it\'s a stockout in 5 days. LaSyncro tells you today.',
  },
  {
    q: 'How does PO receiving work?',
    a: 'During receiving, operators count and confirm delivered units against purchase orders and record discrepancies. LaSyncro updates its receiving records as work is confirmed; Shopify stock synchronization follows the relevant inventory workflow rather than every receiving scan.',
  },
  {
    q: 'What data does LaSyncro access from my store?',
    a: 'Shopify OAuth permissions include reading products, orders, inventory and locations, and writing inventory or fulfillment data for supported operations. The permissions granted during installation determine what the app can access. See our Privacy Policy for how data is handled.',
  },
  {
    q: 'Is there a free plan?',
    a: 'The published pricing includes a free Starter tier and a 14-day Growth trial. Public self-service installation is not yet open; join the launch list for availability updates.',
  },
  {
    q: 'What happens if I disconnect my store?',
    a: 'You can revoke the app connection through Shopify. For questions about your LaSyncro account, access, retention or deletion requests, contact support and refer to our Privacy Policy. Data is not automatically guaranteed to be deleted after a fixed number of days.',
  },
  {
    q: 'Does LaSyncro work on mobile?',
    a: 'LaSyncro includes mobile-oriented warehouse workflows. Camera and external barcode scanning depend on the device, browser and hardware; check compatibility before adopting a specific warehouse setup.',
  },
  {
    q: 'What is the 2D/3D warehouse map?',
    a: 'LaSyncro has floor-planning and location-management functionality, with availability depending on your plan and configured warehouse. A visual layout does not by itself confirm stock placement; operators still need accurate location and scan records.',
  },
]

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function FaqPage() {
  return (
    <>
      <Schema data={faqSchema} />

      <style>{`
        .faq-row {
          display: grid;
          grid-template-columns: 1fr 1.4fr;
          gap: 2vw;
          padding: 32px 0;
          border-bottom: 1px solid var(--rule);
        }

        .faq-contact:hover {
          background: var(--accent-hover) !important;
        }

        .faq-contact:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 3px;
        }

        @media (max-width: 720px) {
          .faq-row {
            grid-template-columns: 1fr;
            gap: 12px;
            padding: 24px 0;
          }

          .faq-contact-card {
            padding: 28px 20px !important;
          }
        }
      `}</style>

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
          FAQ
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
          Common questions,
          <br />
          straight answers.
        </h1>

        <p
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.65,
            color: 'var(--ink-2)',
            margin: 0,
            maxWidth: 620,
          }}
        >
          Everything you need to know before connecting your store.
        </p>
      </header>

      <div style={{ ...W, padding: '0 5vw 96px' }}>
        <div style={{ borderTop: '1px solid var(--rule)' }}>
          {faqs.map((faq) => (
            <div key={faq.q} className="faq-row">
              <h2
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 20,
                  fontWeight: 600,
                  color: 'var(--ink)',
                  margin: 0,
                  lineHeight: 1.35,
                }}
              >
                {faq.q}
              </h2>

              <p
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 15,
                  fontWeight: 400,
                  lineHeight: 1.7,
                  color: 'var(--ink-2)',
                  margin: 0,
                }}
              >
                {faq.a}
              </p>
            </div>
          ))}
        </div>

        <div
          className="faq-contact-card"
          style={{
            marginTop: 64,
            padding: 40,
            background: 'var(--accent-ghost)',
            borderRadius: 16,
            border: '1px solid var(--accent-border)',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 20,
              fontWeight: 600,
              color: 'var(--ink)',
              margin: '0 0 8px',
            }}
          >
            Still have questions?
          </p>

          <p
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 14,
              fontWeight: 400,
              lineHeight: 1.6,
              color: 'var(--ink-2)',
              margin: '0 0 20px',
            }}
          >
            We reply to every email within one business day.
          </p>

          <a
            className="faq-contact"
            href="mailto:contact@lasyncro.com"
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--on-accent)',
              background: 'var(--accent)',
              borderRadius: 8,
              padding: '10px 24px',
              textDecoration: 'none',
              display: 'inline-block',
              transition: 'background 0.15s ease',
            }}
          >
            contact@lasyncro.com
          </a>
        </div>
      </div>
    </>
  )
}
