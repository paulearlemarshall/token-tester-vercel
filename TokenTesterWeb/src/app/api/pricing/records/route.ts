import { NextResponse } from 'next/server'
import { getPricingRecords } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getPricingRecords())
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 503 })
  }
}
