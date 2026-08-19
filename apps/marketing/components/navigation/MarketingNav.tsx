'use client'

import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import LaunchNavCTA from '@/components/conversion/LaunchNavCTA'

const navLinks = [
  { href: '/blog', label: 'Blog' },
  { href: '/compare', label: 'Compare' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/help/getting-started', label: 'Getting started' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
]

export default function MarketingNav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()

  useEffect(() => {
    if (!menuOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  return (
    <nav className="marketing-nav" aria-label="Primary navigation">
      <a href="https://www.lasyncro.com" aria-label="LaSyncro home" className="marketing-nav-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://www.lasyncro.com/logo.png"
          alt="LaSyncro"
        />
      </a>

      <div className="marketing-nav-desktop-links">
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} className="marketing-nav-link">
            {link.label}
          </Link>
        ))}
        <LaunchNavCTA />
      </div>

      <div className="marketing-nav-mobile-actions">
        <LaunchNavCTA />
        <button
          type="button"
          className="marketing-nav-menu-button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((current) => !current)}
        >
          Menu
        </button>
      </div>

      {menuOpen ? (
        <div id={menuId} className="marketing-nav-mobile-menu">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="marketing-nav-mobile-link"
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  )
}
