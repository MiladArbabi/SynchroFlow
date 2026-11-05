'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const GA4_ID = 'G-1H3XLN9MN2'
const CONSENT_COOKIE = 'lasyncro_analytics_consent'
const PREFERENCES_EVENT = 'lasyncro:analytics-preferences'
const GA_DISABLE_KEY = `ga-disable-${GA4_ID}`
type Consent = 'granted' | 'denied' | null

function shouldEnableGA4() {
  if (typeof window === 'undefined') return false
  if (process.env.NODE_ENV !== 'production') return false

  return (
    window.location.hostname === 'www.lasyncro.com' ||
    window.location.hostname === 'lasyncro.com'
  )
}

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

function setConsent(value: Exclude<Consent, null>) {
  if (!shouldEnableGA4()) return

  document.cookie =
    `${CONSENT_COOKIE}=${value}; ` +
    'Max-Age=31536000; Path=/; Domain=.lasyncro.com; SameSite=Lax; Secure'

  if (value === 'denied') disableGA4()

  window.dispatchEvent(
    new CustomEvent('lasyncro:analytics-consent', { detail: value })
  )
}

function subscribeConsent(onChange: () => void) {
  window.addEventListener('lasyncro:analytics-consent', onChange)
  return () => window.removeEventListener('lasyncro:analytics-consent', onChange)
}

const subscribeNever = () => () => undefined

// Server snapshots are null/false: cookie and hostname exist only in the browser.
function useConsent(): Consent {
  return useSyncExternalStore(subscribeConsent, getConsent, () => null)
}

function useProductionHost(): boolean {
  return useSyncExternalStore(subscribeNever, shouldEnableGA4, () => false)
}

/** Stops further GA4 hits on this page and removes GA4 identifier cookies. */
function disableGA4() {
  const analyticsWindow = window as unknown as Record<string, unknown>
  analyticsWindow[GA_DISABLE_KEY] = true

  document.cookie
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter((name) => name === '_ga' || name.startsWith('_ga_'))
    .forEach((name) => {
      for (const domain of ['; Domain=.lasyncro.com', '; Domain=lasyncro.com', '']) {
        document.cookie = `${name}=; Max-Age=0; Path=/${domain}`
      }
    })
}

/** Reopens the consent banner so a visitor can change or withdraw consent. */
export function openAnalyticsPreferences() {
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT))
}

function getGtag() {
  const analyticsWindow = window as typeof window & {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }

  analyticsWindow.dataLayer = analyticsWindow.dataLayer || []

  if (!analyticsWindow.gtag) {
    analyticsWindow.gtag = function gtag(..._args: unknown[]) {
      analyticsWindow.dataLayer?.push(arguments)
    }
  }

  return analyticsWindow.gtag
}

function loadGA4() {
  if (!shouldEnableGA4()) return false
  if (getConsent() !== 'granted') return false

  ;(window as unknown as Record<string, unknown>)[GA_DISABLE_KEY] = false
  const gtag = getGtag()

  if (!document.querySelector(`script[data-lasyncro-ga4="${GA4_ID}"]`)) {
    const script = document.createElement('script')
    script.async = true
    script.dataset.lasyncroGa4 = GA4_ID
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`
    document.head.appendChild(script)

    gtag?.('js', new Date())
    gtag?.('config', GA4_ID, {
      send_page_view: false,
      cookie_domain: 'lasyncro.com',
    })
  }

  return true
}

function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const consent = useConsent()
  const lastPageView = useRef<string | null>(null)

  useEffect(() => {
    if (consent !== 'granted') return
    if (!loadGA4()) return

    const pagePath = search ? `${pathname}?${search}` : pathname
    if (lastPageView.current === pagePath) return
    lastPageView.current = pagePath

    getGtag()?.('event', 'page_view', {
      page_location: window.location.href,
      page_path: search ? `${pathname}?${search}` : pathname,
      page_title: document.title,
    })
  }, [pathname, search, consent])

  return null
}

function ConsentBanner() {
  const consent = useConsent()
  const productionHost = useProductionHost()
  // Reopened from "Cookie preferences" to change or withdraw consent.
  const [reopened, setReopened] = useState(false)
  const firstButton = useRef<HTMLButtonElement | null>(null)
  const visible = productionHost && (consent === null || reopened)

  useEffect(() => {
    const onOpen = () => setReopened(true)

    window.addEventListener(PREFERENCES_EVENT, onOpen)
    return () => window.removeEventListener(PREFERENCES_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (reopened) firstButton.current?.focus()
  }, [reopened])

  if (!visible) return null

  const choose = (value: 'granted' | 'denied') => {
    setConsent(value)
    setReopened(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 99999,
        maxWidth: 720,
        margin: '0 auto',
        padding: 16,
        borderRadius: 12,
        background: '#151D29',
        color: '#F0EEE8',
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
      }}
    >
      <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
        LaSyncro uses analytics tools to understand website usage. It is
        optional and is not loaded unless you allow it.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          ref={firstButton}
          onClick={() => choose('granted')}
        >
          Allow analytics
        </button>
        <button type="button" onClick={() => choose('denied')}>
          Decline analytics
        </button>
      </div>
    </div>
  )
}

/** Footer control for changing or withdrawing analytics consent. */
export function AnalyticsPreferencesButton({
  className,
}: {
  className?: string
}) {
  const available = useProductionHost()

  if (!available) return null

  return (
    <button
      type="button"
      className={className}
      onClick={openAnalyticsPreferences}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      Cookie preferences
    </button>
  )
}

export default function GoogleAnalyticsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      <ConsentBanner />
      {children}
    </>
  )
}
