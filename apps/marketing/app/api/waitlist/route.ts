// app/api/waitlist/route.ts
// Waitlist form handler — receives POST from landing page and checklist forms.
// Sends notification email via Resend to contact@lasyncro.com.

import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { email, store } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured')
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LaSyncro Waitlist <waitlist@lasyncro.com>',
        to: ['contact@lasyncro.com'],
        subject: `New waitlist signup — ${store || 'no store provided'}`,
        html: `
          <h2>New LaSyncro waitlist signup</h2>
          <table cellpadding="8" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Email</td>
              <td style="font-weight:500;color:#0F0E0D;">${email}</td>
            </tr>
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Store URL</td>
              <td style="font-weight:500;color:#0F0E0D;">${store || '—'}</td>
            </tr>
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Submitted</td>
              <td style="color:#0F0E0D;">${new Date().toUTCString()}</td>
            </tr>
          </table>
          <p style="margin-top:24px;font-size:13px;color:#9CA3AF;">
            Sent from lasyncro.com waitlist/checklist form
          </p>
        `,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Resend error:', error)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('Waitlist route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}