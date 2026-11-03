'use client'

import type { TradeRow } from '@/lib/shared-types'
import { fmtHeld, fmtPct, fmtPx, fmtSignedUsd, fmtSizeUsd } from '@/lib/format'
import { CoinIcon, type FaceVariant } from './BotAvatar'

interface TradesCardProps {
  trades: TradeRow[]
  wins: number
  losses: number
}

const FACE_BY_KEY: Record<string, FaceVariant> = {
  sniper: 'focused',
  momentum: 'happy',
  dipHunter: 'sparkle',
  whaleTail: 'blush',
  scalper: 'smirk',
}

export function TradesCard({ trades, wins, losses }: TradesCardProps) {
  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[22px] font-black tracking-tight">Trades</h2>
        <p className="text-[13px] font-semibold text-[#8E8E93]">
          {wins} wins · {losses} losses
        </p>
      </div>

      {trades.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="text-3xl">🤖</div>
          <p className="text-[14px] font-bold text-[#8E8E93]">
            The crew is scanning the market…
          </p>
          <p className="text-[12px] font-semibold text-[#B4B4B9]">
            Trades will appear here the moment a bot spots something.
          </p>
        </div>
      ) : (
        <ul className="nice-scroll max-h-[340px] divide-y divide-[#F2F2F4] overflow-y-auto pr-1">
          {trades.map((t) => {
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <CoinIcon
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
                        {t.botName} in · {fmtSizeUsd(t.sizeUsd)} · {t.reason}
                      </>
                    ) : (
                      <>
                        {t.botName} · {t.exitReason} · held {t.heldSec != null ? fmtHeld(t.heldSec) : '—'}
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  {t.status === 'open' ? (
                    <>
                      <p
                        className={`text-[16px] font-extrabold leading-tight ${
                          t.pnlPct >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {fmtPct(t.pnlPct)}
                      </p>
                      <p className="text-[12.5px] font-semibold text-[#8E8E93]">open</p>
                    </>
                  ) : (
                    <>
                      <p
                        className={`text-[16px] font-extrabold leading-tight ${
                          t.pnl > 0.5
                            ? 'text-[#22C55E]'
                            : t.pnl < -0.5
                              ? 'text-[#EF4444]'
                              : 'text-[#8E8E93]'
                        }`}
                      >
                        {Math.abs(t.pnl) < 0.5 ? '$0' : fmtSignedUsd(t.pnl, 0)}
                      </p>
                      <p
                        className={`text-[12.5px] font-semibold ${
                          t.pnlPct >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {fmtPct(t.pnlPct)}
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

export function tradePxLabel(t: TradeRow): string {
  return `entry ${fmtPx(t.entryPx)}`
}
