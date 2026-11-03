// HyperGrok desk risk module — ported from galleonlabs/hypergrok-trading-desk
// (skills/desk-risk-limits, MIT license). The core ideas:
//
//   1. "The stop defines the size." Size every position from the stressed
//      stop cost — never from margin, never from desired profit.
//   2. Reservation ledger: open risk + pending risk share one budget. Two
//      proposals may not spend the same capacity.
//   3. Hard ceilings + a user limits layer that may only TIGHTEN them.
//   4. Daily loss stop latches "no-new-risk" until reset (exits stay allowed).
//   5. Correlated coins form one cluster — the book is risked as a whole.
//
// stopt_cost arithmetic (desk-risk-limits §2.2):
//   stop_fill       = stop ∓ slippage          (a stop exits as a taker)
//   fees_per_unit   = (entry + stop_fill) × taker_fee   (both legs)
//   stressed_dist   = |entry − stop_fill| + fees_per_unit
//   raw_size        = risk_usd / stressed_dist          (NEVER risk/|entry−stop|)
//   size            = round DOWN, never up

import type { TradeMode } from '@/lib/shared-types'

/** Hard desk ceilings — a config may tighten these, never loosen. */
export const CEILINGS = {
  maxRiskPct: 2.0, // max % of equity at risk per trade
  maxTotalRiskPct: 6.0, // max % of equity at risk across ALL open positions
  dailyLossStopPct: 10.0, // max daily-loss stop (% of start-of-day equity)
  maxLeverage: 20,
  maxPerCluster: 2, // max simultaneous positions in one correlated cluster
} as const

/** Desk defaults for a fresh install (tighter than the ceilings). */
export const RISK_DEFAULTS = {
  maxRiskPct: 1.0,
  maxTotalRiskPct: 4.0,
  dailyLossStopPct: 6.0,
} as const

export const TAKER_FEE = 0.00045 // Hyperliquid taker: 0.045% per leg
const SLIP_FLOOR = 0.001 // 10 bps minimum assumed stop slippage

export interface RiskLimits {
  maxRiskPct: number
  maxTotalRiskPct: number
  dailyLossStopPct: number
}

/** Clamp user limits into the desk ceilings — may only tighten. */
export function clampLimits(l: Partial<RiskLimits>): RiskLimits {
  const clamp = (v: number | undefined, dflt: number, ceil: number) =>
    Math.min(ceil, Math.max(0.1, isFinite(v as number) ? (v as number) : dflt))
  return {
    maxRiskPct: clamp(l.maxRiskPct, RISK_DEFAULTS.maxRiskPct, CEILINGS.maxRiskPct),
    maxTotalRiskPct: clamp(l.maxTotalRiskPct, RISK_DEFAULTS.maxTotalRiskPct, CEILINGS.maxTotalRiskPct),
    dailyLossStopPct: clamp(l.dailyLossStopPct, RISK_DEFAULTS.dailyLossStopPct, CEILINGS.dailyLossStopPct),
  }
}

export interface StressedStopInput {
  equity: number
  maxRiskPct: number // % of equity this one trade may lose
  entryPx: number
  /** stop as % below entry (long). Must be > 0. */
  stopPct: number
  /** current spread in % of price (0 when book unknown — floor still applies) */
  spreadPct?: number | null
  takerFee?: number
}

export interface StressedStopResult {
  /** notional ($) sized so a triggered stop costs ≈ risk_usd */
  sizeUsd: number
  /** $ a stressed stop hit actually costs (slippage + taker both legs) */
  riskUsd: number
  /** % distance from entry to the stressed fill */
  stressedDistPct: number
  /** assumed stop slippage fraction (max of 10 bps floor and live spread) */
  slipFrac: number
}

/**
 * Stressed-stop sizing. Returns the largest notional whose worst-case stop
 * cost (slippage on the stop fill + taker fees on BOTH legs) stays inside
 * the per-trade risk budget. Rounds DOWN — never round a risk up.
 */
export function stressedStopSize(input: StressedStopInput): StressedStopResult {
  const { equity, entryPx, stopPct } = input
  const takerFee = input.takerFee ?? TAKER_FEE
  const slipFrac = Math.max(SLIP_FLOOR, (input.spreadPct ?? 0) / 100)
  const stopFrac = Math.max(0.0001, stopPct / 100)

  // long entry: stop trigger sits stopFrac below entry; the stressed fill
  // slips another slipFrac below the trigger
  const stopFill = entryPx * (1 - stopFrac) * (1 - slipFrac)
  const feesPerUnit = (entryPx + stopFill) * takerFee
  const stressedDist = Math.max(entryPx - stopFill + feesPerUnit, entryPx * 0.0002)

  const riskUsd = Math.max(0, (equity * input.maxRiskPct) / 100)
  const qty = riskUsd / stressedDist
  const sizeUsd = Math.floor(qty * entryPx * 100) / 100 // round down to cents

  return {
    sizeUsd,
    riskUsd: qty * stressedDist,
    stressedDistPct: (stressedDist / entryPx) * 100,
    slipFrac,
  }
}

/**
 * Correlated clusters: positions inside one cluster are ONE risk, not N.
 * (desk-risk-limits §1: "majors (BTC, ETH, SOL) count as one cluster")
 */
const CLUSTERS: Record<string, string[]> = {
  majors: ['BTC', 'ETH', 'SOL'],
  memes: [
    'DOGE', 'WIF', 'BONK', 'PEPE', 'TRUMP', 'FARTCOIN', 'PUMP', 'HYPE',
    'kPEPE', 'SHIB', 'FLOKI', 'MOODENG', 'PNUT', 'GOAT', 'W', 'IP',
  ],
  l1alts: [
    'AVAX', 'APT', 'SUI', 'NEAR', 'TON', 'SEI', 'TIA', 'INJ', 'ADA', 'DOT',
    'ATOM', 'ALGO', 'HBAR', 'XRP', 'XLM', 'TRX', 'BNB', 'CFX', 'KAS', 'OP', 'ARB',
  ],
  defi: ['LINK', 'UNI', 'AAVE', 'CRV', 'MKR', 'LDO', 'DYDX', 'GMX', 'JUP', 'ENA', 'PENDLE', 'ONDO'],
}

export function clusterOf(coin: string): string {
  for (const [name, members] of Object.entries(CLUSTERS)) {
    if (members.includes(coin)) return name
  }
  return 'other'
}

/** How a position contributes to the open-risk ledger. */
export interface RiskReservation {
  /** $ the position loses if its stop is hit (stressed estimate) */
  riskUsd: number
  /** which trading mode the reservation belongs to (sim/testnet/mainnet) */
  mode: TradeMode
}

/**
 * Inverse of stressedStopSize for an ALREADY-SIZED position: given notional,
 * entry, stop distance and spread → the $ a stressed stop hit actually costs.
 * Used to fill the reservation ledger for open positions.
 */
export function stressedRiskOfPosition(
  sizeUsd: number,
  entryPx: number,
  stopPct: number,
  spreadPct?: number | null,
  takerFee = TAKER_FEE
): number {
  const slipFrac = Math.max(SLIP_FLOOR, (spreadPct ?? 0) / 100)
  const stopFrac = Math.max(0.0001, stopPct / 100)
  const stopFill = entryPx * (1 - stopFrac) * (1 - slipFrac)
  const feesPerUnit = (entryPx + stopFill) * takerFee
  const stressedDist = Math.max(entryPx - stopFill + feesPerUnit, entryPx * 0.0002)
  return (sizeUsd / entryPx) * stressedDist
}

/**
 * Rolling risk ledger for one trading mode. Tracks open + pending risk
 * against the total-open-risk limit and latches on the daily loss stop.
 */
export class RiskLedger {
  limits: RiskLimits = { ...RISK_DEFAULTS }
  private reservations = new Map<string, RiskReservation>()
  private dayStartEquity = 0
  private dayKey = ''
  private latched = false
  private latchedReason = ''

  setLimits(l: RiskLimits) {
    this.limits = clampLimits(l)
  }

  /** start-of-day equity — call every tick; rolls over at UTC midnight */
  observeDay(equity: number, now = Date.now()) {
    const key = new Date(now).toISOString().slice(0, 10)
    if (key !== this.dayKey) {
      this.dayKey = key
      this.dayStartEquity = equity
      if (this.latched && this.latchedReason === 'daily loss stop') this.reset()
    }
    if (this.dayStartEquity <= 0) this.dayStartEquity = equity
  }

  reserve(id: string, r: RiskReservation) {
    this.reservations.set(id, r)
  }

  release(id: string) {
    this.reservations.delete(id)
  }

  clear() {
    this.reservations.clear()
  }

  openRiskUsd(mode: TradeMode): number {
    let sum = 0
    for (const r of this.reservations.values()) {
      if (r.mode === mode) sum += Math.max(0, r.riskUsd)
    }
    return sum
  }

  openRiskPct(equity: number, mode: TradeMode): number {
    return equity > 0 ? (this.openRiskUsd(mode) / equity) * 100 : 0
  }

  dailyPnlUsd(equity: number): number {
    return equity - this.dayStartEquity
  }

  dailyLossPct(equity: number): number {
    if (this.dayStartEquity <= 0) return 0
    return ((equity - this.dayStartEquity) / this.dayStartEquity) * 100
  }

  isLatched(): boolean {
    return this.latched
  }

  latchReason(): string {
    return this.latchedReason
  }

  /** fraction (0-1) of the daily stop consumed — early warning at 80% */
  dailyStopUsage(equity: number): number {
    const stopUsd = (this.dayStartEquity * this.limits.dailyLossStopPct) / 100
    if (stopUsd <= 0) return 0
    return Math.max(0, -this.dailyPnlUsd(equity) / stopUsd)
  }

  /**
   * The entry gate. Checks (desk-risk-limits §2.2):
   *   daily-loss-stop latch  →  total open risk incl. candidate ≤ limit
   * Returns whether the trade may open and the $ risk budget it may use.
   */
  canOpen(equity: number, mode: TradeMode, candidateRiskUsd: number): { ok: boolean; reason: string; budgetUsd: number } {
    const budgetUsd = (equity * this.limits.maxRiskPct) / 100

    if (this.latched) {
      return { ok: false, reason: `tanpa risiko baru: ${this.latchedReason}`, budgetUsd }
    }
    const usage = this.dailyStopUsage(equity)
    if (usage >= 1) {
      this.latched = true
      this.latchedReason = 'stop rugi harian'
      return { ok: false, reason: 'tanpa risiko baru: stop rugi harian', budgetUsd }
    }
    const limitUsd = (equity * this.limits.maxTotalRiskPct) / 100
    const after = this.openRiskUsd(mode) + Math.max(0, candidateRiskUsd)
    if (after > limitUsd) {
      return {
        ok: false,
        reason: `risiko terbuka penuh (${this.openRiskUsd(mode).toFixed(0)}+${candidateRiskUsd.toFixed(0)} > ${limitUsd.toFixed(0)})`,
        budgetUsd,
      }
    }
    return { ok: true, reason: 'ok', budgetUsd }
  }

  /** manual reset (user lifts the daily stop) */
  reset() {
    this.latched = false
    this.latchedReason = ''
    this.dayStartEquity = 0
    this.dayKey = ''
  }
}
