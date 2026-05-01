// app/about/page.tsx
// Entity anchor page — establishes LaSyncro as a known entity for Google and AI engines.
// Schema: Organization + Person + AboutPage (referenced by homepage @id).

import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'

export const metadata: Metadata = {
  title: 'About LaSyncro — Operational Intelligence for Shopify Merchants',
  description: 'LaSyncro is built for Shopify merchants running their own warehouse. Learn about our mission, who we are, and who we build for.',
  alternates: { canonical: 'https://lasyncro.com/about' },
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
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
          About LaSyncro
        </h1>
        <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
          LaSyncro is an operational intelligence platform built for Shopify merchants running their own warehouse. We connect orders, inventory, suppliers, warehouse workflows, and workforce into a single real-time picture — replacing the spreadsheets, WhatsApp threads, and disconnected tools most SMB merchants rely on.
        </p>
        <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
          We built LaSyncro for merchants doing £500K to £10M+ in revenue who operate their own warehouse with a small team. Merchants who have outgrown Shopify native tools but can not justify the price tag or implementation timelines of enterprise WMS platforms like Cin7, Linnworks, or Brightpearl.
        </p>
        <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed">
          Our mission is to give every serious Shopify merchant the operational clarity that was previously only available to enterprise retailers.
        </p>
        <div className="mt-10">
          
            <a href="https://lasyncro.com/#waitlist" className="inline-block rounded-md bg-orange-500 px-6 py-3 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            Join the waitlist
          </a>
        </div>
      </main>
    </>
  )
}