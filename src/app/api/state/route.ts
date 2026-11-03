import { NextResponse } from 'next/server'
import { ensureEngine } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const engine = ensureEngine()
  return NextResponse.json(engine.snapshot(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
