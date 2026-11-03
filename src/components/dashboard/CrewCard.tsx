'use client'

import { useState } from 'react'
import { Activity, Crosshair, TrendingDown, Waves, Zap, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import type { CrewBotState } from '@/lib/shared-types'
import { fmtPct, fmtSignedUsd, fmtSizeUsd } from '@/lib/format'
import type { FaceVariant } from './BotAvatar'
import { CoinBadge, CoinIcon } from './CoinIcon'
import { MiniCandles } from './MiniCandles'

interface CrewCardProps {
  crew: CrewBotState[]
  openCount: number
  totalWins: number
  pairsCount: number
  onPickCoin: (coin: string) => void
}

const FACE_BY_KEY: Record<string, FaceVariant> = {
  sniper: 'focused',
  momentum: 'happy',
  dipHunter: 'sparkle',
  whaleTail: 'blush',
  scalper: 'smirk',
}

const GLYPH: Record<string, LucideIcon> = {
  sniper: Crosshair,
  momentum: Zap,
  dipHunter: TrendingDown,
  whaleTail: Waves,
  scalper: Activity,
}

const SUBTITLE: Record<string, string> = {
  sniper: 'fresh breakouts',
  momentum: 'volume breakouts',
  dipHunter: '−30% wicks',
  whaleTail: 'smart wallets',
  scalper: 'spread snipes',
}

/** Small activity ring, like the reference cards' top-right spinner. */
function Ring({ color, status, pct }: { color: string; status: string; pct: number }) {
  const R = 13
  const C = 2 * Math.PI * R
  const frac =
    status === 'holding' ? Math.min(1, Math.max(0.12, Math.abs(pct) / 30)) : status === 'cooling' ? 0.22 : 0.45
  return (
    <svg width="30" height="30" viewBox="0 0 34 34" className="shrink-0" aria-hidden>
      <circle cx="17" cy="17" r={R} fill="none" stroke="#F0F0F2" strokeWidth="4" />
      <circle
        cx="17"
        cy="17"
        r={R}
        fill="none"
        stroke={status === 'cooling' ? '#D8D8DC' : color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${C * frac} ${C}`}
        transform="rotate(-90 17 17)"
        className={status === 'scanning' ? 'animate-soft-pulse' : ''}
      />
    </svg>
  )
}

function AgentCard({ bot, pairsCount, onPickCoin }: { bot: CrewBotState; pairsCount: number; onPickCoin: (coin: string) => void }) {
  const [showThought, setShowThought] = useState(false)
  const Glyph = GLYPH[bot.key] ?? Activity
  const holding = bot.status === 'holding' ? bot.holding : null
  const ringPct = holding?.pnlPct ?? 0

  return (
    <div
      onClick={() => setShowThought((v) => !v)}
      className="relative cursor-pointer rounded-[22px] bg-white p-3.5 shadow-[0_2px_14px_rgba(0,0,0,0.05)] transition hover:shadow-[0_6px_22px_rgba(0,0,0,0.09)] active:scale-[0.985]"
      role="button"
      aria-label={`${bot.name} agent card`}
    >
      {/* thought bubble */}
      <AnimatePresence>
        {showThought && bot.thought && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="absolute -top-2 left-1/2 z-20 w-[92%] -translate-x-1/2"
          >
            <div className="relative rounded-2xl bg-[#17171C] px-3.5 py-2 shadow-xl">
              <p className="text-center text-[11.5px] leading-snug font-bold">
                <span style={{ color: bot.color }}>{bot.name}</span>{' '}
                <span className="text-white/90">{bot.thought}</span>
              </p>
              <div className="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-[#17171C]" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* header */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-white shadow-sm"
          style={{ background: `linear-gradient(135deg, ${bot.color}, ${bot.color}BB)` }}
        >
          <Glyph size={19} strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-black leading-tight tracking-tight">{bot.name}</p>
          <p className="truncate text-[11px] font-semibold text-[#8E8E93]">{SUBTITLE[bot.key] ?? 'scanning'}</p>
        </div>
        <Ring color={bot.color} status={bot.status} pct={ringPct} />
      </div>

      {/* holding row / scanning row */}
      <div className="mt-2.5 flex h-[30px] items-center gap-2">
        {holding ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPickCoin(holding.coin)
              }}
              className="flex items-center gap-1.5 rounded-full px-1 py-0.5 transition hover:bg-black/[0.04] active:scale-95"
              aria-label={`Open ${holding.coin} chart`}
            >
              <CoinIcon coin={holding.coin} size={22} />
              <span className="text-[13.5px] font-extrabold tracking-tight">${holding.coin}</span>
            </button>
            <span className="text-[12px] font-bold text-[#8E8E93]">{fmtSizeUsd(holding.sizeUsd)}</span>
            <span
              className={`ml-auto animate-badge-pop rounded-lg px-2 py-[3px] text-[12px] font-extrabold text-white ${
                holding.pnlPct >= 0 ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
              }`}
            >
              {fmtPct(holding.pnlPct)}
            </span>
          </>
        ) : bot.status === 'cooling' ? (
          <>
            <span className="text-[12.5px] font-bold text-[#8E8E93]">recharging risk budget</span>
            <span className="ml-auto rounded-full bg-[#EFEFF1] px-2.5 py-1 text-[11px] font-extrabold text-[#8E8E93]">
              cooling
            </span>
          </>
        ) : bot.status === 'paused' ? (
          <>
            <span className="text-[12.5px] font-bold text-[#B45309]">crew paused by user</span>
            <span className="ml-auto rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-extrabold text-[#B45309]">
              paused
            </span>
          </>
        ) : (
          <>
            <span className="text-[12.5px] font-bold text-[#8E8E93]">
              Scanning{' '}
              <span className="animate-soft-pulse font-extrabold text-[#17171C]">
                {pairsCount > 0 ? pairsCount : '…'}
              </span>{' '}
              pairs
            </span>
            <span className="ml-auto rounded-full bg-[#EFEFF1] px-2.5 py-1 text-[11px] font-extrabold text-[#8E8E93]">
              idle
            </span>
          </>
        )}
      </div>

      {/* mini chart / skeleton */}
      <div className="mt-1.5">
        {holding ? (
          <MiniCandles coin={holding.coin} entryPx={undefined} height={54} />
        ) : (
          <div className="flex items-end gap-[3px]" style={{ height: 54 }} aria-hidden>
            {Array.from({ length: 20 }).map((_, i) => (
              <span
                key={i}
                className="animate-shimmer w-full rounded-[2px]"
                style={{ height: `${24 + ((i * 43) % 58)}%` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-[12px] font-extrabold text-[#8E8E93]">
          {bot.wins}W · {bot.losses}L
        </p>
        <p
          className={`text-[13.5px] font-extrabold tabular-nums ${
            bot.pnl > 0.5 ? 'text-[#22C55E]' : bot.pnl < -0.5 ? 'text-[#EF4444]' : 'text-[#8E8E93]'
          }`}
        >
          {Math.abs(bot.pnl) < 0.5 ? '$0' : fmtSignedUsd(bot.pnl, 0)}
        </p>
      </div>

      {/* tiny avatar peeking bottom-right when holding (like reference) */}
      {holding && holding.pnlPct >= 0 && (
        <div className="animate-pop-check absolute -top-2 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[#30D158] text-white shadow-md">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 12.5 9.5 18 20 6.5" stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {holding && holding.pnlPct < 0 && (
        <div className="absolute -top-2 -right-1.5">
          <CoinBadge coin={holding.coin} size={26} badgeColor={bot.color} badgeFace={FACE_BY_KEY[bot.key]} />
        </div>
      )}
    </div>
  )
}

export function CrewCard({ crew, openCount, totalWins, pairsCount, onPickCoin }: CrewCardProps) {
  return (
    <section aria-label="Agents">
      <div className="mb-2.5 flex items-baseline justify-between px-1">
        <h2 className="text-[21px] font-black tracking-tight">Agents</h2>
        <p className="text-[13px] font-semibold text-[#8E8E93]">
          {openCount} holding · {totalWins} wins
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {crew.map((bot) => (
          <AgentCard key={bot.key} bot={bot} pairsCount={pairsCount} onPickCoin={onPickCoin} />
        ))}
      </div>
    </section>
  )
}
