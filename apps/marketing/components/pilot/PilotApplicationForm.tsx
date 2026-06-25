// apps/marketing/components/pilot/PilotApplicationForm.tsx
// AUD-1023: 13-field application form, submits to the stub /api/pilot-apply route.
'use client'

import { useState } from 'react'

const fieldStyle = {
  width: '100%',
  padding: '12px 14px',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  fontSize: 14,
  color: '#0F0E0D',
  border: '1px solid #E8E6E0',
  borderRadius: 8,
  background: '#fff',
  marginBottom: 16,
} as const

const labelStyle = {
  fontFamily: "'DM Sans', system-ui, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  color: '#3A3835',
  display: 'block',
  marginBottom: 6,
} as const

type FormState = {
  name: string
  email: string
  company: string
  storeUrl: string
  country: string
  ordersPerDay: string
  skuCount: string
  fulfillment: string
  biggestIssue: string
  usesStocky: string
  currentTools: string
  openToPaidPilot: string
  contactMethod: string
}

const initialState: FormState = {
  name: '', email: '', company: '', storeUrl: '', country: '',
  ordersPerDay: '', skuCount: '', fulfillment: '', biggestIssue: '',
  usesStocky: '', currentTools: '', openToPaidPilot: '', contactMethod: '',
}

export default function PilotApplicationForm() {
  const [form, setForm] = useState<FormState>(initialState)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'loading') return
    setStatus('loading')
    try {
      const res = await fetch('/api/pilot-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div style={{ padding: 40, background: '#FFF5F0', borderRadius: 16, border: '1px solid #FFD4BC', textAlign: 'center' }}>
        <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 22, color: '#0F0E0D', margin: '0 0 8px' }}>
          Application received
        </p>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, color: '#6B7280', margin: 0 }}>
          We review every application by hand. We will reach out within a few business days.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 600 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input style={fieldStyle} required value={form.name} onChange={(e) => update('name', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Work email</label>
          <input style={fieldStyle} type="email" required value={form.email} onChange={(e) => update('email', e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Company / store name</label>
          <input style={fieldStyle} required value={form.company} onChange={(e) => update('company', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Shopify store URL</label>
          <input style={fieldStyle} required value={form.storeUrl} onChange={(e) => update('storeUrl', e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Country</label>
          <input style={fieldStyle} required value={form.country} onChange={(e) => update('country', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Approximate orders per day</label>
          <input style={fieldStyle} required value={form.ordersPerDay} onChange={(e) => update('ordersPerDay', e.target.value)} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Number of SKUs / variants</label>
        <input style={fieldStyle} required value={form.skuCount} onChange={(e) => update('skuCount', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Do you fulfill in-house, through a 3PL, or both?</label>
        <select style={fieldStyle} required value={form.fulfillment} onChange={(e) => update('fulfillment', e.target.value)}>
          <option value="">Select one</option>
          <option value="in-house">In-house</option>
          <option value="3pl">3PL</option>
          <option value="both">Both</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>What is your biggest warehouse/inventory issue?</label>
        <textarea style={{ ...fieldStyle, minHeight: 80 }} required value={form.biggestIssue} onChange={(e) => update('biggestIssue', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Are you currently using Stocky?</label>
        <select style={fieldStyle} required value={form.usesStocky} onChange={(e) => update('usesStocky', e.target.value)}>
          <option value="">Select one</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>What tools do you use today?</label>
        <input style={fieldStyle} required value={form.currentTools} onChange={(e) => update('currentTools', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Are you open to a paid pilot?</label>
        <select style={fieldStyle} required value={form.openToPaidPilot} onChange={(e) => update('openToPaidPilot', e.target.value)}>
          <option value="">Select one</option>
          <option value="yes">Yes</option>
          <option value="depends">Depends on scope</option>
          <option value="no">No</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Preferred contact method</label>
        <select style={fieldStyle} required value={form.contactMethod} onChange={(e) => update('contactMethod', e.target.value)}>
          <option value="">Select one</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
        </select>
      </div>

      {status === 'error' && (
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: '#D85A30', marginBottom: 16 }}>
          Something went wrong. Please try again or email contact@lasyncro.com.
        </p>
      )}

      <button type="submit" disabled={status === 'loading'} style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500, color: '#fff', background: '#FF6B2B', border: 'none', borderRadius: 8, padding: '14px 32px', cursor: 'pointer', opacity: status === 'loading' ? 0.6 : 1 }}>
        {status === 'loading' ? 'Submitting…' : 'Apply for pilot access'}
      </button>
    </form>
  )
}