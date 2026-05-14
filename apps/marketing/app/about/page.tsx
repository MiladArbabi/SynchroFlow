// app/about/page.tsx
// Entity anchor page — establishes LaSyncro as a known entity for Google and AI engines.
// Schema: Organization + AboutPage (referenced by homepage @id).
// IMPORTANT: No font: shorthand in inline styles — CSS vars don't resolve in font shorthand.

import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About LaSyncro — Operational Intelligence for Shopify Merchants',
  description: 'LaSyncro is built for Shopify merchants running their own warehouse. Learn about our mission, who we are, and who we build for.',
  alternates: { canonical: 'https://www.lasyncro.com/about' },
  openGraph: {
    title: 'About LaSyncro — Operational Intelligence for Shopify Merchants',
    description: 'LaSyncro is built for Shopify merchants running their own warehouse.',
    url: 'https://www.lasyncro.com/about',
    type: 'website',
    images: [{ url: 'https://www.lasyncro.com/og_image_lightmode.png', width: 1200, height: 630 }],
  },
}

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': 'https://lasyncro.com/#organization',
  name: 'LaSyncro',
  url: 'https://lasyncro.com',
  email: 'contact@lasyncro.com',
  foundingDate: '2026',
  description: 'LaSyncro is an operational intelligence platform for Shopify merchants running their own warehouse.',
}

const aboutPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': 'https://lasyncro.com/about',
  url: 'https://lasyncro.com/about',
  name: 'About LaSyncro',
  publisher: { '@id': 'https://lasyncro.com/#organization' },
}

function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
    </svg>
  )
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

export default function AboutPage() {
  return (
    <>
      <Schema data={organizationSchema} />
      <Schema data={aboutPageSchema} />

      <style>{`a { color: inherit; text-decoration: none; }`}</style>

      {/* ── Page header ───────────────────────────────────────────── */}
      <header style={{ ...W, padding: '96px 5vw 56px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B2B', display: 'inline-block' }} />
          Our story
        </div>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 64, fontWeight: 400, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 32px', maxWidth: 820 }}>
          Built for merchants who{' '}
          <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>run their own warehouse.</em>
        </h1>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 18, fontWeight: 300, lineHeight: 1.55, color: '#3A3835', maxWidth: 560, margin: 0 }}>
          LaSyncro is an operational intelligence platform built for Shopify merchants who have outgrown spreadsheets but don&apos;t need enterprise complexity.
        </p>
      </header>

      {/* ── Rule ──────────────────────────────────────────────────── */}
      <div style={{ ...W, padding: '0 5vw' }}>
        <div style={{ borderTop: '1px solid #E8E6E0' }} />
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <section style={{ ...W, padding: '56px 5vw 0' }}>
        <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: '#3A3835', margin: 0 }}>
            LaSyncro connects orders, inventory, suppliers, warehouse workflows, and workforce into a single real-time picture — replacing the spreadsheets, WhatsApp threads, and disconnected tools most SMB merchants rely on.
          </p>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: '#3A3835', margin: 0 }}>
            We built LaSyncro for merchants doing $500K to $10M+ in revenue who operate their own warehouse with a small team. Merchants who have outgrown Shopify native tools but cannot justify the price tag or implementation timelines of enterprise WMS platforms like Cin7, Linnworks, or Brightpearl.
          </p>
          <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: '#3A3835', margin: 0 }}>
            Our mission is to give every serious Shopify merchant the operational clarity that was previously only available to enterprise retailers.
          </p>
        </div>
      </section>

      {/* ── Stats strip ───────────────────────────────────────────── */}
      <section style={{ ...W, padding: '64px 5vw' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: '#E8E6E0', border: '1px solid #E8E6E0', borderRadius: 12, overflow: 'hidden' }}>
          {[
            { num: '$500K–$10M', label: 'Revenue range we build for' },
            { num: '1–30', label: 'Warehouse team size' },
            { num: '60s', label: 'Shopify connection time' },
          ].map(({ num, label }) => (
            <div key={label} style={{ background: '#FFFFFF', padding: '28px 32px' }}>
              <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, fontWeight: 400, color: '#FF6B2B', fontStyle: 'italic', marginBottom: 8 }}>
                {num}
              </div>
              <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, lineHeight: 1.5, color: '#6B7280' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section style={{ ...W, padding: '0 5vw 80px' }}>
        <div style={{ borderTop: '1px solid #E8E6E0', paddingTop: 48, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <a href="https://lasyncro.com/#waitlist" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', background: '#FF6B2B', color: '#fff',
            fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
            borderRadius: 6,
          }}>
            Get early access
            <ArrowRight size={14} />
          </a>
          <Link href="/blog" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
            color: '#0F0E0D', paddingBottom: 4, borderBottom: '1px solid #0F0E0D',
          }}>
            Read the operator&apos;s library
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </>
  )
}