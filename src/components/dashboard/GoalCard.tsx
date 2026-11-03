'use client'

import { Check } from 'lucide-react'
import { fmtMult } from '@/lib/format'
import { BotAvatar } from './BotAvatar'

interface GoalCardProps {
  goal: number
  multiple: number
}

const MILESTONES = [1.25, 1.5, 2, 3, 4, 5]
const SCALE_MAX = 5

export function GoalCard({ goal, multiple }: GoalCardProps) {
  const done = multiple >= goal
  const posOf = (m: number) => ((m - 1) / (SCALE_MAX - 1)) * 100
  const nowPos = Math.min(97, Math.max(3, ((Math.min(multiple, SCALE_MAX) - 1) / (SCALE_MAX - 1)) * 100))

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-[22px] font-black tracking-tight">Goal: {goal}×</h2>
        <p className="text-[14px] font-bold">
          {done ? (
            <span className="flex items-center gap-1 text-[#FF6B00]">
              <Check size={15} strokeWidth={3.2} aria-hidden /> Done
            </span>
          ) : (
            <span className="text-[#8E8E93]">
              {fmtMult(Math.max(0, goal - multiple))} to go
            </span>
          )}
          <span className="text-[#8E8E93]"> · {fmtMult(multiple)} now</span>
        </p>
      </div>

      <div className="relative pb-12 pt-4">
        {/* current multiple pill — the crew mascot rides along as you progress */}
        <div
          className="absolute top-0 z-10 -translate-x-1/2 transition-all duration-700 ease-out"
          style={{ left: `${nowPos}%` }}
        >
          <span
            key={fmtMult(multiple)}
            className="animate-badge-pop flex items-center gap-1.5 rounded-full bg-[#17171C] py-1 pr-2.5 pl-1 text-[12px] font-extrabold text-white shadow"
          >
            <BotAvatar face={done ? 'happy' : 'smirk'} color="#3A3A42" size={18} />
            {fmtMult(multiple)}
          </span>
        </div>

        {/* track */}
        <div className="relative h-2.5 rounded-full bg-[#E9E9EC]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#2DD4BF] to-[#22C55E] transition-all duration-700 ease-out"
            style={{ width: `${nowPos}%` }}
          />
          {MILESTONES.map((m, idx) => {
            const reached = multiple >= m
            const isGoal = m === goal
            return (
              <div
                key={m}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-colors duration-500"
                style={{ left: `${posOf(m)}%` }}
              >
                <div
                  className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-[3px] bg-white shadow-sm transition-transform duration-300 hover:scale-125 ${
                    isGoal && !reached
                      ? 'border-[#FF6B00]'
                      : reached
                        ? 'border-[#22C55E]'
                        : 'border-[#D6D6DB]'
                  }`}
                >
                  {reached && <div key={`m${m}`} className="animate-pop-check h-[7px] w-[7px] rounded-full bg-[#22C55E]" />}
                </div>
                <p
                  className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-extrabold ${
                    idx % 2 === 1 ? 'top-[46px]' : 'top-7'
                  } ${isGoal ? 'text-[#FF6B00]' : reached ? 'text-[#22C55E]' : 'text-[#8E8E93]'}`}
                >
                  {m}×
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
