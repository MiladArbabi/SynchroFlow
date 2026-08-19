'use client'

import { useId, useState } from 'react'
import LaunchNotifyForm, { useShopifyAvailability } from './LaunchNotifyForm'

export default function LaunchNavCTA() {
  const availability = useShopifyAvailability()
  const [open, setOpen] = useState(false)
  const titleId = useId()

  if (availability.available && availability.installUrl) {
    return (
      <a
        href={availability.installUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="nav-cta"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '8px 18px',
          background: '#FF6B2B',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 500,
          borderRadius: '6px',
          textDecoration: 'none',
          transition: 'background 0.15s',
        }}
      >
        Install on Shopify
      </a>
    )
  }

  return (
    <>
      <button
        type="button"
        className="nav-cta"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '8px 18px',
          background: '#FF6B2B',
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: '13px',
          fontWeight: 500,
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
      >
        Notify me at launch
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(11,17,28,0.72)',
            padding: 20,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              width: 'min(100%, 460px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 16,
              background: '#151D29',
              boxShadow: '0 28px 90px rgba(0,0,0,0.42)',
              color: '#F0EEE8',
              padding: 18,
              ['--bg' as string]: '#151D29',
              ['--surface' as string]: '#1C2740',
              ['--ink' as string]: '#F0EEE8',
              ['--ink-2' as string]: '#C8C4BB',
              ['--rule' as string]: 'rgba(255,255,255,0.12)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close launch notification form"
                style={{
                  width: 34,
                  height: 34,
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)',
                  color: '#F0EEE8',
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <div id={titleId} style={{ display: 'none' }}>
              Get notified when LaSyncro launches on Shopify
            </div>
            <LaunchNotifyForm source="launch_nav" compact />
          </div>
        </div>
      ) : null}
    </>
  )
}
