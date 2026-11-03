'use client'

import type { CrewBotState } from '@/lib/shared-types'
import { fmtPct, fmtSignedUsd } from '@/lib/format'
import { BotAvatar, type FaceVariant } from './BotAvatar'
import { coinMeta } from '@/lib/coins'

interface CrewCardProps {
  crew: CrewBotState[]
  openCount: number
  totalWins: number
}

const FACE_BY_KEY: Record<string, FaceVariant> = {
  sniper: 'focused',
  momentum: 'happy',
  dipHunter: 'sparkle',
  whaleTail: 'blush',
  scalper: 'smirk',
}

function StatusChip({ bot }: { bot: CrewBotState }) {
  if (bot.status === 'holding' && bot.holding) {
    const meta = coinMeta(bot.holding.coin)
    return (
      <span
        className="rounded-full px-2 py-0.5 text-[11px] font-extrabold"
        style={{ background: meta.color + '22', color: meta.color }}
      >
        ${bot.holding.coin}
      </span>
    )
  }
  if (bot.status === 'cooling') {
    return (
      <span className="rounded-full bg-[#EFEFF1] px-2 py-0.5 text-[11px] font-bold text-[#8E8E93]">
        cooling
      </span>
    )
  }
  if (bot.status === 'paused') {
    return (
      <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-bold text-[#B45309]">
        paused
      </span>
    )
  }
  return (
    <span className="rounded-full bg-[#EFEFF1] px-2 py-0.5 text-[11px] font-bold text-[#8E8E93]">
      scanning
    </span>
  )
}

export function CrewCard({ crew, openCount, totalWins }: CrewCardProps) {
  // latest speaker with a thought gets the speech bubble
  const speakerIdx = crew.reduce(
    (best, bot, i) => (bot.thoughtAt > (best === -1 ? 0 : crew[best].thoughtAt) ? i : best),
    -1
  )
  const speaker = speakerIdx >= 0 ? crew[speakerIdx] : null

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[22px] font-black tracking-tight">Crew</h2>
        <p className="text-[13px] font-semibold text-[#8E8E93]">
          {openCount} holding · {totalWins} wins
        </p>
      </div>

      <div className="relative">
        {/* speech bubble anchored above the speaking bot */}
        {speaker && speaker.thought && (
          <div
            className="absolute -top-2 z-10 w-48 animate-bubble-pop"
            style={{
              left: `clamp(0px, calc(${(speakerIdx + 0.5) * (100 / Math.max(crew.length, 1))}% - 96px), calc(100% - 192px))`,
            }}
          >
            <div className="relative rounded-2xl bg-[#17171C] px-3.5 py-2 text-center shadow-lg">
              <p className="text-[12px] font-bold leading-snug text-white">
                <span className="text-[#4DA3FF]">{speaker.name}</span>{' '}
                <span className="text-white/90">{speaker.thought}</span>
              </p>
              <div className="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-[#17171C]" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-1 pt-8">
          {crew.map((bot) => (
            <div key={bot.key} className="flex flex-col items-center gap-1">
              <div className="relative">
                {/* floating pnl badge */}
                {bot.status === 'holding' && bot.holding && (
                  <div className="animate-badge-pop absolute -top-3 left-1/2 z-[5] -translate-x-1/2 whitespace-nowrap rounded-full bg-[#22C55E] px-2 py-[3px] text-[11px] font-extrabold text-white shadow-md">
                    {fmtPct(bot.holding.pnlPct)}
                  </div>
                )}
                <div className="relative">
                  <BotAvatar
                    face={FACE_BY_KEY[bot.key] ?? 'happy'}
                    color={bot.color}
                    size={62}
                    breathe={bot.status === 'holding'}
                  />
                  {/* soft floor shadow */}
                  <div className="mx-auto mt-1 h-2 w-8 rounded-full bg-black/10 blur-[3px]" />
                </div>
              </div>
              <p className="mt-0.5 text-center text-[13px] font-extrabold leading-tight">{bot.name}</p>
              <p
                className={`text-[13px] font-extrabold ${
                  bot.pnl > 0.5
                    ? 'text-[#22C55E]'
                    : bot.pnl < -0.5
                      ? 'text-[#EF4444]'
                      : 'text-[#8E8E93]'
                }`}
              >
                {Math.abs(bot.pnl) < 0.5 ? '$0' : fmtSignedUsd(bot.pnl, 0)}
              </p>
              <div className="mt-0.5 h-[20px]">
                <StatusChip bot={bot} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
