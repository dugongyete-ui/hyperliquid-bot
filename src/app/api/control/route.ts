import { NextResponse } from 'next/server'
import { ensureEngine } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action?: string; ids?: string[] }
    const action = body.action
    if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })
    if (!['pause', 'resume', 'closeAll', 'resetSim', 'resetDailyStop', 'seen'].includes(action)) {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    }
    const engine = ensureEngine()
    await engine.control(action, body.ids)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'control failed' },
      { status: 500 }
    )
  }
}
