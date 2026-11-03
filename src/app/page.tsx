'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Settings, ShieldAlert, Pause, Play } from 'lucide-react'
import type { EngineSnapshot, NotificationRow } from '@/lib/shared-types'
import { fmtPct, fmtSignedUsd, fmtUsd } from '@/lib/format'
import { BotAvatar, HeadBotAvatar } from '@/components/dashboard/BotAvatar'
import { Sparkline } from '@/components/dashboard/Sparkline'
import { CrewCard } from '@/components/dashboard/CrewCard'
import { TradesCard } from '@/components/dashboard/TradesCard'
import { ActivityCard } from '@/components/dashboard/ActivityCard'
import { GoalCard } from '@/components/dashboard/GoalCard'
import { IslandPill } from '@/components/dashboard/IslandPill'
import { TickerStrip } from '@/components/dashboard/TickerStrip'
import { Toasts } from '@/components/dashboard/Toasts'
import { ChartModal } from '@/components/dashboard/ChartModal'
import { SettingsModal } from '@/components/dashboard/SettingsModal'

interface Floater {
  id: number
  text: string
}

export default function Home() {
  const [state, setState] = useState<EngineSnapshot | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chartCoin, setChartCoin] = useState<string | null>(null)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [toasts, setToasts] = useState<NotificationRow[]>([])
  const prevEquity = useRef<number | null>(null)
  const floaterId = useRef(0)
  const seenIdsRef = useRef<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      if (!res.ok) return
      const data: EngineSnapshot = await res.json()
      setState(data)

      // floating +$ bubble when equity ticks up
      if (prevEquity.current !== null && data.equity > prevEquity.current + 0.5) {
        const delta = data.equity - prevEquity.current
        const id = ++floaterId.current
        setFloaters((f) => [...f.slice(-2), { id, text: fmtSignedUsd(delta, 0) }])
        setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 2300)
      }
      prevEquity.current = data.equity

      // unseen engine notifications → push-notification style toasts
      const fresh = data.notifications.filter((n) => !seenIdsRef.current.has(n.id))
      if (fresh.length > 0) {
        const ids = fresh.map((n) => n.id)
        for (const id of ids) seenIdsRef.current.add(id)
        setToasts((prev) => [...prev, ...fresh].slice(-3))
        setTimeout(() => {
          setToasts((prev) => prev.filter((x) => !ids.includes(x.id)))
          fetch('/api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'seen', ids }),
          }).catch(() => {})
        }, 6000)
      }
    } catch {
      /* keep last state */
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(refresh, 0)
    const t = setInterval(refresh, 1200)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [refresh])

  const equity = state?.equity ?? 0
  const [eqInt, eqDec] = equity.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).split('.')
  const isLive = state?.mode === 'mainnet' || state?.mode === 'testnet'

  const openChart = useCallback((coin: string) => {
    setChartCoin(coin.includes(':') ? coin : coin.toUpperCase())
  }, [])

  async function quickToggleRun() {
    if (!state) return
    await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: state.running ? 'pause' : 'resume' }),
    })
    refresh()
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#F2F3F5]">
      <IslandPill state={state} />
      <Toasts notifications={toasts} mode={state?.mode ?? 'sim'} />

      <main className="mx-auto w-full max-w-[460px] flex-1 px-4 pb-8 pt-16">
        {/* ---------- header ---------- */}
        <header className="mb-3 flex items-center gap-3">
          <HeadBotAvatar size={54} className="shrink-0 rounded-[16px] shadow-md" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[26px] font-black leading-tight tracking-tight">
              {state?.botName ?? 'Grok Bot'}
            </h1>
            <p className="text-[14px] font-bold text-[#8E8E93]">Hyperliquid perps · 5 agents</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={quickToggleRun}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#17171C] shadow-sm transition hover:scale-105 active:scale-95"
              aria-label={state?.running ? 'Pause crew' : 'Resume crew'}
            >
              {state?.running ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#17171C] shadow-sm transition hover:scale-105 hover:rotate-45 active:scale-95"
              aria-label="Settings"
            >
              <Settings size={17} />
            </button>
            <div className="flex items-center gap-1.5 rounded-full bg-white py-1.5 pl-2.5 pr-3 shadow-sm">
              <span className="relative flex h-2 w-2">
                {state?.feedOk && (
                  <span className="animate-soft-pulse absolute inline-flex h-full w-full rounded-full bg-[#30D158]" />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${state?.feedOk ? 'bg-[#30D158]' : 'bg-[#FF9F0A]'}`}
                />
              </span>
              <span className="text-[13px] font-extrabold">{state?.feedOk ? 'Live' : 'Offline'}</span>
            </div>
          </div>
        </header>

        {/* ---------- live ticker ---------- */}
        <TickerStrip ticker={state?.ticker ?? []} onPick={openChart} />

        {/* ---------- equity block ---------- */}
        <section aria-label="Equity" className="mt-4">
          <div className="mb-0.5 flex items-center gap-2">
            <p className="text-[14px] font-bold text-[#8E8E93]">
              {isLive ? 'Account value' : 'Equity'} · started with{' '}
              {fmtUsd(state?.startingEquity ?? 0, 0)}
            </p>
            {!state?.feedOk && state && (
              <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-[#B45309]">
                <ShieldAlert size={12} /> demo feed
              </span>
            )}
          </div>

          <div className="flex items-start justify-between">
            <div className="relative">
              <p className="text-[58px] font-black leading-[1.05] tracking-tight">
                {state ? (
                  <>
                    ${eqInt}
                    <span className="text-[34px] text-[#8E8E93]">.{eqDec}</span>
                  </>
                ) : (
                  <span className="inline-block h-14 w-56 animate-pulse rounded-2xl bg-black/5" />
                )}
              </p>
              {/* floating profit bubbles */}
              <div className="pointer-events-none absolute left-full top-1 ml-1 flex w-24 flex-col items-start">
                {floaters.map((f) => (
                  <span
                    key={f.id}
                    className="animate-float-up absolute whitespace-nowrap rounded-full bg-[#22C55E] px-2.5 py-1 text-[13px] font-extrabold text-white shadow-md"
                  >
                    {f.text}
                  </span>
                ))}
              </div>
            </div>

            <span className="mt-3 shrink-0 rounded-full bg-gradient-to-r from-[#2DD4BF] to-[#22C55E] px-3 py-1.5 text-[15px] font-black text-white shadow-md">
              {(state?.multiple ?? 1).toFixed(2)}×
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p
                className={`text-[17px] font-extrabold ${
                  (state?.pnl ?? 0) >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                }`}
              >
                {fmtSignedUsd(state?.pnl ?? 0)} ({fmtPct(state?.pnlPct ?? 0, 0)})
              </p>
              {(state?.streak ?? 0) >= 2 && (
                <span className="animate-badge-pop flex items-center gap-1 rounded-full bg-gradient-to-r from-[#FF9F0A] to-[#FF6B00] px-2 py-[3px] text-[12px] font-black text-white shadow-sm">
                  🔥 {state?.streak}
                </span>
              )}
            </div>
            <p className="text-[14px] font-bold text-[#8E8E93]">
              {state?.tradesClosed ?? 0} trades ·{' '}
              {state && state.tradesClosed > 0
                ? Math.round((state.wins / state.tradesClosed) * 100)
                : 0}
              % win
            </p>
          </div>

          <div className="mt-2">
            <Sparkline
              points={state?.equityCurve.map((p) => p.equity) ?? []}
              baseline={state?.startingEquity ?? 0}
            />
          </div>
        </section>

        {/* ---------- cards ---------- */}
        <div className="mt-4 space-y-3">
          <CrewCard
            crew={state?.crew ?? []}
            openCount={state?.openCount ?? 0}
            totalWins={state?.crew.reduce((a, b) => a + b.wins, 0) ?? 0}
            pairsCount={state?.pairsCount ?? 0}
            onPickCoin={openChart}
          />
          <ActivityCard
            trades={state?.trades ?? []}
            wins={state?.wins ?? 0}
            losses={state?.losses ?? 0}
            onPickCoin={openChart}
          />
          <TradesCard
            trades={state?.trades ?? []}
            wins={state?.wins ?? 0}
            losses={state?.losses ?? 0}
            onPickCoin={openChart}
          />
          <GoalCard goal={state?.goal.target ?? 2} multiple={state?.multiple ?? 1} />
        </div>

        {/* network links */}
        <div className="mt-4 flex items-center justify-center gap-2 text-[12px] font-bold text-[#8E8E93]">
          <a
            href="https://app.hyperliquid.xyz"
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white px-3 py-1.5 shadow-sm transition hover:text-[#17171C]"
          >
            Mainnet ↗
          </a>
          <a
            href="https://app.hyperliquid-testnet.xyz"
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white px-3 py-1.5 shadow-sm transition hover:text-[#17171C]"
          >
            Testnet ↗
          </a>
          <span className="flex items-center gap-1">
            <BotAvatar face="happy" color="#2E90FA" size={16} /> powered by Hyperliquid
          </span>
        </div>
      </main>

      {/* ---------- sticky footer ---------- */}
      <footer className="mt-auto border-t border-black/5 bg-white/70 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto w-full max-w-[460px] px-4 py-3.5 text-center">
          <p className="text-[11px] font-bold leading-relaxed text-[#B4B4B9]">
            SIM = paper money, real mainnet prices. TESTNET/MAINNET send real orders —
            exchange minimum <span className="text-[#8E8E93]">$10</span> per order. Use an agent
            wallet with limited funds. Not financial advice. DYOR.
          </p>
        </div>
      </footer>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        state={state}
        onSaved={refresh}
      />
      <ChartModal coin={chartCoin} onOpenChange={(open) => !open && setChartCoin(null)} />
    </div>
  )
}
