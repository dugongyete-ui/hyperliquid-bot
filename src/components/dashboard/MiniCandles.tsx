'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChartCandle } from '@/app/api/chart/route'

interface MiniCandlesProps {
  coin: string
  entryPx?: number // dashed baseline (bot's entry)
  height?: number
  interval?: string
  limit?: number
  pollMs?: number
}

/**
 * Tiny live candlestick chart drawn as SVG — flows while the modal-less
 * card is mounted by re-reading /api/chart every few seconds.
 */
export function MiniCandles({
  coin,
  entryPx,
  height = 56,
  interval = '1m',
  limit = 30,
  pollMs = 8000,
}: MiniCandlesProps) {
  const [candles, setCandles] = useState<ChartCandle[] | null>(null)
  const [failed, setFailed] = useState(false)
  const coinRef = useRef(coin)
  coinRef.current = coin

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null

    async function load() {
      try {
        const res = await fetch(
          `/api/chart?coin=${encodeURIComponent(coinRef.current)}&interval=${interval}&limit=${limit}`,
          { cache: 'no-store' }
        )
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { candles?: ChartCandle[] }
        if (!alive) return
        if (data.candles && data.candles.length > 2) {
          setCandles(data.candles)
          setFailed(false)
        }
      } catch {
        if (alive) setFailed(true)
      }
    }

    load()
    timer = setInterval(load, pollMs)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [interval, limit, pollMs])

  if (!candles) {
    return (
      <div className="flex items-end gap-[3px] px-0.5" style={{ height }} aria-hidden>
        {Array.from({ length: 22 }).map((_, i) => (
          <span
            key={i}
            className="animate-shimmer w-full rounded-[2px]"
            style={{ height: `${28 + ((i * 37) % 55)}%` }}
          />
        ))}
      </div>
    )
  }

  // draw at most `limit` last candles
  const shown = candles.slice(-limit)
  const highs = shown.map((c) => c.high)
  const lows = shown.map((c) => c.low)
  let max = Math.max(...highs)
  let min = Math.min(...lows)
  if (entryPx && isFinite(entryPx) && entryPx > 0) {
    max = Math.max(max, entryPx)
    min = Math.min(min, entryPx)
  }
  const pad = (max - min) * 0.08 || max * 0.001 || 1
  max += pad
  min -= pad
  const W = 100
  const H = 100
  const step = W / shown.length
  const bodyW = Math.max(1.6, step * 0.55)
  const y = (p: number) => ((max - p) / (max - min)) * H

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className="w-full"
      role="img"
      aria-label={`${coin} mini chart`}
    >
      {entryPx && isFinite(entryPx) && entryPx > 0 && (
        <line
          x1="0"
          x2={W}
          y1={y(entryPx)}
          y2={y(entryPx)}
          stroke="#C7C7CC"
          strokeWidth="0.8"
          strokeDasharray="2.4 2.4"
        />
      )}
      {shown.map((c, i) => {
        const up = c.close >= c.open
        const color = up ? '#22C55E' : '#EF4444'
        const cx = i * step + step / 2
        const top = y(Math.max(c.open, c.close))
        const bot = y(Math.min(c.open, c.close))
        return (
          <g key={c.time}>
            <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="0.9" />
            <rect
              x={cx - bodyW / 2}
              y={top}
              width={bodyW}
              height={Math.max(0.8, bot - top)}
              rx={0.6}
              fill={color}
            />
          </g>
        )
      })}
    </svg>
  )
}
