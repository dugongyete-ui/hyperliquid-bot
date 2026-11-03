'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import { CoinIcon } from './CoinIcon'
import { fmtPct, fmtPx } from '@/lib/format'
import type { ChartCandle, ChartResponse } from '@/app/api/chart/route'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
type Interval = (typeof INTERVALS)[number]

/**
 * Live candlestick chart for any Hyperliquid perp — lightweight-charts,
 * re-polled every 2.5s so the tape flows while the dialog is open.
 */
export function ChartModal({
  coin,
  onOpenChange,
}: {
  coin: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [interval, setInterval_] = useState<Interval>('1m')
  const [candles, setCandles] = useState<ChartCandle[]>([])
  const [meta, setMeta] = useState<{ markPx: number | null; prevDayPx: number | null; count: number }>(
    { markPx: null, prevDayPx: null, count: 0 }
  )
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const onData = useCallback((d: ChartResponse) => {
    setCandles(d.candles)
    setMeta({ markPx: d.markPx, prevDayPx: d.prevDayPx, count: d.candles.length })
    setTick((t) => t + 1)
  }, [])
  const onError = useCallback((e: string | null) => setError(e), [])

  const short = coin?.includes(':') ? coin.split(':')[1] : coin
  const lastC = candles.length > 0 ? candles[candles.length - 1] : null
  const prevC = candles.length > 1 ? candles[candles.length - 2] : lastC
  const dir: 'up' | 'down' | 'flat' =
    lastC && prevC ? (lastC.close > prevC.close ? 'up' : lastC.close < prevC.close ? 'down' : 'flat') : 'flat'
  const changePct =
    meta.markPx && meta.prevDayPx && meta.prevDayPx > 0
      ? (meta.markPx / meta.prevDayPx - 1) * 100
      : null

  return (
    <Dialog open={coin != null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-w-[440px] gap-0 overflow-hidden rounded-[28px] border-none bg-white p-0 shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
      >
        {coin && (
          <div className="flex flex-col">
            {/* header */}
            <div className="flex items-center gap-3 px-5 pt-5">
              <CoinIcon coin={coin} size={40} />
              <div className="min-w-0 flex-1">
                <DialogTitle className="flex items-center gap-2 text-[19px] font-black tracking-tight">
                  {short}
                  <span className="rounded-md bg-[#F2F3F5] px-1.5 py-0.5 text-[10px] font-extrabold text-[#8E8E93]">
                    PERP
                  </span>
                </DialogTitle>
                <p className="text-[12px] font-semibold text-[#8E8E93]">Hyperliquid · mainnet</p>
              </div>
              <div className="text-right">
                <p
                  key={tick}
                  className={`text-[17px] font-black tabular-nums tracking-tight ${
                    dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : ''
                  }`}
                >
                  {lastC ? '$' + fmtPx(lastC.close) : '—'}
                </p>
                {changePct != null && (
                  <span
                    className={`mt-0.5 inline-block rounded-md px-1.5 py-[2px] text-[11px] font-extrabold text-white ${
                      changePct >= 0 ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
                    }`}
                  >
                    {fmtPct(changePct, 2)} 24j
                  </span>
                )}
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F2F3F5] transition hover:scale-105 active:scale-95"
                aria-label="Tutup chart"
              >
                <X size={15} />
              </button>
            </div>

            {/* interval tabs */}
            <div className="mt-3 flex items-center gap-1 px-5">
              {INTERVALS.map((iv) => (
                <button
                  key={iv}
                  onClick={() => setInterval_(iv)}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-extrabold transition ${
                    iv === interval
                      ? 'bg-[#17171C] text-white shadow-sm'
                      : 'bg-[#F2F3F5] text-[#8E8E93] hover:text-[#17171C]'
                  }`}
                >
                  {iv}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-[#8E8E93]">
                <span className="animate-soft-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#30D158]" />
                live
              </span>
            </div>

            {/* chart */}
            <div className="px-3 pt-2">
              <ChartBody coin={coin} interval={interval} onData={onData} onError={onError} />
            </div>

            {/* footer */}
            <div className="flex items-center justify-between px-5 pb-4 pt-2">
              <p className="text-[10.5px] font-semibold leading-tight text-[#B4B4B9]">
                {error
                  ? 'Data tidak tersedia — mencoba lagi…'
                  : 'Sumber: Hyperliquid /info candleSnapshot · UTC · harga live mainnet'}
              </p>
              <p className="shrink-0 pl-2 text-[10.5px] font-bold text-[#B4B4B9]">{meta.count} candle</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChartBody({
  coin,
  interval,
  onData,
  onError,
}: {
  coin: string
  interval: string
  onData: (d: ChartResponse) => void
  onError: (e: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const cbRef = useRef({ onData, onError })
  cbRef.current = { onData, onError }

  // create chart once
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8E8E93',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(0,0,0,0.035)' },
        horzLines: { color: 'rgba(0,0,0,0.035)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22C55E',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#22C55E',
      wickDownColor: '#EF4444',
    })
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // poll — interval only depends on coin/interval; callbacks ride in refs
  useEffect(() => {
    let alive = true
    let first = true

    async function poll() {
      try {
        const res = await fetch(
          `/api/chart?coin=${encodeURIComponent(coin)}&interval=${interval}&limit=90`,
          { cache: 'no-store' }
        )
        if (!res.ok) throw new Error(String(res.status))
        const d = (await res.json()) as ChartResponse & { error?: string }
        if (!alive) return
        if (d.error || !d.candles?.length) throw new Error(d.error ?? 'empty')
        seriesRef.current?.setData(
          d.candles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        )
        if (first) {
          chartRef.current?.timeScale().fitContent()
          first = false
        }
        cbRef.current.onData(d)
        cbRef.current.onError(null)
      } catch (e) {
        if (alive) cbRef.current.onError(e instanceof Error ? e.message : 'unavailable')
      }
    }

    poll()
    const timer = setInterval(poll, 2500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [coin, interval])

  return <div ref={ref} className="h-[300px] w-full" />
}
