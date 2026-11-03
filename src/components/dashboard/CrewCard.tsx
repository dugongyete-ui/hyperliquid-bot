'use client'

import { useEffect, useRef, useState } from 'react'
import type { CrewBotState } from '@/lib/shared-types'
import { fmtPct, fmtSmartUsd } from '@/lib/format'
import type { FaceVariant } from './BotAvatar'
import { BotAvatar } from './BotAvatar'
import { CoinIcon } from './CoinIcon'

interface CrewCardProps {
  crew: CrewBotState[]
  openCount: number
  totalWins: number
  onPickCoin: (coin: string) => void
}

const FACE_BY_KEY: Record<string, FaceVariant> = {
  sniper: 'focused',
  momentum: 'happy',
  dipHunter: 'sparkle',
  whaleTail: 'blush',
  scalper: 'smirk',
}

function AgentCard({
  bot,
  align,
  onPickCoin,
}: {
  bot: CrewBotState
  align: 'left' | 'center' | 'right'
  onPickCoin: (coin: string) => void
}) {
  const [showThought, setShowThought] = useState(false)
  const [wiggle, setWiggle] = useState(0)
  const holding = bot.status === 'holding' ? bot.holding : null
  const face = FACE_BY_KEY[bot.key] ?? 'happy'
  const pinned = showThought && !!bot.thought
  // chatter engine: when the bot thinks something NEW the bubble pops for a
  // few seconds (pure CSS .auto-bubble). The mount thought stays silent so
  // five bots don't all greet at once — speech only follows real thinking.
  const [spoken, setSpoken] = useState<string | null>(null)
  const seen = useRef(bot.thought)
  useEffect(() => {
    if (seen.current === bot.thought) return
    seen.current = bot.thought
    const t = setTimeout(() => setSpoken(bot.thought), 10)
    return () => clearTimeout(t)
  }, [bot.thought])

  const bubblePos =
    align === 'left'
      ? 'left-0 -translate-x-1'
      : align === 'right'
        ? 'right-0 translate-x-1'
        : 'left-1/2 -translate-x-1/2'

  return (
    <div
      className="group relative flex min-w-0 flex-1 cursor-pointer flex-col items-center transition-transform duration-300 hover:-translate-y-0.5"
      onClick={() => {
        setShowThought((v) => !v)
        setWiggle((w) => w + 1)
      }}
      role="button"
      aria-label={`${bot.name} agent`}
    >
      {/* thought bubble — every new thought replays the CSS “speak” animation
          (pop in, linger, fade out), so the crew chats by itself. Tap to pin. */}
      <div
        key={pinned ? 'pinned' : spoken === bot.thought ? bot.thought : 'idle'}
        className={`absolute -top-7 z-30 w-44 ${bubblePos} ${
          pinned
            ? 'animate-bubble-pop'
            : spoken === bot.thought && bot.thought
              ? 'auto-bubble'
              : 'invisible'
        }`}
      >
        <div className="relative rounded-2xl bg-[#17171C] px-3 py-2 shadow-xl">
          <p className="text-center text-[11px] leading-snug font-bold">
            <span style={{ color: bot.color }}>{bot.name}</span>{' '}
            <span className="text-white/90">{bot.thought}</span>
          </p>
          <div
            className={`absolute -bottom-[5px] h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[#17171C] ${
              align === 'left' ? 'left-5' : align === 'right' ? 'right-5' : 'left-1/2 -translate-x-1/2'
            }`}
          />
        </div>
      </div>

      {/* live pnl badge floating above the head while holding (like the reference) */}
      <div className="flex h-[24px] items-end justify-center pb-0.5">
        {holding && (
          <span
            key={holding.pnlPct.toFixed(2)}
            className={`animate-badge-pop rounded-full px-2 py-[3px] text-[11px] font-black text-white shadow-sm ${
              holding.pnlPct >= 0 ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
            }`}
          >
            {fmtPct(holding.pnlPct, Math.abs(holding.pnlPct) < 1 ? 2 : 1)}
          </span>
        )}
      </div>

      {/* the cute robot itself — blinks, looks around, hops when winning,
          wiggles when tapped */}
      <div key={wiggle} className={wiggle > 0 ? 'animate-wiggle' : undefined}>
        <BotAvatar
          face={face}
          color={bot.color}
          size={66}
          breathe
          status={bot.status}
          pnlPct={holding?.pnlPct ?? 0}
        />
      </div>

      <p className="mt-1.5 max-w-full truncate px-0.5 text-[10.5px] font-black tracking-tight sm:text-[11px]">
        {bot.name}
      </p>

      {/* live P&L (realized + open position) — pulsing dot marks an open trade */}
      <p
        className={`flex items-center gap-1 text-[12px] font-extrabold tabular-nums ${
          bot.pnl > 0.005 ? 'text-[#22C55E]' : bot.pnl < -0.005 ? 'text-[#EF4444]' : 'text-[#8E8E93]'
        }`}
      >
        {holding && (
          <span className="animate-soft-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#30D158]" />
        )}
        {fmtSmartUsd(bot.pnl)}
      </p>

      {/* status chip: the held coin (original logo) / scanning / cooling / paused */}
      <div className="mt-1 flex h-[22px] items-center">
        {holding ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPickCoin(holding.coin)
            }}
            className="flex max-w-full items-center gap-1 overflow-hidden rounded-full bg-[#F2F3F5] py-[3px] pr-2 pl-[4px] transition hover:bg-black/[0.06] active:scale-95"
            aria-label={`Open ${holding.coin} chart`}
          >
            <CoinIcon coin={holding.coin} size={14} className="shrink-0" />
            <span className="truncate text-[10.5px] font-extrabold tracking-tight">
              ${holding.coin}
            </span>
          </button>
        ) : bot.status === 'cooling' ? (
          <span className="rounded-full bg-[#F2F3F5] px-2 py-[3px] text-[10.5px] font-extrabold text-[#8E8E93]">
            cooling
          </span>
        ) : bot.status === 'paused' ? (
          <span className="rounded-full bg-[#FEF3C7] px-2 py-[3px] text-[10.5px] font-extrabold text-[#B45309]">
            paused
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-[#F2F3F5] px-2 py-[3px] text-[10.5px] font-extrabold text-[#8E8E93]">
            scanning
            <span className="flex items-end gap-[2px] pb-[1px]" aria-hidden>
              <span className="scan-dot h-[3px] w-[3px] rounded-full bg-[#8E8E93]" />
              <span className="scan-dot h-[3px] w-[3px] rounded-full bg-[#8E8E93]" />
              <span className="scan-dot h-[3px] w-[3px] rounded-full bg-[#8E8E93]" />
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

/** The crew card: five cute animated robots in a row, exactly like the reference. */
export function CrewCard({ crew, openCount, totalWins, onPickCoin }: CrewCardProps) {
  return (
    <section
      aria-label="Crew"
      className="rounded-[28px] bg-white p-4 pt-3.5 pb-4 shadow-[0_2px_16px_rgba(0,0,0,0.05)]"
    >
      <div className="mb-1 flex items-baseline justify-between px-1">
        <h2 className="text-[21px] font-black tracking-tight">Crew</h2>
        <p className="text-[13px] font-semibold text-[#8E8E93]">
          {openCount} holding · {totalWins} wins
        </p>
      </div>
      <div className="flex items-start justify-between gap-0.5">
        {crew.map((bot, i) => (
          <AgentCard
            key={bot.key}
            bot={bot}
            align={i === 0 ? 'left' : i === crew.length - 1 ? 'right' : 'center'}
            onPickCoin={onPickCoin}
          />
        ))}
      </div>
    </section>
  )
}
