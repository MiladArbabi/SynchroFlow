// apps/marketing/app/api/pilot-apply/route.ts
// AUD-1023: STUB endpoint — no backend persistence exists yet for pilot applications
// (confirmed via grep, apps/backend/src has zero "pilot" references as of this commit).
// Validates required fields and logs the full payload to Vercel function logs so nothing
// is silently dropped. Replace the TODO block with a real backend call once
// apps/backend exposes POST /api/v1/pilot-applications — follow the /api/waitlist
// thin-proxy pattern (see apps/marketing/app/api/waitlist/route.ts) when that lands.

import { NextResponse } from 'next/server'

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

    // TODO(AUD-1023): replace with real backend call once pilot-applications
    // persistence exists. Logging full payload now so no submission is lost.
    console.log('[pilot-apply STUB] New pilot application received:', JSON.stringify(body))

    return NextResponse.json({ success: true, stub: true })
  } catch (err) {
    console.error('[pilot-apply STUB] Failed to process submission:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}