// The entry brain — every candidate signal from every agent must pass through
// here before the engine spends real risk budget on it.
//
// An agent trigger alone is NOT an edge ("momentum is rising" is one voice).
// The brain turns it into a CONFLUENCE decision: independent checks from
// different market dimensions must agree, weighted into one score 0..100,
// with hard vetoes for mathematically bad longs:
//
//   1. dead market   — ATR ~0 means the TP is unreachable before the time stop
//   2. HTF trend     — 5m EMA12: breakout/whale/micro longs only WITH the trend
//   3. 1m regime     — Kaufman ER: falling knives vetoed for chase entries
//   4. volume        — a move nobody trades is noise; surge = confirmation
//   5. RSI band      — never buy RSI≥80; dip agent REQUIRES oversold
//   6. overextension — a coin that already ran +5%/30m is someone else's exit
//   7. spread        — wide book = instant slippage loss on entry+exit
//
// No AI, no vibes — every gate is a number computed from live candles/books,
// so the desk rules ("we only trade with confirmation") are ENFORCED, not
// suggested. The bot losing streak boost makes the whole desk adaptive: an
// agent on a losing streak needs a higher score before it may fire again.

import type { MarketData } from './market'
import type { BotKey } from '@/lib/shared-types'

export type SignalKind = 'breakout' | 'dip' | 'whale' | 'micro'

const KIND_BY_KEY: Record<BotKey, SignalKind> = {
  momentum: 'breakout',
  sniper: 'breakout',
  dipHunter: 'dip',
  whaleTail: 'whale',
  scalper: 'micro',
}

/** score needed to pass, per signal kind (dips are mean-reversion → slightly easier) */
const NEED: Record<SignalKind, number> = { breakout: 52, dip: 48, whale: 48, micro: 52 }

export interface BrainVerdict {
  ok: boolean
  score: number // 0..100
  need: number // threshold actually used (kind base + bored relax + form boost)
  pass: string[] // positive confirmations (for the thought bubble)
  veto: string[] // hard blocks — one is enough to kill the entry
  soft: Array<{ label: string; pts: number }> // deductions that lower the score
}

export function kindOf(key: BotKey): SignalKind {
  return KIND_BY_KEY[key]
}

export function verdict(
  coin: string,
  market: MarketData,
  kind: SignalKind,
  opts: { bored: boolean; boost: number } // boost > 0 = pickier after losses, < 0 = confident after wins
): BrainVerdict {
  const pass: string[] = []
  const veto: string[] = []
  const soft: BrainVerdict['soft'] = []
  let score = 0
  const need = Math.max(36, NEED[kind] + (opts.bored ? -8 : 0) + opts.boost)

  // ---------- 1. dead market ----------
  const atr = market.atrPct(coin, 14)
  if (atr != null) {
    if (atr < 0.03) veto.push(`market mati · ATR ${atr.toFixed(2)}%`)
    else if (atr >= 0.06) {
      score += 10
      pass.push(`ATR ${atr.toFixed(2)}%`)
    }
  }

  // ---------- 2. HTF trend (5m EMA12) ----------
  const htf = market.htfTrend(coin, 5, 12)
  if (htf) {
    if (htf.above && htf.rising) {
      score += kind === 'dip' ? 20 : 25
      pass.push('tren 5m ↑')
    } else if (htf.above) {
      score += 10 // above EMA but flat — acceptable
    } else if (htf.rising) {
      score += kind === 'dip' ? 12 : 6 // below EMA but recovering — dips love this
    } else {
      // below EMA and falling
      if (kind === 'dip') soft.push({ label: 'tren 5m turun', pts: 12 })
      else if (kind === 'micro') soft.push({ label: 'tren 5m turun', pts: 15 })
      else veto.push('tren 5m turun') // breakout/whale NEVER fight the 5m trend
    }
  }

  // ---------- 3. 1m regime (Kaufman ER) ----------
  const reg = market.regime(coin)
  if (reg) {
    if (reg.kind === 'trending' && reg.up && kind !== 'dip') {
      score += 15
      pass.push('1m efisien ↑')
    } else if (reg.kind === 'trending' && !reg.up) {
      if (kind === 'dip') {
        score += 10
        pass.push('1m turun → harga diskon')
      } else if (kind === 'micro') {
        soft.push({ label: 'tekanan 1m turun', pts: 10 })
      } else {
        veto.push('arah 1m turun') // chasing a falling 1m tape
      }
    } else if (reg.kind === 'ranging' && kind === 'dip') {
      score += 12
      pass.push('range → mean reversion')
    }
  }

  // ---------- 4. volume confirmation ----------
  const vs = market.volStats(coin)
  if (vs) {
    if (vs.ratio >= 1.2) {
      score += 15
      pass.push(`vol ${vs.ratio.toFixed(1)}×`)
    } else if (vs.ratio < 0.7 && kind !== 'dip') {
      soft.push({ label: 'volume sepi', pts: 10 })
    }
  }

  // ---------- 5. RSI band ----------
  const rsi = market.rsi14(coin)
  if (rsi != null) {
    if (kind === 'dip') {
      if (rsi <= 40) {
        score += 18
        pass.push(`RSI ${rsi.toFixed(0)}`)
      } else if (rsi > 55) {
        veto.push(`RSI ${rsi.toFixed(0)} belum oversold`)
      }
    } else {
      if (rsi >= 80) veto.push(`RSI ${rsi.toFixed(0)} overbought`)
      else if (rsi >= 70) soft.push({ label: `RSI ${rsi.toFixed(0)} panas`, pts: 8 })
      else if (rsi < 60 && htf?.above) {
        score += 8
        pass.push(`RSI ${rsi.toFixed(0)} lega`)
      }
    }
  }

  // ---------- 6. overextension (30-minute candle return) ----------
  const ret30 = market.retPctCandles(coin, 30)
  if (ret30 != null) {
    if (kind === 'dip') {
      if (ret30 <= -1.5) {
        score += 10
        pass.push(`turun ${ret30.toFixed(1)}% /30m`)
      }
    } else if (ret30 > 5) {
      veto.push(`sudah lari +${ret30.toFixed(1)}% · telat`)
    } else if (ret30 > 3) {
      soft.push({ label: `sudah lari +${ret30.toFixed(1)}% /30m`, pts: 10 })
    }
  }

  // ---------- 7. spread ----------
  const spread = market.spreadPct(coin)
  if (spread != null) {
    if (spread > 0.25) veto.push(`spread lebar ${spread.toFixed(2)}%`)
    else if (spread > 0.12 && (kind === 'micro' || kind === 'breakout')) {
      soft.push({ label: 'spread lumayan lebar', pts: 6 })
    }
  }

  const total = soft.reduce((a, s) => a + s.pts, 0)
  const final = Math.max(0, Math.round(score - total))
  const ok = veto.length === 0 && final >= need

  return { ok, score: final, need, pass, veto, soft }
}

/** first-line human reason for a rejection (for the bot's thought bubble) */
export function rejectReason(v: BrainVerdict): string {
  if (v.veto.length > 0) return v.veto[0]
  const s = v.soft[0]
  if (s) return `${s.label} (−${s.pts})`
  return `skor ${v.score}/${v.need} belum cukup`
}
