'use client'

import { CoinIcon } from './CoinIcon'
import { fmtPct, fmtPx } from '@/lib/format'
import type { TickerRow } from '@/lib/shared-types'

/** Live marquee of the most-traded Hyperliquid perps — every chip opens a chart. */
export function TickerStrip({
  ticker,
  onPick,
}: {
  ticker: TickerRow[]
  onPick: (coin: string) => void
}) {
  if (ticker.length === 0) {
    return (
      <div className="flex h-[46px] items-center gap-3 overflow-hidden rounded-2xl bg-white px-4 shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="animate-shimmer h-4 w-24 shrink-0 rounded-full" />
        ))}
      </div>
    )
  }

  const row = [...ticker, ...ticker] // seamless loop
  return (
    <div className="ticker-hover overflow-hidden rounded-2xl bg-white shadow-sm" role="marquee">
      <div className="animate-ticker flex w-max items-center">
        {row.map((t, i) => {
          const up = t.changePct >= 0
          return (
            <button
              key={`${t.coin}-${i}`}
              onClick={() => onPick(t.coin)}
              className="flex items-center gap-1.5 px-3 py-2.5 transition active:scale-95 aria-hover:hover:bg-black/[0.03]"
              aria-label={`Open ${t.coin} chart`}
            >
              <CoinIcon coin={t.coin} size={18} />
              <span className="text-[12.5px] font-extrabold tracking-tight">{t.coin}</span>
              <span className="text-[12.5px] font-semibold tabular-nums text-[#8E8E93]">
                {fmtPx(t.px)}
              </span>
              <span
                className={`rounded-md px-1.5 py-[2px] text-[11px] font-extrabold tabular-nums text-white ${
                  up ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
                }`}
              >
                {fmtPct(t.changePct, 1)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
