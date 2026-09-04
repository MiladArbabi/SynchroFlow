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
import { Suspense, useEffect, useState } from 'react'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://t.lasyncro.com'

const CONSENT_COOKIE = 'lasyncro_analytics_consent'
type Consent = 'granted' | 'denied' | null

function getConsent(): Consent {
  if (typeof document === 'undefined') return null

  const prefix = `${CONSENT_COOKIE}=`
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)

  return value === 'granted' || value === 'denied' ? value : null
}

function shouldEnablePostHog() {
  if (typeof window === 'undefined') return false
  if (process.env.NODE_ENV !== 'production') return false
  if (!POSTHOG_KEY) return false

  const { hostname } = window.location

  // Production public hosts only. Preview/staging/local hosts fail closed.
  return hostname === 'www.lasyncro.com' || hostname === 'lasyncro.com'
}

function getPageviewContext(pathname: string) {
  if (pathname === '/blog') return { section: 'blog', page_type: 'blog_index' }
  if (pathname.startsWith('/blog/')) return { section: 'blog', page_type: 'blog_article' }
  if (pathname === '/compare') return { section: 'compare', page_type: 'compare_index' }
  if (pathname.startsWith('/compare/')) return { section: 'compare', page_type: 'compare_article' }
  if (pathname === '/pricing') return { section: 'pricing', page_type: 'pricing' }
  if (pathname === '/about') return { section: 'about', page_type: 'about' }
  if (pathname === '/') return { section: 'home', page_type: 'home' }

  return { section: 'marketing', page_type: 'static_page' }
}

let posthogInitialized = false

function initializePostHog() {
  if (!shouldEnablePostHog()) return
  if (getConsent() !== 'granted') return
  if (!POSTHOG_KEY) return
  if (posthogInitialized) return

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
  posthogInitialized = true
}

export function captureMarketingEvent(
  event: string,
  properties: Record<string, unknown> = {}
) {
  if (!shouldEnablePostHog()) return
  if (getConsent() !== 'granted') return

  initializePostHog()
  if (!posthogInitialized) return

  posthog.capture(event, properties)
}

/** Fires one enriched $pageview event on every client-side route change. */
export function useMarketingAnalyticsReady(): boolean {
  const [analyticsReady, setAnalyticsReady] = useState(false)

  useEffect(() => {
    const sync = () => {
      initializePostHog()
      setAnalyticsReady(
        shouldEnablePostHog() &&
          getConsent() === 'granted' &&
          posthogInitialized
      )
    }

    sync()
    window.addEventListener('lasyncro:analytics-consent', sync)

    return () =>
      window.removeEventListener('lasyncro:analytics-consent', sync)
  }, [])

  return analyticsReady
}

function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ph = usePostHog()
  const [consent, setConsent] = useState<Consent>(getConsent())

  useEffect(() => {
    const onConsent = () => setConsent(getConsent())

    window.addEventListener('lasyncro:analytics-consent', onConsent)
    return () =>
      window.removeEventListener('lasyncro:analytics-consent', onConsent)
  }, [])

  useEffect(() => {
    if (!shouldEnablePostHog()) return
    if (consent !== 'granted') return
    initializePostHog()
    const url = searchParams.toString()
      ? `${window.origin}${pathname}?${searchParams.toString()}`
      : `${window.origin}${pathname}`
    ph?.capture('$pageview', {
      $current_url: url,
      pathname,
      ...getPageviewContext(pathname),
    })
  }, [pathname, searchParams, ph, consent])

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
