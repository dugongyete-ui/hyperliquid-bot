import { NextResponse } from 'next/server'
import { ensureEngine } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

interface Body {
  mode?: string
  botName?: string
  startingEquity?: number
  goalMultiple?: number
  leverage?: number
  positionPct?: number
  riskProfile?: string
  autoExit?: boolean
  tpPct?: number
  slPct?: number
  allowShort?: boolean
  maxRiskPct?: number
  maxTotalRiskPct?: number
  dailyLossStopPct?: number
  privateKey?: string
  walletAddress?: string
  presetReset?: boolean
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
      leverage: body.leverage != null ? Number(body.leverage) : undefined,
      positionPct: body.positionPct != null ? Number(body.positionPct) : undefined,
      riskProfile: body.riskProfile,
      autoExit: body.autoExit != null ? Boolean(body.autoExit) : undefined,
      tpPct: body.tpPct != null ? Number(body.tpPct) : undefined,
      slPct: body.slPct != null ? Number(body.slPct) : undefined,
      allowShort: body.allowShort != null ? Boolean(body.allowShort) : undefined,
      maxRiskPct: body.maxRiskPct != null ? Number(body.maxRiskPct) : undefined,
      maxTotalRiskPct: body.maxTotalRiskPct != null ? Number(body.maxTotalRiskPct) : undefined,
      dailyLossStopPct: body.dailyLossStopPct != null ? Number(body.dailyLossStopPct) : undefined,
      privateKey: body.privateKey,
      walletAddress: body.walletAddress,
      presetReset: Boolean(body.presetReset),
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
