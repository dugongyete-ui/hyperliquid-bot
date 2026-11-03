import { NextRequest, NextResponse } from 'next/server'
import { getCoinIconUrl } from '@/lib/icons'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const coin = req.nextUrl.searchParams.get('coin')?.trim() ?? ''
  if (!coin) return NextResponse.json({ coin, url: null }, { status: 400 })
  const url = await getCoinIconUrl(coin)
  return NextResponse.json(
    { coin, url },
    { headers: { 'Cache-Control': 'public, max-age=86400' } }
  )
}
