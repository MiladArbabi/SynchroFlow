// app/layout.tsx
// Root layout for the LaSyncro marketing app.
// Loads DM Sans + Instrument Serif from Google Fonts — matching the landing page typography.
// Nav and Footer wrap all pages consistently.

import type { Metadata } from 'next'
import { DM_Sans, Instrument_Serif } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import Image from 'next/image'

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LaSyncro — Operational Intelligence for Shopify Merchants',
  description: 'Real-time inventory, warehouse management, PO receiving, full order traceability and workforce tools for Shopify merchants running their own warehouse.',
  metadataBase: new URL('https://lasyncro.com'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${instrumentSerif.variable}`}
    >
      <body className="min-h-screen flex flex-col" style={{ fontFamily: 'var(--sans)' }}>
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}

function Nav() {
  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        height: '60px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 5vw',
        justifyContent: 'space-between',
        background: 'rgba(250,250,248,0.88)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <a href="https://lasyncro.com" aria-label="LaSyncro home" style={{ display: 'flex', alignItems: 'center' }}>
        <Image
          src="https://lasyncro.com/White_text_no_bg.png"
          alt="LaSyncro"
          width={120}
          height={28}
          style={{ width: 'auto', height: '28px' }}
          priority
        />
      </a>
      
      <a
        href="https://lasyncro.com/#waitlist"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 18px',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 500,
          borderRadius: '6px',
          textDecoration: 'none',
          transition: 'background 0.15s',
        }}
        className="nav-cta"
      >
        Get early access
      </a>
    </nav>
  )
}

function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '40px 5vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        background: 'var(--bg-2)',
        fontSize: '13px',
        color: 'var(--ink-3)',
      }}
    >
      <span>© 2026 LaSyncro. All rights reserved.</span>
      <div style={{ display: 'flex', gap: '24px' }}>
        <a href="https://lasyncro.com" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Home</a>
        <Link href="/blog" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Blog</Link>
<Link href="/compare" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Compare</Link>
<Link href="/about" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>About</Link>
        <a href="mailto:contact@lasyncro.com" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Contact</a>
      </div>
    </footer>
  )
}