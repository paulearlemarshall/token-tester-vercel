import { NextResponse } from 'next/server'
import { flattenPricing } from '@/lib/pricing'

export async function GET() {
  return NextResponse.json(flattenPricing())
}
