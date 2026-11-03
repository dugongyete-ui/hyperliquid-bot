'use client'

import type { EngineSnapshot } from '@/lib/shared-types'
import { fmtMult } from '@/lib/format'

const MODE_STYLE: Record<string, { bg: string; label: string }> = {
  sim: { bg: '#17171C', label: 'SIM' },
  testnet: { bg: '#22B8CF', label: 'TESTNET' },
  mainnet: { bg: '#FF4D00', label: 'LIVE' },
}

/** Floating Dynamic-Island pill + SIM/LIVE chip and agent count, like the reference UI. */
export function IslandPill({ state }: { state: EngineSnapshot | null }) {
  const mult = state ? Math.max(0, state.multiple) : 1
  const up = mult >= 1
  const mode = MODE_STYLE[state?.mode ?? 'sim'] ?? MODE_STYLE.sim
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2.5 z-40 flex items-start justify-center px-3">
      <div className="relative flex w-full max-w-[430px] items-center justify-between">
        <span
          className="rounded-lg px-2 py-1 text-[11px] font-black tracking-wide text-white shadow-md"
          style={{ background: mode.bg }}
        >
          {mode.label}
        </span>

        <div className="flex items-center gap-2 rounded-full bg-[#17171C] px-4 py-2 shadow-lg">
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-soft-pulse absolute inline-flex h-full w-full rounded-full ${up ? 'bg-[#30D158]' : 'bg-[#FF9F0A]'}`}
            />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${up ? 'bg-[#30D158]' : 'bg-[#FF9F0A]'}`}
            />
          </span>
          <span
            className={`text-[15px] font-extrabold tabular-nums tracking-tight ${up ? 'text-[#30D158]' : 'text-[#FF9F0A]'}`}
          >
            {fmtMult(mult)}
          </span>
        </div>

        <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-black text-[#17171C] shadow-md backdrop-blur">
          {state?.crew.length ?? 5} online
        </span>
      </div>
    </div>
  )
}
