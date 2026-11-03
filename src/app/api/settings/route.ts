import { NextResponse } from 'next/server'
import { ensureEngine } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

interface Body {
  mode?: string
  botName?: string
  startingEquity?: number
  goalMultiple?: number
  privateKey?: string
  walletAddress?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body
    const engine = ensureEngine()
    const result = await engine.applySettings({
      mode: (body.mode ?? 'sim') as 'sim' | 'testnet' | 'mainnet',
      botName: body.botName ?? 'Grok Bot',
      startingEquity: Number(body.startingEquity) || 1000,
      goalMultiple: Number(body.goalMultiple) || 2,
      privateKey: body.privateKey,
      walletAddress: body.walletAddress,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Gagal menyimpan pengaturan' },
      { status: 500 }
    )
  }
}
