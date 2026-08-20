// app/about/page.tsx
// Entity anchor page — establishes LaSyncro as a known entity for Google and AI engines.
// Schema: Organization + AboutPage (referenced by homepage @id).
// IMPORTANT: No font: shorthand in inline styles — CSS vars don't resolve in font shorthand.

import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'
import AboutCTAs from '@/components/about/AboutCTAs'
import ArticleImage from '@/components/article/ArticleImage'

export const metadata: Metadata = {
  title: 'About LaSyncro — Operational Intelligence for Shopify Merchants',
  description:
    'LaSyncro is built for Shopify merchants running their own warehouse. Learn about our mission, who we are, and who we build for.',
  alternates: { canonical: 'https://www.lasyncro.com/about' },
  openGraph: {
    title: 'About LaSyncro — Operational Intelligence for Shopify Merchants',
    description:
      'LaSyncro is built for Shopify merchants running their own warehouse.',
    url: 'https://www.lasyncro.com/about',
    type: 'website',
    images: [
      {
        url: 'https://www.lasyncro.com/og_image_lightmode.png',
        width: 1200,
        height: 630,
      },
    ],
  },
}

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': 'https://www.lasyncro.com/#organization',
  name: 'LaSyncro',
  url: 'https://www.lasyncro.com',
  email: 'contact@lasyncro.com',
  foundingDate: '2026',
  description:
    'LaSyncro is an operational intelligence platform for Shopify merchants running their own warehouse.',
}

const aboutPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': 'https://www.lasyncro.com/about',
  url: 'https://www.lasyncro.com/about',
  name: 'About LaSyncro',
  publisher: { '@id': 'https://www.lasyncro.com/#organization' },
}

const W = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 5vw',
} as const

export default function AboutPage() {
  return (
    <>
      <Schema data={organizationSchema} />
      <Schema data={aboutPageSchema} />

      <style>{`
        .about-main-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 64px;
          align-items: center;
        }

        .about-main-grid .article-visual-breakout {
          opacity: 1;
          transform: none;
          margin-left: 0;
          margin-right: 0;
        }

        .about-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          background: var(--rule);
          border: 1px solid var(--rule);
          border-radius: 12px;
          overflow: hidden;
        }

        @media (max-width: 880px) {
          .about-main-grid {
            grid-template-columns: 1fr;
            gap: 40px;
          }
        }

        @media (max-width: 720px) {
          .about-stats-grid {
            grid-template-columns: 1fr;
          }

          .about-stat-card {
            padding: 24px !important;
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
          Our story
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
            maxWidth: 900,
          }}
        >
          Built for merchants who{' '}
          <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>
            run their own warehouse.
          </em>
        </h1>

        <p
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.65,
            color: 'var(--ink-2)',
            maxWidth: 620,
            margin: 0,
          }}
        >
          LaSyncro is an operational intelligence platform built for Shopify
          merchants who have outgrown spreadsheets but don&apos;t need
          enterprise complexity.
        </p>
      </header>

      <div style={{ ...W, padding: '0 5vw' }}>
        <div style={{ borderTop: '1px solid var(--rule)' }} />
      </div>

      <section style={{ ...W, padding: '56px 5vw 0' }}>
        <div className="about-main-grid">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}
          >
            <p
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 16,
                fontWeight: 400,
                lineHeight: 1.8,
                color: 'var(--ink-2)',
                margin: 0,
              }}
            >
              LaSyncro connects orders, inventory, suppliers, warehouse
              workflows, and workforce into a single real-time picture —
              replacing the spreadsheets, WhatsApp threads, and disconnected
              tools most SMB merchants rely on.
            </p>

            <p
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 16,
                fontWeight: 400,
                lineHeight: 1.8,
                color: 'var(--ink-2)',
                margin: 0,
              }}
            >
              We built LaSyncro for merchants doing $500K to $10M+ in revenue
              who operate their own warehouse with a small team. Merchants who
              have outgrown Shopify native tools but cannot justify the price
              tag or implementation timelines of enterprise WMS platforms like
              Cin7, Linnworks, or Brightpearl.
            </p>

            <p
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 16,
                fontWeight: 400,
                lineHeight: 1.8,
                color: 'var(--ink-2)',
                margin: 0,
              }}
            >
              Our mission is to give every serious Shopify merchant the
              operational clarity that was previously only available to
              enterprise retailers.
            </p>
          </div>

          <div>
            <ArticleImage
              src="floorplanning-4.png"
              alt="LaSyncro mobile scanning interface showing warehouse location management and real-time inventory drift prevention"
              caption="Every scan closes the gap between physical stock and Shopify's records."
              priority={true}
              variant="dark"
            />
          </div>
        </div>
      </section>

      <section style={{ ...W, padding: '64px 5vw' }}>
        <div className="about-stats-grid">
          {[
            { num: '$500K–$10M', label: 'Revenue range we build for' },
            { num: '1–30', label: 'Warehouse team size' },
            { num: '60s', label: 'Shopify connection time' },
          ].map(({ num, label }) => (
            <div
              key={label}
              className="about-stat-card"
              style={{
                background: 'var(--surface)',
                padding: '28px 32px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 36,
                  fontWeight: 650,
                  color: 'var(--accent)',
                  fontStyle: 'italic',
                  letterSpacing: '-0.035em',
                  marginBottom: 8,
                }}
              >
                {num}
              </div>

              <div
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: 1.5,
                  color: 'var(--ink-2)',
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...W, padding: '0 5vw 80px' }}>
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            paddingTop: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            flexWrap: 'wrap',
          }}
        >
          <AboutCTAs />
        </div>
      </section>
    </>
  )
}
