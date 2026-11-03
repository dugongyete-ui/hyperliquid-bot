// Real-time Hyperliquid market data (mainnet prices) with graceful synthetic fallback.
// All SIM trading + signals use these live prices.

const HL_INFO = 'https://api.hyperliquid.xyz/info'

export interface Candle1m {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface BookTop {
  bid: number
  ask: number
  bidSz: number
  askSz: number
}

export const UNIVERSE = [
  'BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'AVAX', 'LINK', 'SUI', 'APT', 'ARB',
  'OP', 'NEAR', 'TIA', 'WIF', 'BONK', 'PEPE', 'TRUMP', 'FARTCOIN', 'HYPE', 'JUP',
]

const HISTORY_MAX = 200

async function infoPost<T>(body: unknown, timeoutMs = 4500): Promise<T> {
  const res = await fetch(HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HL info ${res.status}`)
  return (await res.json()) as T
}

export class MarketData {
  mids = new Map<string, number>()
  history = new Map<string, number[]>()
  candles = new Map<string, Candle1m[]>()
  book = new Map<string, BookTop>()
  feedOk = true
  lastUpdateAt = 0

  private failures = 0
  private tick = 0

  async update() {
    this.tick++
    const now = Date.now()
    try {
      const raw = await infoPost<Record<string, string>>({ type: 'allMids' })
      for (const coin of UNIVERSE) {
        const v = raw[coin]
        if (!v) continue
        const px = parseFloat(v)
        if (!isFinite(px) || px <= 0) continue
        this.mids.set(coin, px)
        const h = this.history.get(coin) ?? []
        h.push(px)
        if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX)
        this.history.set(coin, h)
      }
      this.failures = 0
      this.feedOk = true
      this.lastUpdateAt = now
    } catch {
      this.failures++
      if (this.failures >= 3) {
        this.feedOk = false
        this.syntheticDrift()
      }
    }

    // rotate candles: 5 coins per tick
    const candleStart = (this.tick * 5) % UNIVERSE.length
    for (let i = 0; i < 5; i++) {
      const coin = UNIVERSE[(candleStart + i) % UNIVERSE.length]
      this.refreshCandles(coin).catch(() => {})
    }
    // rotate books: 4 coins per tick
    const bookStart = (this.tick * 4 + 7) % UNIVERSE.length
    for (let i = 0; i < 4; i++) {
      const coin = UNIVERSE[(bookStart + i) % UNIVERSE.length]
      this.refreshBook(coin).catch(() => {})
    }
  }

  private async refreshCandles(coin: string) {
    const endTime = Date.now()
    const startTime = endTime - 90 * 60_000
    const raw = await infoPost<Array<Record<string, string>>>(
      {
        type: 'candleSnapshot',
        req: { coin, interval: '1m', startTime, endTime },
      },
      5000
    )
    const candles: Candle1m[] = raw
      .map((c) => ({
        t: Number(c.t),
        o: parseFloat(c.o),
        h: parseFloat(c.h),
        l: parseFloat(c.l),
        c: parseFloat(c.c),
        v: parseFloat(c.v),
      }))
      .filter((c) => isFinite(c.c) && c.c > 0)
      .sort((a, b) => a.t - b.t)
    if (candles.length > 0) this.candles.set(coin, candles)
  }

  private async refreshBook(coin: string) {
    const raw = await infoPost<{ coin: string; levels: Array<Array<{ px: string; sz: string }>> }>(
      { type: 'l2Book', coin },
      4500
    )
    const bids = raw.levels?.[0] ?? []
    const asks = raw.levels?.[1] ?? []
    if (bids.length === 0 || asks.length === 0) return
    this.book.set(coin, {
      bid: parseFloat(bids[0].px),
      ask: parseFloat(asks[0].px),
      bidSz: parseFloat(bids[0].sz),
      askSz: parseFloat(asks[0].sz),
    })
  }

  /** offline fallback: gentle random walk so the app stays alive without internet */
  private syntheticDrift() {
    for (const [coin, px] of this.mids) {
      const drift = (Math.random() - 0.5) * 0.0016
      const next = Math.max(px * (1 + drift), 0.00000001)
      this.mids.set(coin, next)
      const h = this.history.get(coin) ?? []
      h.push(next)
      if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX)
      this.history.set(coin, h)
    }
  }

  mid(coin: string): number | null {
    return this.mids.get(coin) ?? null
  }

  retPct(coin: string, ticks: number): number | null {
    const h = this.history.get(coin)
    if (!h || h.length < 2) return null
    const a = h[Math.max(0, h.length - 1 - ticks)]
    const b = h[h.length - 1]
    return ((b - a) / a) * 100
  }

  spreadPct(coin: string): number | null {
    const b = this.book.get(coin)
    if (!b) return null
    return ((b.ask - b.bid) / b.ask) * 100
  }

  imbalance(coin: string): number | null {
    const b = this.book.get(coin)
    if (!b || b.askSz <= 0) return null
    return b.bidSz / b.askSz
  }

  closes(coin: string): number[] | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < 20) return null
    return cs.map((c) => c.c)
  }

  rsi14(coin: string): number | null {
    const cs = this.closes(coin)
    if (!cs || cs.length < 20) return null
    let gains = 0
    let losses = 0
    const period = 14
    for (let i = cs.length - period; i < cs.length; i++) {
      const diff = cs[i] - cs[i - 1]
      if (diff >= 0) gains += diff
      else losses -= diff
    }
    if (losses === 0) return 100
    const rs = gains / period / (losses / period)
    return 100 - 100 / (1 + rs)
  }

  /** volume stats over 1m candles */
  volStats(coin: string): { ratio: number; lastVol: number; avgVol: number; bull: boolean } | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < 22) return null
    const closed = cs.slice(0, -1) // exclude the still-forming candle
    const last = closed[closed.length - 1]
    const window = closed.slice(-20)
    const avgVol = window.reduce((a, c) => a + c.v, 0) / window.length
    if (avgVol <= 0) return null
    return {
      ratio: last.v / avgVol,
      lastVol: last.v,
      avgVol,
      bull: last.c > last.o,
    }
  }

  /** buy/sell pressure over the last n closed candles */
  buySellRatio(coin: string, n = 5): number | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < n + 1) return null
    let buy = 0
    let sell = 0
    for (const c of cs.slice(-(n + 1), -1)) {
      if (c.c >= c.o) buy += c.v
      else sell += c.v
    }
    if (sell === 0) return buy > 0 ? 5 : null
    return buy / sell
  }

  highN(coin: string, n = 20): number | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < n + 1) return null
    return Math.max(...cs.slice(-n - 1, -1).map((c) => c.h))
  }

  lowN(coin: string, n = 5): number | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < n) return null
    return Math.min(...cs.slice(-n).map((c) => c.l))
  }
}
