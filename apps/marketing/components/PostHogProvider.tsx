// components/PostHogProvider.tsx
// Client-side PostHog initialisation — wraps the app once in layout.tsx.
// Tracks page views automatically via usePathname().
// NEVER import this in a server component — 'use client' required for PostHog.
// Key is public (safe to expose) — it only ingests, never reads data.

'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'

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

// Campaign parameters from the landing URL, held in memory only (never stored
// or sent before consent). Used once, on the first pageview after consent,
// when the visitor navigated away from the landing URL before granting it.
const CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

function readCampaignParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search)
  const campaign: Record<string, string> = {}
  for (const key of CAMPAIGN_PARAMS) {
    const value = params.get(key)
    if (value) campaign[key] = value
  }
  return campaign
}

let landingCampaign: Record<string, string> | null =
  typeof window === 'undefined' ? null : readCampaignParams(window.location.search)

function takeLandingCampaign(currentSearch: string): Record<string, string> {
  const campaign = landingCampaign ?? {}
  landingCampaign = null
  if (Object.keys(readCampaignParams(currentSearch)).length > 0) return {}
  return campaign
}

// Marketing identification is added per event (before_send), never through
// PostHog super-properties (register): registered super-properties persist in the shared
// .lasyncro.com cookie and would leak onto app.lasyncro.com events.
function tagMarketingEvent<T extends { properties?: Record<string, unknown> } | null>(
  event: T
): T {
  if (!event) return event
  event.properties = { ...(event.properties ?? {}), surface: 'marketing' }
  return event
}

function subscribeConsent(onChange: () => void) {
  window.addEventListener('lasyncro:analytics-consent', onChange)
  return () => window.removeEventListener('lasyncro:analytics-consent', onChange)
}

let posthogInitialized = false

function initializePostHog() {
  if (!shouldEnablePostHog()) return
  if (getConsent() !== 'granted') return
  if (!POSTHOG_KEY) return
  if (posthogInitialized) {
    if (posthog.has_opted_out_capturing()) {
      posthog.opt_in_capturing({ captureEventName: false })
    }
    return
  }

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
    before_send: tagMarketingEvent,
  } as Parameters<typeof posthog.init>[1])
  posthogInitialized = true

  // A previous withdrawal persists PostHog's own opt-out flag. Our consent
  // cookie is the source of truth, so a fresh grant re-enables capture
  // (without emitting an $opt_in event).
  if (posthog.has_opted_out_capturing()) {
    posthog.opt_in_capturing({ captureEventName: false })
  }
}

/**
 * Applies the current consent cookie to an already-initialised PostHog.
 * Withdrawal stops all capture, including autocapture and pageleave.
 */
export function syncMarketingPostHogConsent() {
  if (getConsent() === 'granted') {
    initializePostHog()
    return
  }
  if (posthogInitialized && !posthog.has_opted_out_capturing()) {
    posthog.opt_out_capturing()
  }
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
      syncMarketingPostHogConsent()
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
  const search = searchParams.toString()
  // Server snapshot is null: the cookie is only read in the browser.
  const consent = useSyncExternalStore(subscribeConsent, getConsent, () => null)
  // One $pageview per distinct URL. Re-renders, consent re-grants and
  // StrictMode effect replays on the same URL never capture twice.
  const lastPageviewUrl = useRef<string | null>(null)

  // Apply grant/withdrawal to PostHog whenever consent changes.
  useEffect(() => {
    syncMarketingPostHogConsent()
  }, [consent])

  useEffect(() => {
    if (!shouldEnablePostHog()) return
    if (consent !== 'granted') return
    initializePostHog()
    if (!posthogInitialized) return

    const url = search
      ? `${window.origin}${pathname}?${search}`
      : `${window.origin}${pathname}`
    if (lastPageviewUrl.current === url) return
    lastPageviewUrl.current = url

    posthog.capture('$pageview', {
      $current_url: url,
      pathname,
      ...getPageviewContext(pathname),
      ...takeLandingCampaign(search),
    })
  }, [pathname, search, consent])

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
