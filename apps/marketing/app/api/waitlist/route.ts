// apps/marketing/app/api/waitlist/route.ts
// Thin proxy — forwards waitlist signups to the backend API on Fly.
// The backend owns the DB connection and Resend notification.
// This keeps Postgres off Vercel's network entirely.

import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_API_URL ?? 'https://synchroflow.fly.dev'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!body.email) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 })
    }

    const res = await fetch(`${BACKEND_URL}/api/v1/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error('[waitlist proxy] Backend error:', res.status, data)
      return NextResponse.json({ error: 'Server error' }, { status: 502 })
    }

    return NextResponse.json(data)

  } catch (err) {
    console.error('[waitlist proxy] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}