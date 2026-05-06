// app/api/waitlist/route.ts
// Waitlist form handler — receives POST from landing page and checklist forms.
// SOURCE OF TRUTH: writes to waitlist_signups table first.
// SECONDARY: sends notification email via Resend. Email failure is non-blocking.
// SECURITY: all user input is HTML-escaped before email interpolation (XSS prevention).

import { NextResponse } from 'next/server'
import { Pool } from 'pg'

/** Escapes HTML special characters in user-supplied strings before email interpolation. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Pool is module-scoped — reused across warm lambda invocations.
// Reads standard PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
const pool = new Pool()

export async function POST(request: Request) {
  try {
    const { email, store, source } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 })
    }

    // --- 1. PERSIST (source of truth) ---
    // ON CONFLICT: silently ignore duplicate emails — user may retry after a failed fetch.
    try {
      await pool.query(
        `INSERT INTO waitlist_signups (email, store_url, source)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [email, store ?? null, source ?? 'landing_page']
      )
    } catch (dbErr) {
      console.error('Waitlist DB insert error:', dbErr)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    // --- 2. NOTIFY via Resend (non-blocking — email is secondary) ---
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      // Email not configured — signup is already saved, log and continue.
      console.warn('RESEND_API_KEY not configured — signup saved but notification skipped')
      return NextResponse.json({ success: true })
    }

    const safeEmail = escapeHtml(String(email))
    const safeStore = store ? escapeHtml(String(store)) : null

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LaSyncro Waitlist <waitlist@lasyncro.com>',
        to: ['contact@lasyncro.com'],
        subject: `New waitlist signup — ${safeStore ?? 'no store provided'}`,
        html: `
          <h2>New LaSyncro waitlist signup</h2>
          <table cellpadding="8" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Email</td>
              <td style="font-weight:500;color:#0F0E0D;">${safeEmail}</td>
            </tr>
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Store URL</td>
              <td style="font-weight:500;color:#0F0E0D;">${safeStore ?? '—'}</td>
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

    if (!resendRes.ok) {
      // Signup already saved — log email failure but return success to client.
      const err = await resendRes.text()
      console.error('Resend notification error (signup already persisted):', err)
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('Waitlist route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}