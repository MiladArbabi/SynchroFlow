'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

const GA4_ID = 'G-1H3XLN9MN2'
const CONSENT_COOKIE = 'lasyncro_analytics_consent'
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

  window.dispatchEvent(
    new CustomEvent('lasyncro:analytics-consent', { detail: value })
  )
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
  const [consent, setConsentState] = useState<Consent>(getConsent())

  useEffect(() => {
    const onConsent = () => setConsentState(getConsent())

    window.addEventListener('lasyncro:analytics-consent', onConsent)
    return () =>
      window.removeEventListener('lasyncro:analytics-consent', onConsent)
  }, [])

  useEffect(() => {
    if (consent !== 'granted') return
    if (!loadGA4()) return

    getGtag()?.('event', 'page_view', {
      page_location: window.location.href,
      page_path: search ? `${pathname}?${search}` : pathname,
      page_title: document.title,
    })
  }, [pathname, search, consent])

  return null
}

function ConsentBanner() {
  const [visible, setVisible] = useState(
    shouldEnableGA4() && getConsent() === null
  )

  if (!visible) return null

  const choose = (value: 'granted' | 'denied') => {
    setConsent(value)
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Google Analytics consent"
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
        LaSyncro uses Google Analytics to understand website usage. It is
        optional and is not loaded unless you allow it.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => choose('granted')}>
          Allow Google Analytics
        </button>
        <button type="button" onClick={() => choose('denied')}>
          Decline Google Analytics
        </button>
      </div>
    </div>
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
