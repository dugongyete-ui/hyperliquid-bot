// Public read-only chart data: Hyperliquid candleSnapshot + live mid.
// Small server-side cache so several clients polling never flood the exchange.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const HL_INFO = 'https://api.hyperliquid.xyz/info'
const INTERVALS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
}

interface CacheRow {
  at: number
  data: ChartResponse
}
const g = globalThis as unknown as {
  __chartCache?: Map<string, CacheRow>
  __chartMetaCache?: { at: number; universe: string[]; prev: number[]; mark: number[] } | null
}
if (!g.__chartCache) g.__chartCache = new Map()
const cache = g.__chartCache
if (g.__chartMetaCache === undefined) g.__chartMetaCache = null
const metaCache = g.__chartMetaCache

export interface ChartCandle {
  time: number // UTC seconds
  open: number
  high: number
  low: number
  close: number
}

export interface ChartResponse {
  coin: string
  interval: string
  candles: ChartCandle[]
  prevDayPx: number | null
  markPx: number | null
  fetchedAt: number
}

async function infoPost<T>(body: unknown, timeoutMs = 8000): Promise<T> {
  const res = await fetch(HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HL info ${res.status}`)
  return (await res.json()) as T
}

export async function GET(req: NextRequest) {
  const coin = req.nextUrl.searchParams.get('coin')?.trim() ?? ''
  const interval = req.nextUrl.searchParams.get('interval') ?? '1m'
  const limit = Math.min(240, Math.max(30, Number(req.nextUrl.searchParams.get('limit')) || 90))

  if (!coin || !/^[A-Za-z0-9@_-]+(?::[A-Za-z0-9@_-]+)?$/.test(coin)) {
    return NextResponse.json({ error: 'invalid coin' }, { status: 400 })
  }
  if (!(interval in INTERVALS)) {
    return NextResponse.json({ error: 'invalid interval' }, { status: 400 })
  }

  const key = `${coin}:${interval}:${limit}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 1500) {
    return NextResponse.json(hit.data)
  }

  try {
    const step = INTERVALS[interval]
    const endTime = Date.now()
    const startTime = endTime - limit * step
    const raw = await infoPost<Array<Record<string, string>>>({
      type: 'candleSnapshot',
      req: { coin, interval, startTime, endTime },
    })
    const candles: ChartCandle[] = raw
      .map((c) => ({
        time: Math.floor(Number(c.t) / 1000),
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
      }))
      .filter((c) => isFinite(c.close) && c.close > 0 && isFinite(c.time))
      .sort((a, b) => a.time - b.time)
      .slice(-limit)

    let prevDayPx: number | null = null
    let markPx: number | null = null
    try {
      let meta = metaCache
      if (!meta || Date.now() - meta.at > 10_000) {
        const raw = await infoPost<[unknown, Array<Record<string, string>>]>({
          type: 'metaAndAssetCtxs',
        })
        const universe = ((raw[0] as { universe?: Array<{ name?: string }> }).universe ?? []).map(
          (u) => u.name ?? ''
        )
        const prev = (raw[1] ?? []).map((c) => parseFloat(c.prevDayPx) || 0)
        const mark = (raw[1] ?? []).map((c) => parseFloat(c.markPx) || 0)
        meta = { at: Date.now(), universe, prev, mark }
        g.__chartMetaCache = meta
      }
      const idx = meta.universe.indexOf(coin)
      if (idx >= 0) {
        prevDayPx = meta.prev[idx] || null
        markPx = meta.mark[idx] || null
      }
    } catch {
      /* optional enrichment */
    }

    const data: ChartResponse = { coin, interval, candles, prevDayPx, markPx, fetchedAt: Date.now() }
    cache.set(key, { at: Date.now(), data })
    if (cache.size > 300) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) cache.delete(oldest[0])
    }
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'chart unavailable' },
      { status: 502 }
    )
  }
}
