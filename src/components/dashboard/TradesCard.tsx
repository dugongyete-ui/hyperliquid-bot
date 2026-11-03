'use client'

import { Bot } from 'lucide-react'
import type { TradeRow } from '@/lib/shared-types'
import { fmtHeld, fmtPct, fmtPx, fmtSmartUsd, fmtSizeUsd } from '@/lib/format'
import type { FaceVariant } from './BotAvatar'
import { CoinBadge } from './CoinIcon'

interface TradesCardProps {
  trades: TradeRow[]
  wins: number
  losses: number
  onPickCoin: (coin: string) => void
}

const FACE_BY_KEY: Record<string, FaceVariant> = {
  sniper: 'focused',
  momentum: 'happy',
  dipHunter: 'sparkle',
  whaleTail: 'blush',
  scalper: 'smirk',
}

export function TradesCard({ trades, wins, losses, onPickCoin }: TradesCardProps) {
  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[22px] font-black tracking-tight">Trade</h2>
        <p className="text-[13px] font-semibold text-[#8E8E93]">
          {wins} menang · {losses} kalah
        </p>
      </div>

      {trades.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Bot size={34} strokeWidth={1.8} className="text-[#C7C7CC]" aria-hidden />
          <p className="text-[14px] font-bold text-[#8E8E93]">
            Crew sedang memindai pasar…
          </p>
          <p className="text-[12px] font-semibold text-[#B4B4B9]">
            Trade akan muncul di sini begitu ada bot menemukan peluang.
          </p>
        </div>
      ) : (
        <ul className="nice-scroll max-h-[340px] divide-y divide-[#F2F2F4] overflow-y-auto pr-1">
          {trades.map((t) => {
            return (
              <li
                key={t.id}
                onClick={() => onPickCoin(t.coin)}
                className="flex cursor-pointer items-center gap-3 py-2.5 transition hover:bg-black/[0.025] active:scale-[0.99]"
                role="button"
                aria-label={`Buka chart ${t.coin}`}
              >
                <CoinBadge
                  coin={t.coin}
                  size={40}
                  badgeColor={t.botColor}
                  badgeFace={FACE_BY_KEY[t.botKey] ?? 'happy'}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-extrabold leading-tight">${t.coin}</p>
                  <p className="truncate text-[12.5px] font-semibold text-[#8E8E93]">
                    {t.status === 'open' ? (
                      <>
                        {t.botName} beli · {fmtSizeUsd(t.sizeUsd)} · {t.reason}
                      </>
                    ) : (
                      <>
                        {t.botName} · {t.exitReason} · tahan {t.heldSec != null ? fmtHeld(t.heldSec) : '—'}
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  {t.status === 'open' ? (
                    <>
                      <p
                        className={`text-[16px] font-extrabold leading-tight tabular-nums ${
                          t.pnlPct >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {fmtPct(t.pnlPct, Math.abs(t.pnlPct) < 1 ? 2 : 1)}
                      </p>
                      <p className="text-[12.5px] font-semibold text-[#8E8E93] tabular-nums">
                        <span className={t.pnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                          {fmtSmartUsd(t.pnl)}
                        </span>{' '}
                        · entry {fmtPx(t.entryPx)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p
                        className={`text-[16px] font-extrabold leading-tight tabular-nums ${
                          t.pnl > 0.005
                            ? 'text-[#22C55E]'
                            : t.pnl < -0.005
                              ? 'text-[#EF4444]'
                              : 'text-[#8E8E93]'
                        }`}
                      >
                        {fmtSmartUsd(t.pnl)}
                      </p>
                      <p
                        className={`text-[12.5px] font-semibold ${
                          t.pnlPct >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {fmtPct(t.pnlPct, Math.abs(t.pnlPct) < 1 ? 2 : 1)}
                        {t.riskUsd > 0 && (
                          <span className="ml-1 text-[#8E8E93]">
                            · {(t.pnl / t.riskUsd).toFixed(2)}R
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
