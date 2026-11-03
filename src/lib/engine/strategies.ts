import { MarketData, MIN_VOL_24H_USD } from './market'
import type { CrewDef } from './crew'

export interface Signal {
  coin: string
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
  market: MarketData,
  bored: boolean
): Signal | null {
  const relax = bored ? 0.6 : 1
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
  const best = scored[0]
  if (!best) return null
  if (best.ret > 0.45 * relax && best.ratio > 1.4) {
    return { coin: best.coin, reason: `buyers ${best.ratio.toFixed(1)}× sellers` }
  }
  return null
}

function sniperSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; mid: number; high: number; spread: number | null }> = []
  for (const coin of market.liquidCoins(FLOORS.sniper)) {
    const mid = market.mid(coin)
    const high = market.highN(coin, 20)
    if (mid == null || high == null) continue
    scored.push({ coin, mid, high, spread: market.spreadPct(coin) })
  }
  // prefer the strongest breakout (distance above the range high)
  scored.sort((a, b) => b.mid / b.high - a.mid / a.high)
  for (const s of scored) {
    const spreadOk = s.spread == null || s.spread < 0.09
    if (s.mid > s.high * (1 + 0.0002 * relax) && spreadOk) {
      return { coin: s.coin, reason: 'broke 20m range high' }
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
  scored.sort((a, b) => a.rsi - b.rsi)
  const worst = scored[0]
  if (!worst) return null
  if (worst.rsi < 34 * (2 - relax) && worst.ret < -0.8 * relax) {
    return { coin: worst.coin, reason: `RSI ${worst.rsi.toFixed(0)} dip` }
  }
  return null
}

function whaleTailSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; ratio: number }> = []
  for (const coin of market.liquidCoins(FLOORS.whaleTail)) {
    const stats = market.volStats(coin)
    if (!stats || !stats.bull) continue
    scored.push({ coin, ratio: stats.ratio })
  }
  scored.sort((a, b) => b.ratio - a.ratio)
  const best = scored[0]
  if (!best) return null
  if (best.ratio > 2.6 * (2 - relax)) {
    return { coin: best.coin, reason: `whale prints ${best.ratio.toFixed(1)}× avg volume` }
  }
  return null
}

function scalperSignal(market: MarketData, relax: number): Signal | null {
  const scored: Array<{ coin: string; imb: number; spread: number; micro: number }> = []
  for (const coin of market.liquidCoins(FLOORS.scalper)) {
    const imb = market.imbalance(coin)
    const spread = market.spreadPct(coin)
    const micro = market.retPct(coin, 2)
    if (imb == null || spread == null || micro == null) continue
    scored.push({ coin, imb, spread, micro })
  }
  scored.sort((a, b) => b.imb - a.imb)
  for (const s of scored) {
    if (s.spread < 0.045 && s.imb > 1.5 - (1 - relax) * 0.3 && s.micro > -0.005) {
      return {
        coin: s.coin,
        reason: `spread ${s.spread.toFixed(3)}% · bids stacked`,
      }
    }
  }
  return null
}

/** exported for the engine's liquidity cap math */
export const GLOBAL_MIN_VOL = MIN_VOL_24H_USD
