'use client'

import type { NotificationRow } from '@/lib/shared-types'
import { timeAgo } from '@/lib/format'
import { BotAvatar, HeadBotAvatar, type FaceVariant } from './BotAvatar'

interface ToastsProps {
  notifications: NotificationRow[]
  mode: string
}

const FACE_BY_KEY: Record<string, FaceVariant> = {
  sniper: 'focused',
  momentum: 'happy',
  dipHunter: 'sparkle',
  whaleTail: 'blush',
  scalper: 'smirk',
}

const BOT_COLOR: Record<string, string> = {
  sniper: '#F7931A',
  momentum: '#2E90FA',
  dipHunter: '#22B8CF',
  whaleTail: '#B453FF',
  scalper: '#7048E8',
}

/** Push-notification style cards, like the screenshot's "Goal reached" toast. */
export function Toasts({ notifications, mode }: ToastsProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-2 px-3">
      {notifications.slice(0, 3).map((n) => {
        const color = n.botKey ? BOT_COLOR[n.botKey] : '#17171C'
        const face = (n.botKey && FACE_BY_KEY[n.botKey]) || undefined
        return (
          <div
            key={n.id}
            className="animate-toast-in w-full max-w-[440px] overflow-hidden rounded-[24px] bg-white/95 shadow-[0_10px_40px_rgba(0,0,0,0.16)] backdrop-blur"
            role="status"
          >
            <div className="flex items-center gap-3 p-4">
              {face ? (
                <div className="rounded-2xl p-1" style={{ background: color + '1A' }}>
                  <BotAvatar face={face} color={color} size={38} />
                </div>
              ) : (
                <HeadBotAvatar size={46} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#8E8E93]">
                  Grok Bot · {mode.toUpperCase()} · {timeAgo(n.createdAt)}
                </p>
                <p className="truncate text-[15px] font-extrabold leading-snug">{n.title}</p>
                <p className="truncate text-[13px] font-semibold text-[#8E8E93]">{n.body}</p>
              </div>
              {n.bigValue && (
                <p className="shrink-0 text-[26px] font-black text-[#22C55E]">{n.bigValue}</p>
              )}
            </div>
            <div className="h-1.5 w-full bg-[#EFEFF1]">
              <div
                className="h-full rounded-r-full bg-gradient-to-r from-[#2DD4BF] to-[#22C55E]"
                style={{ width: '72%' }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
