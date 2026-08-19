'use client'

import { FormEvent, useEffect, useState } from 'react'

interface ShopifyAvailability {
  available: boolean
  installUrl: string | null
}

interface LaunchNotifyFormProps {
  source: string
  compact?: boolean
}

type FormStatus = 'idle' | 'loading' | 'success' | 'error'

export function useShopifyAvailability(): ShopifyAvailability {
  const [availability, setAvailability] = useState<ShopifyAvailability>({
    available: false,
    installUrl: null,
  })

  useEffect(() => {
    let active = true

    async function loadAvailability() {
      try {
        const response = await fetch('/api/shopify-availability', { cache: 'no-store' })
        if (!response.ok) return

        const data = await response.json() as Partial<ShopifyAvailability>
        if (!active) return

        setAvailability({
          available: data.available === true && typeof data.installUrl === 'string' && data.installUrl.length > 0,
          installUrl: typeof data.installUrl === 'string' && data.installUrl.length > 0 ? data.installUrl : null,
        })
      } catch {
        if (active) {
          setAvailability({ available: false, installUrl: null })
        }
      }
    }

    loadAvailability()

    return () => {
      active = false
    }
  }, [])

  return availability
}

export default function LaunchNotifyForm({ source, compact = false }: LaunchNotifyFormProps) {
  const availability = useShopifyAvailability()
  const [email, setEmail] = useState('')
  const [store, setStore] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email || status === 'loading') return

    setStatus('loading')

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          store: store.trim() || undefined,
          source,
        }),
      })

      setStatus(response.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (availability.available && availability.installUrl) {
    return (
      <a
        href={availability.installUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: compact ? 6 : 8,
          background: '#FF6B2B',
          color: '#FFFFFF',
          fontFamily: 'var(--sans, "Plus Jakarta Sans", system-ui, sans-serif)',
          fontSize: compact ? 13 : 14,
          fontWeight: 500,
          padding: compact ? '10px 16px' : '13px 22px',
          textDecoration: 'none',
        }}
      >
        Install on Shopify
      </a>
    )
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        style={{
          border: '1px solid rgba(255,107,43,0.25)',
          borderRadius: compact ? 8 : 14,
          background: 'rgba(255,107,43,0.12)',
          color: 'var(--ink, #0F0E0D)',
          fontFamily: 'var(--sans, "Plus Jakarta Sans", system-ui, sans-serif)',
          fontSize: compact ? 13 : 15,
          fontWeight: 400,
          lineHeight: 1.55,
          padding: compact ? '14px 16px' : '22px 24px',
        }}
      >
        You&apos;re on the list. We&apos;ll email you when LaSyncro is available.
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        width: '100%',
        border: '1px solid var(--rule, #E8E6E0)',
        borderRadius: compact ? 10 : 16,
        background: 'var(--surface, #FFFFFF)',
        padding: compact ? 18 : 28,
        boxShadow: compact ? 'none' : '0 20px 60px rgba(15, 14, 13, 0.06)',
      }}
    >
      <div style={{ marginBottom: compact ? 14 : 18 }}>
        <h2
          style={{
            color: 'var(--ink, #0F0E0D)',
            fontFamily: 'var(--sans, "Plus Jakarta Sans", system-ui, sans-serif)',
            fontSize: compact ? 20 : 26,
            fontWeight: 500,
            letterSpacing: 'var(--ls-tight, -0.02em)',
            lineHeight: 1.2,
            margin: '0 0 8px',
          }}
        >
          Get notified when LaSyncro launches on Shopify
        </h2>
        <p
          style={{
            color: 'var(--ink-2, #3A3835)',
            fontFamily: 'var(--sans, "Plus Jakarta Sans", system-ui, sans-serif)',
            fontSize: compact ? 13 : 15,
            fontWeight: 300,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Leave your email and we&apos;ll let you know as soon as sign-up is available.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 10,
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          disabled={status === 'loading'}
          style={inputStyle}
        />
        <input
          type="url"
          value={store}
          onChange={(event) => setStore(event.target.value)}
          placeholder="Shopify store URL"
          disabled={status === 'loading'}
          style={inputStyle}
        />
      </div>

      <button
        type="submit"
        disabled={status === 'loading'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: compact ? '100%' : 'auto',
          border: 'none',
          borderRadius: 8,
          background: '#FF6B2B',
          color: '#FFFFFF',
          cursor: status === 'loading' ? 'wait' : 'pointer',
          fontFamily: 'var(--sans, "Plus Jakarta Sans", system-ui, sans-serif)',
          fontSize: 14,
          fontWeight: 500,
          marginTop: 12,
          opacity: status === 'loading' ? 0.72 : 1,
          padding: '12px 20px',
        }}
      >
        {status === 'loading' ? 'Submitting...' : 'Notify me at launch'}
      </button>

      {status === 'error' ? (
        <p
          role="alert"
          style={{
            color: '#FF6B2B',
            fontFamily: 'var(--sans, "Plus Jakarta Sans", system-ui, sans-serif)',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.5,
            margin: '10px 0 0',
          }}
        >
          Something went wrong. Please try again.
        </p>
      ) : null}
    </form>
  )
}

const inputStyle = {
  width: '100%',
  border: '1px solid var(--rule, #E8E6E0)',
  borderRadius: 8,
  background: 'var(--bg, #FAFAF8)',
  color: 'var(--ink, #0F0E0D)',
  fontFamily: 'var(--sans, "Plus Jakarta Sans", system-ui, sans-serif)',
  fontSize: 14,
  fontWeight: 300,
  lineHeight: 1.4,
  outline: 'none',
  padding: '12px 14px',
} as const
