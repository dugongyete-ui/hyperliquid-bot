'use client'

import { useEffect, useState } from 'react'
import { coinMeta } from '@/lib/coins'
import { BotAvatar, type FaceVariant } from './BotAvatar'

// session-wide cache: coin → resolved original logo URL (null = unavailable)
const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()
const listeners = new Set<() => void>()

function lookup(coin: string): Promise<string | null> {
  if (cache.has(coin)) return Promise.resolve(cache.get(coin) ?? null)
  const inFlight = pending.get(coin)
  if (inFlight) return inFlight
  const p = fetch(`/api/coin-icon?coin=${encodeURIComponent(coin)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { url?: string | null } | null) => {
      const url = d?.url ?? null
      cache.set(coin, url)
      pending.delete(coin)
      listeners.forEach((l) => l())
      return url
    })
    .catch(() => {
      cache.set(coin, null)
      pending.delete(coin)
      return null
    })
  pending.set(coin, p)
  return p
}

function useCoinIcon(coin: string): string | null {
  const [url, setUrl] = useState<string | null>(() => cache.get(coin) ?? null)
  useEffect(() => {
    let alive = true
    const update = () => {
      if (alive && cache.has(coin)) setUrl(cache.get(coin) ?? null)
    }
    listeners.add(update)
    if (cache.has(coin)) {
      // cached: flush outside the effect body (async → no cascading render)
      Promise.resolve().then(update)
    } else {
      void lookup(coin) // resolves later and notifies listeners
    }
    return () => {
      alive = false
      listeners.delete(update)
    }
  }, [coin])
  return url
}

interface CoinIconProps {
  coin: string
  size?: number
  className?: string
}

/** Original coin logo (CoinGecko) with a cute gradient monogram fallback. */
export function CoinIcon({ coin, size = 28, className }: CoinIconProps) {
  const url = useCoinIcon(coin)
  const short = coin.includes(':') ? coin.split(':')[1] : coin
  if (url) {
    return (
      <img
        src={url}
        alt={short}
        width={size}
        height={size}
        loading="lazy"
        className={`shrink-0 rounded-full bg-white object-contain ${className ?? ''}`}
        style={{ width: size, height: size }}
      />
    )
  }
  const meta = coinMeta(short)
  const bg = meta.bg
    ? `linear-gradient(135deg, ${meta.color}, ${meta.bg})`
    : `linear-gradient(135deg, ${meta.color}, ${meta.color}CC)`
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full shadow-sm ${className ?? ''}`}
      style={{ width: size, height: size, background: bg }}
      role="img"
      aria-label={short}
    >
      <span
        className="leading-none font-extrabold text-white"
        style={{ fontSize: size * 0.42 }}
      >
        {meta.label}
      </span>
    </div>
  )
}

/** Coin icon with an optional mini bot avatar badge (like the reference UI). */
export function CoinBadge({
  coin,
  size = 40,
  badgeColor,
  badgeFace,
}: {
  coin: string
  size?: number
  badgeColor?: string
  badgeFace?: FaceVariant
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <CoinIcon coin={coin} size={size} />
      {badgeColor && badgeFace && (
        <div className="absolute -bottom-1 -left-1 rounded-full bg-white p-[2px] shadow-md">
          <BotAvatar face={badgeFace} color={badgeColor} size={Math.max(16, size * 0.44)} />
        </div>
      )}
    </div>
  )
}
