import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const installUrl = process.env.SHOPIFY_APP_STORE_URL?.trim() ?? ''
  const available = process.env.SHOPIFY_APP_AVAILABLE === 'true' && installUrl.length > 0

  return NextResponse.json({
    available,
    installUrl: available ? installUrl : null,
  })
}
