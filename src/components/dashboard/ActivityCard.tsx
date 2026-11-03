'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { TrendingDown } from 'lucide-react'
import type { TradeRow } from '@/lib/shared-types'
import { fmtSmartUsd } from '@/lib/format'
import { CoinIcon } from './CoinIcon'
import { BotAvatar } from './BotAvatar'

interface ActivityCardProps {
  trades: TradeRow[]
  wins: number
  losses: number
  onPickCoin: (coin: string) => void
}

interface Event {
  id: string
  ts: number
  botName: string
  botColor: string
  verb: 'beli' | 'jual' | 'short' | 'cover'
  coin: string
  detail: string
  pnl: number | null
  pnlPct: number | null
}

function toEvents(trades: TradeRow[]): Event[] {
  const evs: Event[] = []
  for (const t of trades) {
    if (t.status === 'open') {
      evs.push({
        id: t.id + '-o',
        ts: t.openedAt,
        botName: t.botName,
        botColor: t.botColor,
        // opening a short IS a sell — show it as its own verb so the feed is honest
        verb: t.side === 'short' ? 'short' : 'beli',
        coin: t.coin,
        detail: t.reason,
        pnl: null,
        pnlPct: null,
      })
    }
    if (t.status === 'closed' && t.closedAt) {
      evs.push({
        id: t.id + '-c',
        ts: t.closedAt,
        botName: t.botName,
        botColor: t.botColor,
        // closing a short = buying back; closing a long = selling
        verb: t.side === 'short' ? 'cover' : 'jual',
        coin: t.coin,
        detail: t.exitReason ?? '',
        pnl: t.pnl,
        pnlPct: t.pnlPct,
      })
    }
  }
  return evs.sort((a, b) => b.ts - a.ts).slice(0, 14)
}

function stamp(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `0:${String(s).padStart(2, '0')}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Live floor feed — every buy/sell the crew makes, newest first. */
export function ActivityCard({ trades, wins, losses, onPickCoin }: ActivityCardProps) {
  const events = toEvents(trades)
  return (
    <section
      aria-label="Aktivitas"
      className="rounded-[24px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.05)]"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[21px] font-black tracking-tight">Aktivitas</h2>
        <p className="text-[13px] font-semibold text-[#8E8E93]">
          {wins} menang · {losses} kalah
        </p>
      </div>

      <div className="nice-scroll max-h-[300px] space-y-2.5 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {events.map((ev) => (
            <motion.div
              key={ev.id}
              layout
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="flex items-start gap-2.5"
            >
              <span className="mt-[6px] flex shrink-0 items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: ev.botColor }} />
                <span className="text-[11.5px] font-bold tabular-nums text-[#B4B4B9]">
                  {stamp(ev.ts)}
                </span>
              </span>
              <p className="min-w-0 flex-1 text-[13px] leading-snug font-semibold text-[#8E8E93]">
                <span className="font-extrabold" style={{ color: ev.botColor }}>
                  {ev.botName}
                </span>{' '}
                <span
                  className={`inline-flex items-center gap-0.5 font-extrabold ${
                    ev.verb === 'beli'
                      ? 'text-[#2E90FA]'
                      : ev.verb === 'short'
                        ? 'text-[#EF4444]'
                        : ev.verb === 'cover'
                          ? 'text-[#F97316]'
                          : 'text-[#17171C]'
                  }`}
                >
                  {ev.verb === 'short' && <TrendingDown size={12} strokeWidth={2.8} aria-hidden />}
                  {ev.verb}
                </span>{' '}
                <button
                  onClick={() => onPickCoin(ev.coin)}
                  className="inline-flex translate-y-[3px] items-center gap-1 rounded-full font-extrabold text-[#17171C] transition hover:bg-black/[0.04] active:scale-95"
                >
                  <CoinIcon coin={ev.coin} size={15} />${ev.coin}
                </button>
                {(ev.verb === 'beli' || ev.verb === 'short') && (
                  <span className="text-[#8E8E93]"> · {ev.detail || 'sinyal muncul'}</span>
                )}
                {(ev.verb === 'jual' || ev.verb === 'cover') && ev.pnl != null && (
                  <span className={ev.pnl >= 0 ? 'font-extrabold text-[#22C55E]' : 'font-extrabold text-[#EF4444]'}>
                    {' '}
                    {fmtSmartUsd(ev.pnl)} ({(ev.pnlPct ?? 0).toFixed(1)}%)
                  </span>
                )}
                {(ev.verb === 'jual' || ev.verb === 'cover') && ev.detail && (
                  <span className="text-[#8E8E93]"> · {ev.detail}</span>
                )}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
        {events.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-7">
            <div className="animate-breathe">
              <BotAvatar face="sparkle" color="#C7C7CC" size={44} status="scanning" />
            </div>
            <p className="text-center text-[13px] font-semibold text-[#B4B4B9]">
              Lantai baru saja dibuka — crew sedang mengendus pasar
              <span className="ml-1 inline-flex items-end gap-[2px] pb-[1px]" aria-hidden>
                <span className="scan-dot h-[3px] w-[3px] rounded-full bg-[#B4B4B9]" />
                <span className="scan-dot h-[3px] w-[3px] rounded-full bg-[#B4B4B9]" />
                <span className="scan-dot h-[3px] w-[3px] rounded-full bg-[#B4B4B9]" />
              </span>
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
