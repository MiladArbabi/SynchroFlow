// app/about/page.tsx
// Entity anchor page — establishes LaSyncro as a known entity for Google and AI engines.
// Schema: Organization + AboutPage (referenced by homepage @id).

import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'

export const metadata: Metadata = {
  title: 'About LaSyncro — Operational Intelligence for Shopify Merchants',
  description: 'LaSyncro is built for Shopify merchants running their own warehouse. Learn about our mission, who we are, and who we build for.',
  alternates: { canonical: 'https://www.lasyncro.com/about' },
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

export default function AboutPage() {
  return (
    <>
      <Schema data={organizationSchema} />
      <Schema data={aboutPageSchema} />
      <main style={{ maxWidth: '680px', margin: '0 auto', padding: '48px 0' }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 400, color: 'var(--ink)', marginBottom: '24px' }}>
          About LaSyncro
        </h1>
        <p style={{ fontSize: '16px', color: 'var(--ink-2)', lineHeight: 1.8, marginBottom: '20px' }}>
          LaSyncro is an operational intelligence platform built for Shopify merchants running their own warehouse. We connect orders, inventory, suppliers, warehouse workflows, and workforce into a single real-time picture — replacing the spreadsheets, WhatsApp threads, and disconnected tools most SMB merchants rely on.
        </p>
        <p style={{ fontSize: '16px', color: 'var(--ink-2)', lineHeight: 1.8, marginBottom: '20px' }}>
          We built LaSyncro for merchants doing £500K to £10M+ in revenue who operate their own warehouse with a small team. Merchants who have outgrown Shopify native tools but cannot justify the price tag or implementation timelines of enterprise WMS platforms like Cin7, Linnworks, or Brightpearl.
        </p>
        <p style={{ fontSize: '16px', color: 'var(--ink-2)', lineHeight: 1.8, marginBottom: '40px' }}>
          Our mission is to give every serious Shopify merchant the operational clarity that was previously only available to enterprise retailers.
        </p>
        <a
          href="https://lasyncro.com/#waitlist"
          style={{
            display: 'inline-block',
            borderRadius: '6px',
            background: '#FF6B2B',
            padding: '12px 24px',
            fontSize: '14px',
            fontWeight: 500,
            color: '#fff',
            textDecoration: 'none',
          }}
        >
          Join the waitlist
        </a>
      </main>
    </>
  )
}