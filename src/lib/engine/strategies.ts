import type { MarketData } from './market'
import type { CrewDef } from './crew'

export interface Signal {
  coin: string
  reason: string
}

/**
 * Entry signals — each bot has its own personality. `bored` relaxes
 * thresholds so an idle bot eventually finds something (keeps the crew lively).
 */
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
  const candidates = [...market.mids.keys()].filter((c) => c !== 'BTC' || true)
  const watched = candidates.filter((c) => ['BTC', 'ETH', 'SOL', 'SUI', 'JUP', 'HYPE', 'TIA', 'APT'].includes(c))
  const scored: Array<{ coin: string; ret: number; ratio: number }> = []
  for (const coin of watched) {
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
  const watched = ['SOL', 'DOGE', 'WIF', 'BONK', 'PEPE', 'TRUMP', 'FARTCOIN', 'HYPE']
  for (const coin of watched) {
    const mid = market.mid(coin)
    const high = market.highN(coin, 20)
    const spread = market.spreadPct(coin)
    if (mid == null || high == null) continue
    const spreadOk = spread == null || spread < 0.09
    if (mid > high * (1 + 0.0002 * relax) && spreadOk) {
      return { coin, reason: 'broke 20m range high' }
    }
  }
  return null
}

function dipHunterSignal(market: MarketData, relax: number): Signal | null {
  const watched = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'XRP', 'NEAR', 'ARB', 'OP']
  const scored: Array<{ coin: string; rsi: number; ret: number }> = []
  for (const coin of watched) {
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
  const watched = ['WIF', 'BONK', 'PEPE', 'TRUMP', 'FARTCOIN', 'DOGE', 'HYPE', 'JUP']
  const scored: Array<{ coin: string; ratio: number }> = []
  for (const coin of watched) {
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
  const watched = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX']
  const scored: Array<{ coin: string; imb: number; spread: number; micro: number }> = []
  for (const coin of watched) {
    const imb = market.imbalance(coin)
    const spread = market.spreadPct(coin)
    const micro = market.retPct(coin, 2)
    if (imb == null || spread == null || micro == null) continue
    scored.push({ coin, imb, spread, micro })
  }
  scored.sort((a, b) => b.imb - a.imb)
  const best = scored[0]
  if (!best) return null
  if (best.spread < 0.045 && best.imb > 1.5 - (1 - relax) * 0.3 && best.micro > -0.005) {
    return {
      coin: best.coin,
      reason: `spread ${best.spread.toFixed(3)}% · bids stacked`,
    }
  }
  return null
}
