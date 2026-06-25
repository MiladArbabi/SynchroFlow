// apps/marketing/app/api/pilot-apply/route.ts
// AUD-1023: Thin proxy — forwards pilot applications to the backend API on Fly.
// The backend owns the DB connection (pilot_applications table) and Resend notification.
// This keeps Postgres off Vercel's network entirely. Mirrors /api/waitlist/route.ts.
import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_API_URL ?? 'https://synchroflow.fly.dev'

const REQUIRED_FIELDS = [
  'name',
  'email',
  'company',
  'storeUrl',
  'country',
  'ordersPerDay',
  'skuCount',
  'fulfillment',
  'biggestIssue',
  'usesStocky',
  'currentTools',
  'openToPaidPilot',
  'contactMethod',
] as const

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const missing = REQUIRED_FIELDS.filter((f) => !body[f] && body[f] !== false)
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing fields: ${missing.join(', ')}` }, { status: 400 })
    }

    const res = await fetch(`${BACKEND_URL}/api/v1/pilot-applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error('[pilot-apply proxy] Backend error:', res.status, data)
      return NextResponse.json({ error: 'Server error' }, { status: 502 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[pilot-apply proxy] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}