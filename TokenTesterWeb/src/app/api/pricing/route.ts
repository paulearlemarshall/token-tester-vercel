import { NextResponse } from 'next/server'
import { getPricing, upsertModelPrice } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getPricing())
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 503 })
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json()
    const result = await upsertModelPrice(payload)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}
