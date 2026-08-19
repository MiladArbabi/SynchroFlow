// app/layout.tsx
// Root layout for the LaSyncro marketing app.

import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import Schema from '@/components/seo/Schema'
import PostHogProvider from '@/components/PostHogProvider'
import MarketingNav from '@/components/navigation/MarketingNav'

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-plus-jakarta-sans',
  display: 'swap',
})

// Organization entity — defines LaSyncro as a named entity for Google's Knowledge Graph.
// All Article/SoftwareApplication schemas reference this via '@id' — this is where it resolves.
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': 'https://www.lasyncro.com/#organization',
  name: 'LaSyncro',
  url: 'https://www.lasyncro.com',
  logo: 'https://www.lasyncro.com/logo-light.png',
  sameAs: [],
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'contact@lasyncro.com',
    contactType: 'customer support',
  },
}
export const metadata: Metadata = {
  title: 'LaSyncro — Operational Intelligence for Shopify Merchants',
  description: 'Real-time inventory, warehouse management, PO receiving, full order traceability and workforce tools for Shopify merchants running their own warehouse.',
  metadataBase: new URL('https://www.lasyncro.com'),
    icons: {
      icon: [
        // SVG favicon — Chrome respects prefers-color-scheme inside SVG (light/dark adaptive)
        { url: '/favicon-light.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' },
        { url: '/favicon-dark.svg',  type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' },
        // PNG fallbacks for browsers that don't support SVG favicons
        { url: '/favicon-32-light.png', sizes: '32x32', type: 'image/png', media: '(prefers-color-scheme: light)' },
        { url: '/favicon-32-dark.png',  sizes: '32x32', type: 'image/png', media: '(prefers-color-scheme: dark)' },
        { url: '/favicon-32-light.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon.ico', sizes: 'any' },
      ],
      apple: [
        { url: '/apple-touch-icon.png', sizes: '180x180' },
      ],
    },
  }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable}`}>
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", background: '#FAFAF8', color: '#0F0E0D' }}>
        <PostHogProvider>
          <Schema data={organizationSchema} />
          <MarketingNav />
          <main style={{ flex: 1, paddingTop: '60px' }}>{children}</main>
          <Footer />
        </PostHogProvider>
      </body>
    </html>
  )
}

function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid #E8E6E0',
      padding: '40px 5vw',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '16px',
      background: '#F3F2EF',
      fontSize: '13px',
      color: '#6B7280',
    }}>
      <span style={{ color: '#6B7280' }}>© 2026 LaSyncro. All rights reserved.</span>
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <a href="https://www.lasyncro.com" style={{ color: '#6B7280', textDecoration: 'none' }}>Home</a>
        <Link href="/blog" style={{ color: '#6B7280', textDecoration: 'none' }}>Blog</Link>
        <Link href="/compare" style={{ color: '#6B7280', textDecoration: 'none' }}>Compare</Link>
        <Link href="/pricing" style={{ color: '#6B7280', textDecoration: 'none' }}>Pricing</Link>
        <Link href="/about" style={{ color: '#6B7280', textDecoration: 'none' }}>About</Link>
        <a href="mailto:contact@lasyncro.com" style={{ color: '#6B7280', textDecoration: 'none' }}>Contact</a>
      </div>
    </footer>
  )
}
