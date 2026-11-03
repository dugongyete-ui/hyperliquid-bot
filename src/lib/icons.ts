// Resolve ORIGINAL coin logos (CoinGecko) with a three-layer cache:
// memory → sqlite (CoinIcon table) → live CoinGecko search API.
// A small fetch queue keeps us far below CoinGecko's public rate limits.

import { db } from '@/lib/db'

const CG_SEARCH = 'https://api.coingecko.com/api/v3/search'

type IconEntry = { url: string | null; ts: number }
const NEG_TTL = 6 * 3600_000 // re-try failed lookups every 6h
const memory = new Map<string, IconEntry>()

// global serial queue with spacing so parallel requests never burst CoinGecko
const g = globalThis as unknown as {
  __coinIconQueue?: { chain: Promise<void>; lastAt: number }
}
if (!g.__coinIconQueue) g.__coinIconQueue = { chain: Promise.resolve(), lastAt: 0 }
const queue = g.__coinIconQueue

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const gap = Date.now() - queue.lastAt
    if (gap < 400) await sleep(400 - gap)
    try {
      return await fn()
    } finally {
      queue.lastAt = Date.now()
    }
  }
  const next = queue.chain.then(run, run)
  queue.chain = next.then(() => undefined, () => undefined)
  return next
}

interface CgCoin {
  id: string
  name: string
  symbol: string
  large?: string
  thumb?: string
}

async function cgSearch(symbol: string): Promise<string | null> {
  const url = `${CG_SEARCH}?query=${encodeURIComponent(symbol)}`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      })
      if (res.status === 429) {
        await sleep(2500)
        continue
      }
      if (!res.ok) return null
      const data = (await res.json()) as { coins?: CgCoin[] }
      const coins = data.coins ?? []
      const sym = symbol.toLowerCase()
      // prefer an exact symbol match that isn't a wrapped/derived asset
      const bad = /wrapped|bridged|staked|restaked|peg|tokenized|\bproxy\b/i
      const pick =
        coins.find((c) => c.symbol.toLowerCase() === sym && !bad.test(c.name)) ??
        coins.find((c) => c.symbol.toLowerCase() === sym) ??
        null
      return pick?.large ?? pick?.thumb ?? null
    } catch {
      return null
    }
  }
  return null
}

/** Original logo URL for a coin symbol, or null when unavailable. */
export async function getCoinIconUrl(coin: string): Promise<string | null> {
  const symbol = coin.includes(':') ? coin.split(':')[1] : coin
  if (!/^[A-Za-z0-9_-]{1,12}$/.test(symbol)) return null

  const mem = memory.get(symbol)
  if (mem && (mem.url !== null || Date.now() - mem.ts < NEG_TTL)) return mem.url

  try {
    const row = await db.coinIcon.findUnique({ where: { symbol } })
    if (row && (row.url !== null || Date.now() - row.updatedAt.getTime() < NEG_TTL)) {
      memory.set(symbol, { url: row.url, ts: Date.now() })
      return row.url
    }
  } catch {
    /* db unavailable — fall through to live lookup */
  }

  const url = await enqueue(() => cgSearch(symbol))
  memory.set(symbol, { url, ts: Date.now() })
  db.coinIcon
    .upsert({ where: { symbol }, create: { symbol, url }, update: { url } })
    .catch(() => {})
  return url
}
