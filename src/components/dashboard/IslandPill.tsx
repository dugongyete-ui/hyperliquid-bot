'use client'

import type { EngineSnapshot } from '@/lib/shared-types'
import { fmtMult } from '@/lib/format'

/** Floating Dynamic-Island style pill showing the live equity multiple. */
export function IslandPill({ state }: { state: EngineSnapshot | null }) {
  const mult = state ? Math.max(0, state.multiple) : 1
  const up = mult >= 1
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2.5 z-40 flex justify-center">
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
    </div>
  )
}
