import { MarketData, MIN_VOL_24H_USD } from './market'
import type { CrewDef } from './crew'

export type TradeSide = 'long' | 'short'

export interface Signal {
  coin: string
  side: TradeSide
  reason: string
}

/**
 * Entry signals — each bot scans the ENTIRE live Hyperliquid perp universe
 * (downloaded from the exchange, delisted markets excluded) instead of a
 * hardcoded watchlist. Every strategy applies its own liquidity floor so the
 * crew only trades markets deep enough to enter/exit cleanly:
 *
 *   momentum   ≥ $5M  24h vol   · breakout of the 2-minute leaders
 *   sniper     ≥ $5M  24h vol   · range-high breaks with a tight spread
 *   dipHunter  ≥ $10M 24h vol   · RSI dips on majors only (mean reversion)
 *   whaleTail  ≥ $1M  24h vol   · whale volume prints, small caps allowed
 *   scalper    ≥ $5M  24h vol   · micro structure, needs a tight book
 *
 * DIRECTION: every trigger exists in both directions — the same momentum that
 * longs the strongest riser can short the strongest faller (with sell
 * pressure), sniper longs range-high breaks AND shorts range-low breakdowns,
 * whaleTail follows whale buys AND whale sells, scalper trades stacked bids
 * AND stacked asks. dipHunter longs oversold dips and shorts overbought rips.
 * The entry brain (brain.ts) still vetoes everything that fights the
 * higher-timeframe trend on EITHER side.
 *
 * `bored` relaxes thresholds so an idle bot eventually finds something
 * (keeps the crew lively) — but never the liquidity floor itself.
 */
const FLOORS = {
  momentum: 5_000_000,
  sniper: 5_000_000,
  dipHunter: 10_000_000,
  whaleTail: 1_000_000,
  scalper: 5_000_000,
} as const

export function evaluateSignal(
  def: CrewDef,
  market: MarketData
): Signal | null {
  // The old boredom relax (relax = 0.6 after 90s idle) is removed — it eased
  // the trigger thresholds and produced zero-edge churn (60% of all closed
  // trades were flat "habis waktu" fills). Agents now fire only at
  // full-strength triggers.
  const relax = 1
  switch (def.key) {
    case 'momentum':
      return momentumSignal(market, relax)
    case 'sniper':
      return sniperSignal(market, relax)
    case 'dipHunter':
      return dipHunterSignal(market, relax)
    case 'whaleTail':
      return whaleTailSignal(market, relax)
    case 'scalper':
      return scalperSignal(market, relax)
  }
}

function momentumSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; ret: number; ratio: number }> = []
  for (const coin of market.liquidCoins(FLOORS.momentum)) {
    const ret = market.retPct(coin, 48) // ~2 minutes of ticks
    const ratio = market.buySellRatio(coin, 5)
    if (ret == null || ratio == null) continue
    scored.push({ coin, ret, ratio })
  }
  scored.sort((a, b) => b.ret - a.ret)

  // LONG: ride the strongest FRESH riser with buyers in control — never chase
  // a coin that already mooned (+3.2%/30m, that's someone else's exit)
  const up = scored.find(
    (s) => s.ret > 0.45 * relax && s.ratio > 1.4 && (market.retPctCandles(s.coin, 30) ?? 0) <= 3.2
  )
  if (up) return { coin: up.coin, side: 'long', reason: `pembeli ${up.ratio.toFixed(1)}× penjual` }

  // SHORT: the strongest FRESH faller with sellers in control (mirror logic)
  const down = [...scored]
    .sort((a, b) => a.ret - b.ret)
    .find(
      (s) =>
        s.ret < -0.45 * relax &&
        s.ratio < 1 / 1.4 &&
        (market.retPctCandles(s.coin, 30) ?? 0) >= -3.2
    )
  if (down) {
    // ratio = buy/sell — 0 means ALL volume is selling (strongest possible
    // sell pressure): bound the display instead of dividing by zero
    const sellRatio = down.ratio > 0 ? Math.min(99, 1 / down.ratio) : 99
    return { coin: down.coin, side: 'short', reason: `penjual ${sellRatio.toFixed(1)}× pembeli` }
  }
  return null
}

function sniperSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; mid: number; high: number; low: number | null; spread: number | null }> = []
  for (const coin of market.liquidCoins(FLOORS.sniper)) {
    const mid = market.mid(coin)
    const high = market.highN(coin, 20)
    const low = market.lowN(coin, 20)
    if (mid == null || high == null) continue
    scored.push({ coin, mid, high, low, spread: market.spreadPct(coin) })
  }
  // prefer the strongest breakout (distance above the range high)
  scored.sort((a, b) => b.mid / b.high - a.mid / a.high)
  for (const s of scored) {
    const spreadOk = s.spread == null || s.spread < 0.09
    if (s.mid > s.high * (1 + 0.0002 * relax) && spreadOk) {
      return { coin: s.coin, side: 'long', reason: 'tembus high range 20m' }
    }
  }
  // SHORT: breakdown below the 20m range low (mirror)
  const withLow = scored.filter((s) => s.low != null && s.low > 0)
  withLow.sort((a, b) => a.mid / (a.low ?? 1) - b.mid / (b.low ?? 1))
  for (const s of withLow) {
    const spreadOk = s.spread == null || s.spread < 0.09
    if (s.mid < (s.low ?? 0) * (1 - 0.0002 * relax) && spreadOk) {
      return { coin: s.coin, side: 'short', reason: 'jebol low range 20m' }
    }
  }
  return null
}

function dipHunterSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; rsi: number; ret: number }> = []
  for (const coin of market.liquidCoins(FLOORS.dipHunter)) {
    const rsi = market.rsi14(coin)
    const ret = market.retPct(coin, 60)
    if (rsi == null || ret == null) continue
    scored.push({ coin, rsi, ret })
  }
  // LONG the most oversold dip (mean reversion up)
  scored.sort((a, b) => a.rsi - b.rsi)
  const worst = scored[0]
  if (worst && worst.rsi < 34 * (2 - relax) && worst.ret < -0.8 * relax) {
    return { coin: worst.coin, side: 'long', reason: `dip RSI ${worst.rsi.toFixed(0)}` }
  }
  // SHORT the most overbought rip (mean reversion down — the mirror)
  const hottest = [...scored].sort((a, b) => b.rsi - a.rsi)[0]
  if (hottest && hottest.rsi > 100 - 34 * (2 - relax) && hottest.ret > 0.8 * relax) {
    return { coin: hottest.coin, side: 'short', reason: `rip RSI ${hottest.rsi.toFixed(0)}` }
  }
  return null
}

function whaleTailSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; ratio: number; bull: boolean }> = []
  for (const coin of market.liquidCoins(FLOORS.whaleTail)) {
    const stats = market.volStats(coin)
    if (!stats) continue
    scored.push({ coin, ratio: stats.ratio, bull: stats.bull })
  }
  scored.sort((a, b) => b.ratio - a.ratio)
  const best = scored[0]
  if (!best) return null
  if (best.ratio > 2.6 * (2 - relax)) {
    // follow the whale in whichever direction it just moved the book
    return best.bull
      ? { coin: best.coin, side: 'long', reason: `whale ${best.ratio.toFixed(1)}× volume rata-rata` }
      : { coin: best.coin, side: 'short', reason: `whale jual ${best.ratio.toFixed(1)}× volume` }
  }
  return null
}

function scalperSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; imb: number; spread: number; micro: number }> = []
  for (const coin of market.liquidCoins(FLOORS.scalper)) {
    // depth-based imbalance (USD within 10 bps of mid) — robust vs spoofed
    // level-1 sizes; falls back to the old top-of-book ratio if book is stale
    const imb = market.depthImbalance(coin, 10) ?? market.imbalance(coin)
    const spread = market.spreadPct(coin)
    const micro = market.retPct(coin, 2)
    if (imb == null || spread == null || micro == null) continue
    scored.push({ coin, imb, spread, micro })
  }
  // LONG: bids stacked (imb > 1) AND the last ticks agree. The 27-trade
  // autopsy killed the old lone-depth entry (10 trades, zero winners): depth
  // imbalance without tick confirmation is just resting spoof-able size, so
  // the scalper now demands BOTH a stronger imbalance (≥1.8×) and price
  // already ticking its way (|micro| > 0.01%).
  scored.sort((a, b) => b.imb - a.imb)
  for (const s of scored) {
    if (s.spread < 0.045 && s.imb > 1.8 - (1 - relax) * 0.3 && s.micro > 0.01) {
      return {
        coin: s.coin,
        side: 'long',
        reason: `spread ${s.spread.toFixed(3)}% · depth bid menumpuk ${s.imb.toFixed(1)}×`,
      }
    }
  }
  // SHORT: asks stacked (imb < 1, mirror threshold) + ticks falling
  const shorts = scored.sort((a, b) => a.imb - b.imb)
  for (const s of shorts) {
    const need = 1 / (1.8 - (1 - relax) * 0.3)
    if (s.spread < 0.045 && s.imb < need && s.micro < -0.01) {
      return {
        coin: s.coin,
        side: 'short',
        reason: `spread ${s.spread.toFixed(3)}% · depth ask menumpuk ${(1 / s.imb).toFixed(1)}×`,
      }
    }
  }
  return null
}

/** exported for the engine's liquidity cap math */
export const GLOBAL_MIN_VOL = MIN_VOL_24H_USD
