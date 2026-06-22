import { NextResponse } from 'next/server'
import { fetchProviderModels } from '@/lib/provider-api'

export async function POST(request: Request) {
  const params = await request.json()
  const result = await fetchProviderModels(params)
  return NextResponse.json(result)
}
