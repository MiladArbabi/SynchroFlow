// components/PostHogProvider.tsx
// Client-side PostHog initialisation — wraps the app once in layout.tsx.
// Tracks page views automatically via usePathname().
// NEVER import this in a server component — 'use client' required for PostHog.
// Key is public (safe to expose) — it only ingests, never reads data.

'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { usePostHog } from 'posthog-js/react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://t.lasyncro.com'

function shouldEnablePostHog() {
  if (typeof window === 'undefined') return false

  const { hostname, host } = window.location

  // Keep local/dev sessions out of production analytics.
  // Pageviews are measured globally below, so never initialise PostHog again in route files.
  return (
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    !host.includes('localhost')
  )
}

function getPageviewContext(pathname: string) {
  if (pathname === '/blog') return { section: 'blog', page_type: 'blog_index' }
  if (pathname.startsWith('/blog/')) return { section: 'blog', page_type: 'blog_article' }
  if (pathname === '/compare') return { section: 'compare', page_type: 'compare_index' }
  if (pathname.startsWith('/compare/')) return { section: 'compare', page_type: 'compare_article' }
  if (pathname === '/glossary') return { section: 'glossary', page_type: 'glossary_index' }
  if (pathname.startsWith('/glossary/')) return { section: 'glossary', page_type: 'glossary_entry' }
  if (pathname === '/pricing') return { section: 'pricing', page_type: 'pricing' }
  if (pathname === '/about') return { section: 'about', page_type: 'about' }
  if (pathname === '/') return { section: 'home', page_type: 'home' }

  return { section: 'marketing', page_type: 'static_page' }
}

if (shouldEnablePostHog()) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: 'https://app.posthog.com',
    defaults: '2026-01-30',
    autocapture: true,
    capture_pageview: false,
    capture_pageleave: true,
    cookie_domain: '.lasyncro.com',
    cross_subdomain_cookie: true,
    persistence: 'localStorage+cookie',
  } as Parameters<typeof posthog.init>[1])
}

/** Fires one enriched $pageview event on every client-side route change. */
function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ph = usePostHog()

  useEffect(() => {
    if (!shouldEnablePostHog()) return
    const url = searchParams.toString()
      ? `${window.origin}${pathname}?${searchParams.toString()}`
      : `${window.origin}${pathname}`
    ph?.capture('$pageview', {
      $current_url: url,
      pathname,
      ...getPageviewContext(pathname),
    })
  }, [pathname, searchParams, ph])

  return null
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </PHProvider>
  )
}