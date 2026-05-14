// components/PostHogProvider.tsx
// Client-side PostHog initialisation — wraps the app once in layout.tsx.
// Tracks page views automatically via usePathname().
// NEVER import this in a server component — 'use client' required for PostHog.
// Key is public (safe to expose) — it only ingests, never reads data.

'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

const POSTHOG_KEY = 'phc_kVdrQpoCzz5J7n9NzHW2gXHtwA6PC9gQJW294ajhpmrM'
const POSTHOG_HOST = 'https://t.lasyncro.com' // proxied host — matches checklist page config

if (typeof window !== 'undefined') {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: 'https://app.posthog.com',
    autocapture: true,
    capture_pageview: false, // manual below — prevents double-fire with Next.js router
    capture_pageleave: true,
  })
}

/** Fires a $pageview event on every client-side route change */
function PageViewTracker() {
  const pathname = usePathname()
  const ph = usePostHog()
  useEffect(() => {
    ph?.capture('$pageview', { $current_url: window.location.href })
  }, [pathname, ph])
  return null
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <PageViewTracker />
      {children}
    </PHProvider>
  )
}