// Real-time Hyperliquid market data (mainnet prices) with graceful synthetic fallback.
// All SIM trading + signals use these live prices.
//
// FULL UNIVERSE: the tradable set is downloaded live from `metaAndAssetCtxs`
// (every active perp on Hyperliquid, delisted ones skipped) instead of a
// hardcoded list. Mids for the whole universe arrive in one `allMids` call;
// 1m candles + L2 books rotate through it with priority for held coins and
// the most-traded pairs.

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
  /** cumulative USD depth of bids within 5/10/25 bps of mid */
  bidDepth5: number
  bidDepth10: number
  bidDepth25: number
  /** cumulative USD depth of asks within 5/10/25 bps of mid */
  askDepth5: number
  askDepth10: number
  askDepth25: number
}

/** bootstrap list — only used until the first meta download lands */
const BOOTSTRAP = [
  'BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'AVAX', 'LINK', 'SUI', 'APT', 'ARB',
  'OP', 'NEAR', 'TIA', 'WIF', 'BONK', 'PEPE', 'TRUMP', 'FARTCOIN', 'HYPE', 'JUP',
]

/** hard liquidity gate: coins below this 24h volume are dead markets — never traded */
export const MIN_VOL_24H_USD = 500_000

export interface TickerRow {
  coin: string
  px: number
  changePct: number
}

const HISTORY_MAX = 200
const CANDLES_PER_TICK = 7
const BOOKS_PER_TICK = 5

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
  pairsCount = 0 // active perps in the live universe
  ticker: TickerRow[] = []

  /** live universe (active perps only), refreshed from the exchange */
  universe: string[] = [...BOOTSTRAP]
  /** 24h notional volume per coin (from asset ctxs) */
  private vol24h = new Map<string, number>()
  /** exchange max leverage per coin */
  private maxLev = new Map<string, number>()
  /** hourly funding rate per coin (fraction, e.g. 0.0001 = 0.01%/hour) */
  private funding = new Map<string, number>()
  /** open interest history (coin units), one sample per meta refresh (~45s) */
  private oiHistory = new Map<string, number[]>()
  /** coins the engine wants fresh data for right now (open positions) */
  private priority = new Set<string>()

  private failures = 0
  private tick = 0
  private lastMetaAt = 0
  private candleCursor = 0
  private bookCursor = 0

  /** engine calls this every tick with the coins it currently holds */
  setPriority(coins: string[]) {
    this.priority = new Set(coins.filter((c) => this.mids.has(c) || this.universe.includes(c)))
  }

  async update() {
    this.tick++
    const now = Date.now()
    if (now - this.lastMetaAt > 45_000) {
      this.lastMetaAt = now
      this.refreshMeta().catch(() => {})
    }
    try {
      const raw = await infoPost<Record<string, string>>({ type: 'allMids' })
      for (const coin of this.universe) {
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

    this.rotateCandles()
    this.rotateBooks()
  }

  /** fresh 1m candles: open positions every tick, then round-robin by volume rank */
  private rotateCandles() {
    const wanted = new Set(this.priority)
    const ranked = this.rankByVolume().filter((c) => !this.priority.has(c))
    if (ranked.length > 0) {
      for (let i = 0; i < CANDLES_PER_TICK; i++) {
        wanted.add(ranked[(this.candleCursor + i) % ranked.length])
      }
      this.candleCursor = (this.candleCursor + CANDLES_PER_TICK) % ranked.length
    }
    for (const coin of wanted) {
      if (this.mids.has(coin)) this.refreshCandles(coin).catch(() => {})
    }
  }

  /** fresh L2 book top: same scheme, its own slower cursor */
  private rotateBooks() {
    const wanted = new Set(this.priority)
    const ranked = this.rankByVolume().filter((c) => !this.priority.has(c))
    if (ranked.length > 0) {
      for (let i = 0; i < BOOKS_PER_TICK; i++) {
        wanted.add(ranked[(this.bookCursor + i) % ranked.length])
      }
      this.bookCursor = (this.bookCursor + BOOKS_PER_TICK) % ranked.length
    }
    for (const coin of wanted) {
      if (this.mids.has(coin)) this.refreshBook(coin).catch(() => {})
    }
  }

  /** active universe sorted by 24h volume desc (most tradable first) */
  private rankByVolume(): string[] {
    if (this.vol24h.size === 0) return this.universe
    return [...this.universe].sort(
      (a, b) => (this.vol24h.get(b) ?? 0) - (this.vol24h.get(a) ?? 0)
    )
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
    const bidPx = parseFloat(bids[0].px)
    const askPx = parseFloat(asks[0].px)
    const bidSz = parseFloat(bids[0].sz)
    const askSz = parseFloat(asks[0].sz)
    if (!(bidPx > 0) || !(askPx > 0)) return
    const mid = (bidPx + askPx) / 2
    // cumulative USD depth within 5/10/25 bps of mid — far more robust than
    // top-of-book sizes, which a single spoofed level-1 order can fake
    const bidBand = [5, 10, 25].map((b) => mid * (1 - b / 10_000))
    const askBand = [5, 10, 25].map((b) => mid * (1 + b / 10_000))
    let bidDepth5 = 0, bidDepth10 = 0, bidDepth25 = 0
    for (const lvl of bids) {
      const px = parseFloat(lvl.px)
      if (!(px >= bidBand[2])) break // bids sorted desc — below the widest band, stop
      const ntl = px * parseFloat(lvl.sz)
      if (px >= bidBand[0]) bidDepth5 += ntl
      if (px >= bidBand[1]) bidDepth10 += ntl
      bidDepth25 += ntl
    }
    let askDepth5 = 0, askDepth10 = 0, askDepth25 = 0
    for (const lvl of asks) {
      const px = parseFloat(lvl.px)
      if (!(px <= askBand[2])) break // asks sorted asc — above the widest band, stop
      const ntl = px * parseFloat(lvl.sz)
      if (px <= askBand[0]) askDepth5 += ntl
      if (px <= askBand[1]) askDepth10 += ntl
      askDepth25 += ntl
    }
    this.book.set(coin, {
      bid: bidPx,
      ask: askPx,
      bidSz,
      askSz,
      bidDepth5,
      bidDepth10,
      bidDepth25,
      askDepth5,
      askDepth10,
      askDepth25,
    })
  }

  /**
   * Download the FULL perp universe: names, delisted flag, max leverage,
   * 24h volume, mark/prev-day prices. Delisted markets are excluded —
   * they can no longer be traded.
   */
  private async refreshMeta() {
    const raw = await infoPost<[unknown, Array<Record<string, string>>]>({
      type: 'metaAndAssetCtxs',
    })
    const meta = raw[0] as {
      universe?: Array<{ name?: string; isDelisted?: boolean; maxLeverage?: number }>
    }
    const universe = meta.universe ?? []
    const ctxs = raw[1] ?? []
    const rows: Array<TickerRow & { vlm: number }> = []
    const nextUniverse: string[] = []
    for (let i = 0; i < Math.min(universe.length, ctxs.length); i++) {
      const u = universe[i]
      const ctx = ctxs[i]
      const name = u?.name
      if (!name || u?.isDelisted || !ctx) continue
      const px = parseFloat(ctx.markPx)
      const prev = parseFloat(ctx.prevDayPx)
      const vlm = parseFloat(ctx.dayNtlVlm)
      if (!isFinite(px) || px <= 0) continue
      nextUniverse.push(name)
      this.vol24h.set(name, isFinite(vlm) ? vlm : 0)
      this.maxLev.set(name, u?.maxLeverage ?? 20)
      // funding + open interest ride along for FREE — same response we already
      // download every 45s, we just never parsed these fields before
      const funding = parseFloat(ctx.funding)
      if (isFinite(funding)) this.funding.set(name, funding)
      const oi = parseFloat(ctx.openInterest)
      if (isFinite(oi) && oi >= 0) {
        const h = this.oiHistory.get(name) ?? []
        h.push(oi)
        if (h.length > 6) h.splice(0, h.length - 6)
        this.oiHistory.set(name, h)
      }
      if (isFinite(prev) && prev > 0 && isFinite(vlm)) {
        rows.push({ coin: name, px, changePct: (px / prev - 1) * 100, vlm })
      }
    }
    if (nextUniverse.length > 0) {
      this.universe = nextUniverse
      this.pairsCount = nextUniverse.length
      // drop mids of coins that left the universe
      for (const coin of [...this.mids.keys()]) {
        if (!this.universe.includes(coin)) {
          this.mids.delete(coin)
          this.history.delete(coin)
        }
      }
    }
    rows.sort((a, b) => b.vlm - a.vlm)
    this.ticker = rows.slice(0, 24).map(({ coin, px, changePct }) => ({ coin, px, changePct }))
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

  /** all coins with a live mid (the whole active universe after first meta) */
  allCoins(): string[] {
    return [...this.mids.keys()]
  }

  /** coins liquid enough to trade (24h volume gate) */
  liquidCoins(minVolUsd: number = MIN_VOL_24H_USD): string[] {
    if (this.vol24h.size === 0) return this.allCoins()
    return this.allCoins().filter((c) => (this.vol24h.get(c) ?? 0) >= minVolUsd)
  }

  volumeUsd24h(coin: string): number {
    return this.vol24h.get(coin) ?? 0
  }

  maxLeverageOf(coin: string): number {
    return this.maxLev.get(coin) ?? 20
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

  /**
   * bid/ask USD depth ratio within `bps` of mid — >1 means bids dominate.
   * Robust against spoofing (sums many levels), unlike top-of-book sizes.
   */
  depthImbalance(coin: string, bps: 5 | 10 | 25 = 25): number | null {
    const b = this.book.get(coin)
    if (!b) return null
    const bid = bps === 5 ? b.bidDepth5 : bps === 10 ? b.bidDepth10 : b.bidDepth25
    const ask = bps === 5 ? b.askDepth5 : bps === 10 ? b.askDepth10 : b.askDepth25
    if (!isFinite(bid) || !isFinite(ask)) {
      // stale entry from before this upgrade — degrade to top-of-book sizes
      if (b.askSz > 0) return Math.min(10, Math.max(0.1, b.bidSz / b.askSz))
      return null
    }
    if (bid <= 0 && ask <= 0) return null
    if (ask <= 0) return 10 // one-sided book, capped
    return Math.min(10, Math.max(0.1, bid / ask))
  }

  /** hourly funding rate as percent (e.g. −0.012 = −0.012%/hour) */
  fundingPctHourly(coin: string): number | null {
    const f = this.funding.get(coin)
    return f == null ? null : f * 100
  }

  /** open interest in USD (coin units × mark) */
  oiUsd(coin: string): number | null {
    const h = this.oiHistory.get(coin)
    const oi = h?.[h.length - 1]
    const px = this.mids.get(coin)
    if (oi == null || px == null) return null
    return oi * px
  }

  /**
   * OI % change over the last ~n meta samples (n×~45s). Rising OI = fresh
   * money entering and fueling the move; falling OI = the move is just
   * positions closing — much weaker confirmation.
   */
  oiChangePct(coin: string, n = 4): number | null {
    const h = this.oiHistory.get(coin)
    if (!h || h.length < 3) return null
    const a = h[Math.max(0, h.length - 1 - n)]
    const b = h[h.length - 1]
    if (!a) return null
    return ((b - a) / a) * 100
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

  /**
   * ATR as a percentage of price over 1m candles — the "how far does this
   * coin actually move" number. Exit targets derive from it so a take-profit
   * on BTC (calm) is not the same distance as one on FARTCOIN (wild).
   */
  atrPct(coin: string, period = 14): number | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < period + 1) return null
    const win = cs.slice(-(period + 1), -1)
    let sum = 0
    for (let i = 1; i < win.length; i++) {
      const tr = Math.max(
        win[i].h - win[i].l,
        Math.abs(win[i].h - win[i - 1].c),
        Math.abs(win[i].l - win[i - 1].c)
      )
      sum += tr / win[i].c
    }
    const atr = (sum / (win.length - 1)) * 100
    return isFinite(atr) && atr > 0 ? atr : null
  }

  /** simple EMA over a series */
  private emaSeries(vals: number[], len: number): number[] {
    const k = 2 / (len + 1)
    const out: number[] = []
    let prev = vals[0]
    for (let i = 0; i < vals.length; i++) {
      prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k)
      out.push(prev)
    }
    return out
  }

  /**
   * Higher-timeframe trend: 1m candles bucketed into `tfMin`-minute closes,
   * EMA(len) on top. This is the entry brain's bias gate — a breakout long is
   * only allowed WITH the 5-minute trend, never against it.
   *   above  → price above the 5m EMA (uptrend intact)
   *   rising → the EMA itself is sloping up (momentum, not just a bounce)
   */
  htfTrend(
    coin: string,
    tfMin = 5,
    len = 12
  ): { ema: number; above: boolean; rising: boolean } | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < (len + 2) * tfMin) return null
    const buckets = new Map<number, { sum: number; n: number }>()
    for (const c of cs) {
      const b = Math.floor(c.t / (tfMin * 60_000))
      const cur = buckets.get(b) ?? { sum: 0, n: 0 }
      cur.sum += c.c
      cur.n++
      buckets.set(b, cur)
    }
    const keys = [...buckets.keys()].sort((a, b) => a - b)
    if (keys.length < len + 2) return null
    const closes = keys.map((k) => buckets.get(k)!.sum / buckets.get(k)!.n)
    const ema = this.emaSeries(closes, len)
    const last = ema[ema.length - 1]
    const prev = ema[ema.length - 2]
    const px = closes[closes.length - 1]
    return { ema: last, above: px >= last, rising: last >= prev }
  }

  /** return over the last n minutes from 1m candles (candle-based, not tick-based) */
  retPctCandles(coin: string, nMin: number): number | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < nMin + 2) return null
    const a = cs[cs.length - 1 - nMin]
    const b = cs[cs.length - 1]
    if (!a || a.c <= 0) return null
    return ((b.c - a.c) / a.c) * 100
  }

  /**
   * Market regime via Kaufman Efficiency Ratio over the last n 1m closes:
   *   ER = |net move| / Σ|every 1m move|   ∈ [0..1]
   * ER high  → price travels efficiently in ONE direction → TRENDING
   * ER low   → choppy back-and-forth                     → RANGING
   * The adaptive exit engine widens take-profits in trends (let winners run)
   * and tightens them in ranges (grab profit before it mean-reverts).
   */
  regime(coin: string, n = 30): { kind: 'trending' | 'ranging'; er: number; up: boolean } | null {
    const cs = this.candles.get(coin)
    if (!cs || cs.length < n + 1) return null
    const closes = cs.slice(-(n + 1)).map((c) => c.c)
    const net = Math.abs(closes[closes.length - 1] - closes[0])
    let path = 0
    for (let i = 1; i < closes.length; i++) path += Math.abs(closes[i] - closes[i - 1])
    if (path <= 0) return null
    const er = net / path
    return {
      kind: er >= 0.3 ? 'trending' : 'ranging',
      er,
      up: closes[closes.length - 1] >= closes[0],
    }
  }
}
