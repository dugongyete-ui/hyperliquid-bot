// The entry brain — every candidate signal from every agent must pass through
// here before the engine spends real risk budget on it.
//
// An agent trigger alone is NOT an edge ("momentum is rising" is one voice).
// The brain turns it into a CONFLUENCE decision: independent checks from
// different market dimensions must agree, weighted into one score 0..100,
// with hard vetoes for mathematically bad entries:
//
//   1. dead market   — ATR ~0 means the TP is unreachable before the time stop
//   2. HTF trend     — 5m EMA12: longs only WITH an uptrend, shorts only WITH
//                      a downtrend (never fight the higher timeframe)
//   3. 1m regime     — Kaufman ER: chase entries vetoed against the 1m tape
//   4. volume        — a move nobody trades is noise; surge = confirmation
//   5. RSI band      — never buy RSI≥80, never short RSI≤20; dip/rip agents
//                      REQUIRE the extreme on their side
//   6. overextension — a coin that already ran ±5%/30m is someone else's exit
//   7. spread        — wide book = instant slippage loss on entry+exit
//   8. book depth    — cumulative USD depth 5/10/25 bps around mid: a wall on
//                      the wrong side of our entry is penalized, stacked
//                      support on our side pays
//   9. funding       — never crowd the popular side (extreme funding = squeeze
//                      fuel); getting PAID to hold our side is a tailwind
//  10. open interest — OI rising = fresh money fuels the move; OI falling =
//                      the move is just positions closing (weak)
//
// No AI, no vibes — every gate is a number computed from live candles/books,
// so the desk rules ("we only trade with confirmation") are ENFORCED, not
// suggested. The bot losing streak boost makes the whole desk adaptive: an
// agent on a losing streak needs a higher score before it may fire again.

import type { MarketData } from './market'
import type { BotKey } from '@/lib/shared-types'
import type { TradeSide } from './strategies'

export type SignalKind = 'breakout' | 'dip' | 'whale' | 'micro'

const KIND_BY_KEY: Record<BotKey, SignalKind> = {
  momentum: 'breakout',
  sniper: 'breakout',
  dipHunter: 'dip',
  whaleTail: 'whale',
  scalper: 'micro',
}

/** score needed to pass, per signal kind (mean-reversion → slightly easier) */
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
  side: TradeSide,
  opts: { bored: boolean; boost: number } // boost > 0 = pickier after losses, < 0 = confident after wins
): BrainVerdict {
  const pass: string[] = []
  const veto: string[] = []
  const soft: BrainVerdict['soft'] = []
  let score = 0
  const need = Math.max(36, NEED[kind] + (opts.bored ? -8 : 0) + opts.boost)
  const up = side === 'long' // direction helper — every gate mirrors on this
  const meanRev = kind === 'dip' // dip (long) / rip (short) = mean reversion

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
    const aligned = up ? htf.above && htf.rising : !htf.above && !htf.rising
    const onSide = up ? htf.above : !htf.above
    const moving = up ? htf.rising : !htf.rising
    if (aligned) {
      score += meanRev ? 20 : 25
      pass.push(up ? 'tren 5m ↑' : 'tren 5m ↓')
    } else if (onSide) {
      score += 10 // on our side of the EMA but flat
    } else if (moving) {
      score += meanRev ? 12 : 6 // against EMA but rotating our way — mean reversion loves this
    } else {
      // fully against us: EMA on the other side AND sloping the wrong way
      if (meanRev) soft.push({ label: up ? 'tren 5m turun' : 'tren 5m naik', pts: 12 })
      else if (kind === 'micro') soft.push({ label: up ? 'tren 5m turun' : 'tren 5m naik', pts: 15 })
      else veto.push(up ? 'tren 5m turun' : 'tren 5m naik') // breakout/whale NEVER fight the 5m trend
    }
  }

  // ---------- 3. 1m regime (Kaufman ER) ----------
  const reg = market.regime(coin)
  if (reg) {
    const regUp = reg.up
    if (reg.kind === 'trending' && regUp === up && !meanRev) {
      score += 15
      pass.push(up ? '1m efisien ↑' : '1m efisien ↓')
    } else if (reg.kind === 'trending' && regUp !== up) {
      if (meanRev) {
        score += 10
        pass.push(up ? '1m turun → harga diskon' : '1m naik → jual mahal')
      } else if (kind === 'micro') {
        soft.push({ label: up ? 'tekanan 1m turun' : 'tekanan 1m naik', pts: 10 })
      } else {
        veto.push(up ? 'arah 1m turun' : 'arah 1m naik') // chasing against the 1m tape
      }
    } else if (reg.kind === 'ranging' && meanRev) {
      score += 12
      pass.push('range → mean reversion')
    } else if (reg.kind === 'ranging' && kind === 'breakout') {
      // sideways tape: breakouts die at the range edge (grid wisdom —
      // ranging markets pay mean-reverters, not chasers)
      soft.push({ label: 'market sideways', pts: 10 })
    }
  }

  // ---------- 4. volume confirmation ----------
  const vs = market.volStats(coin)
  if (vs) {
    if (vs.ratio >= 1.2) {
      score += 15
      pass.push(`vol ${vs.ratio.toFixed(1)}×`)
    } else if (vs.ratio < 0.7 && !meanRev) {
      soft.push({ label: 'volume sepi', pts: 10 })
    }
  }

  // ---------- 5. RSI band ----------
  const rsi = market.rsi14(coin)
  if (rsi != null) {
    if (meanRev) {
      // dip wants oversold, rip wants overbought
      if (up ? rsi <= 40 : rsi >= 60) {
        score += 18
        pass.push(`RSI ${rsi.toFixed(0)}`)
      } else if (up ? rsi > 55 : rsi < 45) {
        veto.push(up ? `RSI ${rsi.toFixed(0)} belum oversold` : `RSI ${rsi.toFixed(0)} belum overbought`)
      }
    } else {
      if (up ? rsi >= 80 : rsi <= 20) veto.push(`RSI ${rsi.toFixed(0)} ${up ? 'overbought' : 'oversold'}`)
      else if (up ? rsi >= 70 : rsi <= 30) soft.push({ label: `RSI ${rsi.toFixed(0)} ekstrem`, pts: 8 })
      else if (up ? rsi < 60 && htf?.above : rsi > 40 && htf && !htf.above) {
        score += 8
        pass.push(`RSI ${rsi.toFixed(0)} lega`)
      }
    }
  }

  // ---------- 6. overextension (30-minute candle return) ----------
  const ret30 = market.retPctCandles(coin, 30)
  if (ret30 != null) {
    if (meanRev) {
      if (up ? ret30 <= -1.5 : ret30 >= 1.5) {
        score += 10
        pass.push(`${ret30 > 0 ? '+' : ''}${ret30.toFixed(1)}% /30m`)
      }
    } else if (up ? ret30 > 5 : ret30 < -5) {
      veto.push(
        up ? `sudah lari +${ret30.toFixed(1)}% · telat` : `sudah anjlok ${ret30.toFixed(1)}% · telat`
      )
    } else if (up ? ret30 > 3 : ret30 < -3) {
      soft.push({ label: `sudah ${ret30 > 0 ? 'lari' : 'anjlok'} ${Math.abs(ret30).toFixed(1)}% /30m`, pts: 10 })
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

  // ---------- 8. book depth (USD within 5/10/25 bps of mid) ----------
  const dimb = market.depthImbalance(coin, 25)
  if (dimb != null) {
    if (up ? dimb >= 1.4 : dimb <= 1 / 1.4) {
      score += 10
      pass.push(up ? `depth bid ${dimb.toFixed(1)}×` : `depth ask ${(1 / dimb).toFixed(1)}×`)
    } else if (up ? dimb <= 0.65 : dimb >= 1 / 0.65) {
      soft.push({
        label: up ? 'ask wall menumpuk di atas' : 'bid wall menumpuk di bawah',
        pts: 10,
      })
    }
  }

  // ---------- 9. funding — don't crowd the popular side ----------
  const fundPct = market.fundingPctHourly(coin)
  if (fundPct != null) {
    if (up ? fundPct >= 0.03 : fundPct <= -0.03) {
      soft.push({
        label: `funding ${fundPct.toFixed(3)}%/jam · sisi ${up ? 'long' : 'short'} ramai`,
        pts: 10,
      })
    } else if (up ? fundPct <= -0.005 : fundPct >= 0.005) {
      score += 6
      pass.push(up ? 'funding negatif · long dibayar' : 'funding positif · short dibayar')
    }
  }

  // ---------- 10. open interest — fresh money or just closings? ----------
  // direction-agnostic: OI up means NEW positions are being opened in the
  // direction of the move (new longs on a rip, new shorts on a dump) — both
  // confirm the move. OI down means the move is people exiting.
  const oiChg = market.oiChangePct(coin)
  if (oiChg != null) {
    if (oiChg >= 1.5) {
      score += 8
      pass.push(`OI +${oiChg.toFixed(1)}% · dana segar`)
    } else if (oiChg <= -2.5) {
      soft.push({ label: 'OI turun · gerakan dari tutup posisi', pts: 8 })
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
