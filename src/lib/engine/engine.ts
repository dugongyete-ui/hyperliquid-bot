// The trading engine: 5 autonomous agent bots trading the Hyperliquid universe.
// SIM mode = paper fills at live mainnet prices.
// LIVE modes = real signed orders via the official Hyperliquid SDK.

import { db } from '@/lib/db'
import { CREW, crewDef, type CrewDef } from './crew'
import { MarketData } from './market'
import { evaluateSignal, type Signal } from './strategies'
import {
  CEILINGS,
  RiskLedger,
  clampLimits,
  clusterOf,
  stressedRiskOfPosition,
  stressedStopSize,
} from './risk'
import {
  liveAccountState,
  liveMarketClose,
  liveMarketOpen,
  deriveAddress,
  roundQty,
  validatePrivateKey,
  type LiveNetwork,
} from './hl-exchange'
import type {
  BotKey,
  CrewBotState,
  EngineSnapshot,
  EquityPointRow,
  NotificationRow,
  TradeMode,
  TradeRow,
} from '@/lib/shared-types'

const TICK_MS = 2500
const MAX_OPEN = 4
const MIN_TRADE_USD = 10 // Hyperliquid exchange minimum notional — SIM mirrors it
const SCRATCH_PCT = 0.08 // |pnl%| below this = breakeven "scratch" trade
const STREAK_MILESTONES = [5, 10, 20, 50]

export type RiskProfile = 'chill' | 'balanced' | 'turbo'

/**
 * Risk profile scales every bot's exit plan. `timeStop` is the max hold for
 * positions that never went anywhere — winners are always allowed to run
 * (they ride the trailing stop instead of getting timer-killed).
 */
const PROFILES: Record<RiskProfile, { tpMul: number; slMul: number; timeStop: number; trailFrac: number }> = {
  chill: { tpMul: 1.5, slMul: 1.3, timeStop: 600, trailFrac: 0.45 },
  balanced: { tpMul: 1.0, slMul: 1.0, timeStop: 390, trailFrac: 0.4 },
  turbo: { tpMul: 0.7, slMul: 0.85, timeStop: 240, trailFrac: 0.5 },
}

/** Per-position exit plan in price-move % — derived from live volatility at
 * entry so a TP on calm BTC isn't the same distance as on FARTCOIN. */
interface ExitPlan {
  tpPx: number
  slPx: number
  trailPx: number
  timeStopSec: number
}

interface OpenPosition {
  tradeId: string
  botKey: BotKey
  coin: string
  qty: number
  sizeUsd: number // notional (margin × leverage) — matches what the exchange sees
  entryPx: number
  peakPct: number
  lastPnlPct: number
  lastPnlUsd: number // exchange-authoritative unrealized P&L (live modes)
  /** $ a stressed stop hit costs (slippage + taker both legs) — ledger reservation */
  riskUsd: number
  openedAt: number
  mode: TradeMode
  reason: string
  adopted: boolean
  plan: ExitPlan
}

interface BotStats {
  pnl: number
  wins: number
  losses: number
}

interface BotRuntime {
  def: CrewDef
  state: CrewBotState
  cooldownUntil: number
  lastActiveAt: number
  nextScanThoughtAt: number
}

export interface EngineSettings {
  mode: TradeMode
  botName: string
  startingEquity: number
  goalMultiple: number
  leverage: number
  positionPct: number
  riskProfile: RiskProfile
  maxRiskPct: number
  maxTotalRiskPct: number
  dailyLossStopPct: number
  privateKey: string | null
  walletAddress: string | null
  liveStartEquity: number | null
  running: boolean
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class Engine {
  market = new MarketData()
  /** HyperGrok desk risk ledger — reservation accounting + daily loss stop */
  risk = new RiskLedger()
  private riskLatchNotified = false
  private riskWarn80Notified = false
  settings: EngineSettings = {
    mode: 'sim',
    botName: 'Grok Bot',
    startingEquity: 1000,
    goalMultiple: 2,
    leverage: 5,
    positionPct: 0.3,
    riskProfile: 'balanced',
    maxRiskPct: 1,
    maxTotalRiskPct: 4,
    dailyLossStopPct: 6,
    privateKey: null,
    walletAddress: null,
    liveStartEquity: null,
    running: true,
  }

  private bots = new Map<BotKey, BotRuntime>()
  private positions: OpenPosition[] = []
  private closedCache: TradeRow[] = []
  private botStats: Record<TradeMode, Record<string, BotStats>> = {
    sim: {},
    testnet: {},
    mainnet: {},
  }
  private equityPoints: EquityPointRow[] = []
  private notifications: NotificationRow[] = []
  private unseenIds = new Set<string>()
  private streak = 0
  private nextStreakMilestone = STREAK_MILESTONES[0]
  private goalNotified = false
  private liveAccountValue: number | null = null
  private ready = false
  private tickCount = 0
  private lastLiveSyncAt = 0
  private lastEquityPersistAt = 0
  private timer: ReturnType<typeof setInterval> | null = null

  async init() {
    // settings row
    let s = await db.settings.findUnique({ where: { id: 'main' } })
    if (!s) {
      s = await db.settings.create({ data: { id: 'main' } })
    }
    this.settings = {
      mode: (s.mode as TradeMode) ?? 'sim',
      botName: s.botName,
      startingEquity: s.startingEquity,
      goalMultiple: s.goalMultiple,
      leverage: s.leverage ?? 5,
      positionPct: s.positionPct ?? 0.3,
      riskProfile: (s.riskProfile as RiskProfile) ?? 'balanced',
      maxRiskPct: s.maxRiskPct ?? 1,
      maxTotalRiskPct: s.maxTotalRiskPct ?? 4,
      dailyLossStopPct: s.dailyLossStopPct ?? 6,
      privateKey: s.privateKey,
      walletAddress: s.walletAddress,
      liveStartEquity: s.liveStartEquity,
      running: s.running,
    }
    this.risk.setLimits(
      clampLimits({
        maxRiskPct: this.settings.maxRiskPct,
        maxTotalRiskPct: this.settings.maxTotalRiskPct,
        dailyLossStopPct: this.settings.dailyLossStopPct,
      })
    )

    // init bot runtimes
    for (const def of CREW) {
      this.bots.set(def.key, {
        def,
        state: {
          key: def.key,
          name: def.name,
          color: def.color,
          face: def.face,
          pnl: 0,
          wins: 0,
          losses: 0,
          status: 'scanning',
          thought: def.scanningThoughts[0],
          thoughtAt: Date.now(),
          holding: null,
        },
        cooldownUntil: 0,
        lastActiveAt: Date.now(),
        nextScanThoughtAt: Date.now() + rand(8000, 25000),
      })
    }

    // aggregate closed trades per mode
    const closed = await db.trade.findMany({ where: { status: 'closed' }, orderBy: { closedAt: 'asc' } })
    for (const t of closed) {
      const stats = this.botStats[t.mode as TradeMode] ?? this.botStats.sim
      const cur = stats[t.botKey] ?? { pnl: 0, wins: 0, losses: 0 }
      cur.pnl += t.pnl
      if (t.pnl > 0) cur.wins++
      else if (t.pnl < 0) cur.losses++
      stats[t.botKey] = cur
    }
    this.closedCache = closed
      .slice(-40)
      .reverse()
      .map((t) => this.dbTradeToRow(t, crewDef(t.botKey)))

    // recompute streak for current mode
    this.recomputeStreak()

    // hydrate open trades → positions
    const open = await db.trade.findMany({ where: { status: 'open' } })
    this.positions = open.map((t) => {
      const plan = this.exitPlan(crewDef(t.botKey as BotKey), t.coin)
      return {
        tradeId: t.id,
        botKey: t.botKey as BotKey,
        coin: t.coin,
        qty: t.qty,
        sizeUsd: t.sizeUsd,
        entryPx: t.entryPx,
        peakPct: 0,
        lastPnlPct: 0,
        lastPnlUsd: 0,
        riskUsd: t.riskUsd || stressedRiskOfPosition(t.sizeUsd, t.entryPx, plan.slPx),
        openedAt: t.openedAt.getTime(),
        mode: t.mode as TradeMode,
        reason: t.reason,
        adopted: false,
        plan,
      }
    })
    this.rebuildLedger()

    // equity points for current mode
    await this.reloadEquityPoints()

    this.refreshCrewFromStats()
    this.ready = true

    if (!this.timer) {
      this.timer = setInterval(() => {
        this.tick().catch((e) => console.error('[engine] tick error:', e))
      }, TICK_MS)
    }
    // first tick immediately
    this.tick().catch((e) => console.error('[engine] first tick error:', e))
  }

  private dbTradeToRow(
    t: {
      id: string
      mode: string
      botKey: string
      coin: string
      sizeUsd: number
      entryPx: number
      exitPx: number | null
      pnl: number
      pnlPct: number
      riskUsd: number
      status: string
      reason: string
      exitReason: string | null
      openedAt: Date
      closedAt: Date | null
    },
    def: CrewDef
  ): TradeRow {
    return {
      id: t.id,
      botKey: t.botKey,
      botName: def.name,
      botColor: def.color,
      coin: t.coin,
      side: 'long',
      sizeUsd: t.sizeUsd,
      entryPx: t.entryPx,
      exitPx: t.exitPx,
      pnl: t.pnl,
      pnlPct: t.pnlPct,
      riskUsd: t.riskUsd,
      status: t.status as 'open' | 'closed',
      reason: t.reason,
      exitReason: t.exitReason,
      openedAt: t.openedAt.getTime(),
      closedAt: t.closedAt ? t.closedAt.getTime() : null,
      heldSec: t.closedAt ? (t.closedAt.getTime() - t.openedAt.getTime()) / 1000 : null,
      mode: t.mode as TradeMode,
    }
  }

  private async reloadEquityPoints() {
    const pts = await db.equityPoint.findMany({
      where: { mode: this.settings.mode },
      orderBy: { createdAt: 'desc' },
      take: 240,
    })
    this.equityPoints = pts.reverse().map((p) => ({ ts: p.createdAt.getTime(), equity: p.equity }))
  }

  private recomputeStreak() {
    // walk closed trades of current mode backwards, counting consecutive wins
    const closedForMode = this.closedCache.filter((t) => t.mode === this.settings.mode)
    let streak = 0
    for (const t of closedForMode) {
      if (t.pnl > 0) streak++
      else break
    }
    this.streak = streak
    this.nextStreakMilestone = STREAK_MILESTONES.find((m) => m > streak) ?? STREAK_MILESTONES[STREAK_MILESTONES.length - 1] + 50
    this.goalNotified = false
  }

  private refreshCrewFromStats() {
    const stats = this.botStats[this.settings.mode] ?? this.botStats.sim
    for (const rt of this.bots.values()) {
      const s = stats[rt.def.key] ?? { pnl: 0, wins: 0, losses: 0 }
      rt.state.pnl = s.pnl
      rt.state.wins = s.wins
      rt.state.losses = s.losses
    }
  }

  private notify(n: Omit<NotificationRow, 'id' | 'createdAt'>) {
    const row: NotificationRow = { ...n, id: crypto.randomUUID(), createdAt: Date.now() }
    this.notifications.unshift(row)
    this.notifications = this.notifications.slice(0, 30)
    this.unseenIds.add(row.id)
  }

  private liveNetwork(): LiveNetwork | null {
    if (this.settings.mode === 'testnet') return 'testnet'
    if (this.settings.mode === 'mainnet') return 'mainnet'
    return null
  }

  /**
   * Volatility-aware exit plan (all numbers are price-move %):
   *  - tp: how far the coin usually travels in the hold window (×1.7), capped
   *    by the bot's own personality ceiling — so TPs are actually reachable
   *  - sl: a bit over one “normal” adverse candle
   *  - trail: generous fraction of tp so winners get room to run
   *  - timeStop: profile-based ceiling — but only for positions that never
   *    took off (see managePositions: winners never get timer-killed)
   */
  private exitPlan(def: CrewDef, coin: string): ExitPlan {
    const prof = PROFILES[this.settings.riskProfile] ?? PROFILES.balanced
    const vol = this.market.atrPct(coin, 14) ?? 0.18 // % per 1m candle
    const horizon = Math.sqrt(prof.timeStop / 60) // diffusion-style time scaling
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    return {
      tpPx: clamp(1.7 * horizon * vol, 0.3, def.exit.tp * prof.tpMul),
      slPx: clamp(1.15 * horizon * vol, 0.18, def.exit.sl * prof.slMul),
      trailPx: Math.max(0.22, prof.trailFrac * clamp(1.7 * horizon * vol, 0.3, def.exit.tp * prof.tpMul)),
      timeStopSec: prof.timeStop,
    }
  }

  private unrealizedFor(pos: OpenPosition): { pnl: number; pnlPct: number } {
    if (pos.mode === 'sim') {
      const mark = this.market.mid(pos.coin) ?? pos.entryPx
      // paper fills happen at the live mid with no fees — keeps the demo honest about prices
      const pnl = pos.qty * (mark - pos.entryPx)
      return { pnl, pnlPct: pos.sizeUsd > 0 ? (pnl / pos.sizeUsd) * 100 : 0 }
    }
    // live: mark-to-market from the last synced qty/entry whenever we have a fresh mid,
    // otherwise fall back to the exchange's authoritative unrealized figure
    const mid = this.market.mid(pos.coin)
    if (mid != null && pos.qty > 0) {
      const pnl = pos.qty * (mid - pos.entryPx)
      return { pnl, pnlPct: pos.sizeUsd > 0 ? (pnl / pos.sizeUsd) * 100 : 0 }
    }
    const pnl = pos.lastPnlUsd || (pos.lastPnlPct / 100) * pos.sizeUsd
    return { pnl, pnlPct: pos.sizeUsd > 0 ? (pnl / pos.sizeUsd) * 100 : 0 }
  }

  currentEquity(): number {
    if (this.settings.mode === 'sim') {
      let realized = 0
      for (const s of Object.values(this.botStats.sim)) realized += s.pnl
      let unrealized = 0
      for (const p of this.positions) {
        if (p.mode !== 'sim') continue
        unrealized += this.unrealizedFor(p).pnl
      }
      return this.settings.startingEquity + realized + unrealized
    }
    if (this.liveAccountValue != null) return this.liveAccountValue
    const start = this.settings.liveStartEquity ?? this.settings.startingEquity
    let realized = 0
    for (const s of Object.values(this.botStats[this.settings.mode] ?? {})) realized += s.pnl
    let unrealized = 0
    for (const p of this.positions) {
      if (p.mode === this.settings.mode) unrealized += this.unrealizedFor(p).pnl
    }
    return start + realized + unrealized
  }

  private startingEquityForDisplay(): number {
    if (this.settings.mode === 'sim') return this.settings.startingEquity
    return this.settings.liveStartEquity ?? this.liveAccountValue ?? this.settings.startingEquity
  }

  private async tick() {
    if (!this.ready) return
    this.tickCount++
    const now = Date.now()
    // coins we currently hold always get the freshest candles/book first
    // (take-profit / stop-loss decisions stay precise)
    this.market.setPriority(
      this.positions.filter((p) => p.mode === this.settings.mode).map((p) => p.coin)
    )
    await this.market.update()

    // ---- desk risk watchdog (three-state: fine / warning / latched) ----
    const modeEquity = this.currentEquity()
    this.risk.observeDay(modeEquity, now)
    if (this.risk.isLatched() && !this.riskLatchNotified) {
      this.riskLatchNotified = true
      this.notify({
        kind: 'error',
        title: 'Daily loss stop hit — no new risk',
        body: `Down ${Math.abs(this.risk.dailyLossPct(modeEquity)).toFixed(1)}% today. Exits & protection still run; new entries pause until you reset the stop.`,
      })
    }
    if (!this.risk.isLatched() && this.riskLatchNotified) {
      this.riskLatchNotified = false
      this.notify({ kind: 'info', title: 'Risk desk open again', body: 'Daily stop reset — the crew may take new trades.' })
    }
    const usage = this.risk.dailyStopUsage(modeEquity)
    if (usage >= 0.8 && usage < 1 && !this.riskWarn80Notified) {
      this.riskWarn80Notified = true
      this.notify({
        kind: 'info',
        title: 'Approaching daily loss stop',
        body: `${Math.round(usage * 100)}% of the −${this.risk.limits.dailyLossStopPct}% daily stop used. Exits stay active; entries thin out.`,
      })
    }
    if (usage < 0.8) this.riskWarn80Notified = false

    if (this.settings.mode !== 'sim') {
      if (now - this.lastLiveSyncAt > 10_000) {
        await this.syncLive()
        this.lastLiveSyncAt = now
      }
    }

    await this.managePositions(now)
    await this.tryEntries(now)
    this.sampleEquity(now)
    this.rotateThoughts(now)
    this.updateBotStatuses(now)
  }

  // ---------------- live sync ----------------

  private async syncLive() {
    const network = this.liveNetwork()
    if (!network || !this.settings.privateKey) return
    const address =
      this.settings.walletAddress?.trim() || deriveAddress(this.settings.privateKey)
    const st = await liveAccountState(network, address)
    if (!st) return

    this.liveAccountValue = st.accountValue
    if (this.settings.liveStartEquity == null && st.accountValue > 0) {
      this.settings.liveStartEquity = st.accountValue
      db.settings
        .update({ where: { id: 'main' }, data: { liveStartEquity: st.accountValue } })
        .catch(() => {})
    }

    // adopt exchange positions not tracked locally
    for (const p of st.positions) {
      if (p.szi <= 0) continue
      const tracked = this.positions.some(
        (pos) => pos.mode === this.settings.mode && pos.coin === p.coin
      )
      if (tracked) continue
      const idleBot =
        [...this.bots.values()].find(
          (b) => !this.positions.some((pos) => pos.mode === this.settings.mode && pos.botKey === b.def.key)
        ) ?? this.bots.get('whaleTail')!
      const sizeUsd = p.positionValue || p.szi * p.entryPx
      const row = await db.trade
        .create({
          data: {
            mode: this.settings.mode,
            botKey: idleBot.def.key,
            coin: p.coin,
            sizeUsd,
            qty: p.szi,
            entryPx: p.entryPx,
            status: 'open',
            reason: 'adopted existing position',
          },
        })
        .catch(() => null)
      if (!row) continue
      this.positions.push({
        tradeId: row.id,
        botKey: idleBot.def.key,
        coin: p.coin,
        qty: p.szi,
        sizeUsd,
        entryPx: p.entryPx,
        peakPct: Math.max(0, p.unrealizedPnl / (p.positionValue || 1)) * 100,
        lastPnlPct: p.positionValue > 0 ? (p.unrealizedPnl / p.positionValue) * 100 : 0,
        lastPnlUsd: p.unrealizedPnl,
        riskUsd: 0, // re-derived below from the live plan
        openedAt: Date.now(),
        mode: this.settings.mode,
        reason: 'adopted existing position',
        adopted: true,
        plan: this.exitPlan(idleBot.def, p.coin),
      })
      const adopted = this.positions[this.positions.length - 1]
      adopted.riskUsd = stressedRiskOfPosition(sizeUsd, p.entryPx, adopted.plan.slPx)
      this.risk.reserve(row.id, { riskUsd: adopted.riskUsd, mode: this.settings.mode })
      idleBot.state.thought = `adopted $${p.coin} from the exchange`
      idleBot.state.thoughtAt = Date.now()
    }

    // update tracked positions from exchange data
    for (const pos of [...this.positions]) {
      if (pos.mode !== this.settings.mode) continue
      const ex = st.positions.find((p) => p.coin === pos.coin && p.szi > 0)
      if (ex) {
        pos.lastPnlPct = ex.positionValue > 0 ? (ex.unrealizedPnl / ex.positionValue) * 100 : 0
        pos.lastPnlUsd = ex.unrealizedPnl
        pos.peakPct = Math.max(pos.peakPct, pos.lastPnlPct)
        if (ex.entryPx > 0) pos.entryPx = ex.entryPx
        if (ex.szi > 0) pos.qty = ex.szi
      } else if (Date.now() - pos.openedAt > 20_000) {
        // position vanished on the exchange (closed externally)
        await this.finalizeClose(pos, 'closed on exchange', ex?.entryPx ?? null, this.unrealizedFor(pos).pnl)
      }
    }
  }

  // ---------------- position management ----------------

  private async managePositions(now: number) {
    for (const pos of [...this.positions]) {
      if (pos.mode !== this.settings.mode) continue
      const def = crewDef(pos.botKey)

      if (pos.mode === 'sim') {
        const mark = this.market.mid(pos.coin)
        if (mark == null) continue
      }

      // one mark-to-market path for every mode → UI, equity and exits all agree
      const u = this.unrealizedFor(pos)
      pos.lastPnlPct = u.pnlPct
      pos.lastPnlUsd = u.pnl
      pos.peakPct = Math.max(pos.peakPct, u.pnlPct)

      const age = (now - pos.openedAt) / 1000
      const { tpPx, slPx, trailPx, timeStopSec } = pos.plan

      // a position that has shown ≥ half its TP target is a “runner”:
      // the timer no longer applies — it rides the trailing stop instead
      const isRunner = pos.peakPct >= tpPx * 0.5

      let exitReason: string | null = null
      if (pos.lastPnlPct >= tpPx) exitReason = 'take profit'
      else if (pos.lastPnlPct <= -slPx) exitReason = 'stop loss'
      else if (isRunner && pos.lastPnlPct <= pos.peakPct - trailPx)
        exitReason = 'trailing stop'
      else if (!isRunner && age >= timeStopSec) exitReason = 'time stop'

      // margin guard (SIM honesty): never let a sim loss exceed ~92% of margin
      if (
        !exitReason &&
        pos.mode === 'sim' &&
        this.settings.leverage > 1 &&
        u.pnl <= -(pos.sizeUsd / this.settings.leverage) * 0.92
      )
        exitReason = 'liquidation guard'

      if (exitReason) await this.closePosition(pos, exitReason)
    }
  }

  private async closePosition(pos: OpenPosition, reason: string) {
    const network = this.liveNetwork()
    let exitPx: number | null = null
    let pnl = 0

    if (pos.mode === 'sim') {
      exitPx = this.market.mid(pos.coin) ?? pos.entryPx
      pnl = this.unrealizedFor(pos).pnl
    } else if (network && this.settings.privateKey) {
      const res = await liveMarketClose(
        network,
        this.settings.privateKey,
        this.settings.walletAddress,
        pos.coin
      )
      if (!res.ok) {
        const rt = this.bots.get(pos.botKey)
        if (rt) {
          rt.state.thought = `couldn't close $${pos.coin}: ${res.error?.slice(0, 40) ?? 'exchange error'}`
          rt.state.thoughtAt = Date.now()
          rt.cooldownUntil = Date.now() + 30_000
        }
        return
      }
      pnl = this.unrealizedFor(pos).pnl
      exitPx = this.market.mid(pos.coin) ?? pos.entryPx
    } else {
      return
    }

    await this.finalizeClose(pos, reason, exitPx, pnl)
  }

  private async finalizeClose(pos: OpenPosition, reason: string, exitPx: number | null, pnl: number) {
    this.positions = this.positions.filter((p) => p.tradeId !== pos.tradeId)
    this.risk.release(pos.tradeId)
    const def = crewDef(pos.botKey)
    const pnlPct = pos.sizeUsd > 0 ? (pnl / pos.sizeUsd) * 100 : 0
    // R-multiple: result measured against the risk actually budgeted at entry
    // (desk-post-trade-review: grade the trade in R, not in vibes)
    const rMult = pos.riskUsd > 0 ? pnl / pos.riskUsd : null
    const closedAt = new Date()

    await db.trade
      .update({
        where: { id: pos.tradeId },
        data: { status: 'closed', exitPx, pnl, pnlPct, exitReason: reason, closedAt },
      })
      .catch(() => {})

    // stats — tiny breakeven trades count as a "scratch" (neither win nor loss)
    const isScratch = Math.abs(pnlPct) < SCRATCH_PCT
    const stats = this.botStats[pos.mode] ?? this.botStats.sim
    const cur = stats[pos.botKey] ?? { pnl: 0, wins: 0, losses: 0 }
    cur.pnl += pnl
    if (!isScratch) {
      if (pnl > 0) cur.wins++
      else if (pnl < 0) cur.losses++
    }
    stats[pos.botKey] = cur

    const rt = this.bots.get(pos.botKey)
    if (rt) {
      rt.state.pnl = this.settings.mode === pos.mode ? cur.pnl : rt.state.pnl
      rt.state.wins = this.settings.mode === pos.mode ? cur.wins : rt.state.wins
      rt.state.losses = this.settings.mode === pos.mode ? cur.losses : rt.state.losses
      rt.lastActiveAt = Date.now()
      const cd =
        pnl > 0
          ? rand(def.winCooldown[0], def.winCooldown[1])
          : rand(def.lossCooldown[0], def.lossCooldown[1])
      rt.cooldownUntil = Date.now() + cd * 1000
      rt.state.thought = isScratch
        ? `flat on $${pos.coin} · ${reason}`
        : pnl >= 0
          ? `banked +${pnlPct.toFixed(1)}% on $${pos.coin}${rMult != null ? ` (+${rMult.toFixed(2)}R)` : ''}`
          : `cut ${pnlPct.toFixed(1)}% on $${pos.coin}${rMult != null ? ` (${rMult.toFixed(2)}R)` : ''}`
      rt.state.thoughtAt = Date.now()
    }

    // streak (current mode only)
    if (pos.mode === this.settings.mode && !isScratch) {
      if (pnl > 0) {
        this.streak++
        if (this.streak >= this.nextStreakMilestone) {
          this.notify({
            kind: 'streak',
            title: `Hot streak: ${this.streak} wins in a row`,
            body: `${this.streak} wins across the crew · keep it rolling`,
            bigValue: String(this.streak),
          })
          this.nextStreakMilestone =
            STREAK_MILESTONES.find((m) => m > this.streak) ?? this.nextStreakMilestone + 50
        }
      } else if (pnl < 0) {
        this.streak = 0
        this.nextStreakMilestone = STREAK_MILESTONES[0]
      }

      if (pnlPct >= 3.5) {
        this.notify({
          kind: 'bigwin',
          botKey: pos.botKey,
          title: `${def.name} banked +${pnlPct.toFixed(0)}% on $${pos.coin}`,
          body: `${reason} · ${pos.coin} · held ${((closedAt.getTime() - pos.openedAt) / 1000).toFixed(0)}s`,
          bigValue: `+${pnlPct.toFixed(0)}%`,
        })
      }
    }

    // closed cache
    this.closedCache.unshift({
      id: pos.tradeId,
      botKey: pos.botKey,
      botName: def.name,
      botColor: def.color,
      coin: pos.coin,
      side: 'long',
      sizeUsd: pos.sizeUsd,
      entryPx: pos.entryPx,
      exitPx,
      pnl,
      pnlPct,
      riskUsd: pos.riskUsd,
      status: 'closed',
      reason: pos.reason,
      exitReason: reason,
      openedAt: pos.openedAt,
      closedAt: closedAt.getTime(),
      heldSec: (closedAt.getTime() - pos.openedAt) / 1000,
      mode: pos.mode,
    })
    this.closedCache = this.closedCache.slice(0, 40)
  }

  // ---------------- entries ----------------

  private async tryEntries(now: number) {
    if (!this.settings.running || !this.market.feedOk) return
    // three-state monitoring: a stale feed is UNAVAILABLE, never a quiet all-clear
    if (now - this.market.lastUpdateAt > 15_000) return
    const equity = this.currentEquity()
    const openForMode = this.positions.filter((p) => p.mode === this.settings.mode)
    if (openForMode.length >= MAX_OPEN) return
    const heldCoins = new Set(openForMode.map((p) => p.coin))

    // correlated-cluster caps: majors/memes/l1s/defi are each ONE risk
    const clusterCount = new Map<string, number>()
    for (const p of openForMode) {
      const c = clusterOf(p.coin)
      clusterCount.set(c, (clusterCount.get(c) ?? 0) + 1)
    }

    const bots = [...this.bots.values()].sort(() => Math.random() - 0.5)
    for (const rt of bots) {
      if (openForMode.length >= MAX_OPEN) break
      if (now < rt.cooldownUntil) continue
      if (openForMode.some((p) => p.botKey === rt.def.key)) continue

      const idleSec = (now - rt.lastActiveAt) / 1000
      const bored = idleSec > 90
      const sig = evaluateSignal(rt.def, this.market, bored)
      if (!sig || heldCoins.has(sig.coin)) continue

      // cluster gate — the book is risked as a whole, not per-trade
      const cl = clusterOf(sig.coin)
      if ((clusterCount.get(cl) ?? 0) >= CEILINGS.maxPerCluster) {
        continue
      }

      // reservation gate — open + pending + candidate share one budget
      const maxCandidate = (equity * this.risk.limits.maxRiskPct) / 100
      const gate = this.risk.canOpen(equity, this.settings.mode, maxCandidate)
      if (!gate.ok) {
        if (this.risk.isLatched()) break // whole desk paused — stop asking
        continue
      }

      const ok = await this.openPosition(rt, sig)
      if (ok) {
        heldCoins.add(sig.coin)
        clusterCount.set(cl, (clusterCount.get(cl) ?? 0) + 1)
        openForMode.push(this.positions[this.positions.length - 1])
      }
    }
  }

  private async openPosition(rt: BotRuntime, sig: Signal): Promise<boolean> {
    const equity = this.currentEquity()
    const mid = this.market.mid(sig.coin)
    if (mid == null || mid <= 0) return false

    const plan = this.exitPlan(rt.def, sig.coin)
    const spread = this.market.spreadPct(sig.coin)

    // ---- HyperGrok stressed-stop sizing: THE STOP DEFINES THE SIZE ----
    // notional sized so a stop hit (slipped fill + taker fees on both legs)
    // costs ≈ maxRiskPct of equity — never sized from margin or hope
    const riskSized = stressedStopSize({
      equity,
      maxRiskPct: this.risk.limits.maxRiskPct,
      entryPx: mid,
      stopPct: plan.slPx,
      spreadPct: spread,
    })
    let sizeUsd = riskSized.sizeUsd

    // exposure ceilings on top of the risk-based size:
    // user's margin × leverage cap, per-coin exchange max leverage is about
    // MARGIN rules (not sizing), liquidity cap, exchange sanity cap
    const margin = Math.min(equity, Math.max(5, equity * this.settings.positionPct))
    const maxLev = this.market.maxLeverageOf(sig.coin)
    const leverage = Math.min(20, maxLev, Math.max(1, Math.round(this.settings.leverage)))
    const exposureCap = margin * leverage
    const vol24 = this.market.volumeUsd24h(sig.coin)
    const liqCap = vol24 > 0 ? Math.floor(vol24 * 0.001) : 25000
    sizeUsd = Math.min(sizeUsd, exposureCap, liqCap, 25000)

    if (sizeUsd < MIN_TRADE_USD) {
      rt.state.thought =
        riskSized.sizeUsd < MIN_TRADE_USD
          ? `$${sig.coin}: risk budget too small for its stop`
          : `$${sig.coin} too thin to trade safely`
      rt.state.thoughtAt = Date.now()
      rt.cooldownUntil = Date.now() + 60_000
      return false
    }

    // actual stressed risk after caps (may be smaller than the budget — fine,
    // a trade may risk LESS than allowed, never more)
    const riskUsd = Math.min(
      stressedRiskOfPosition(sizeUsd, mid, plan.slPx, spread),
      (equity * this.risk.limits.maxRiskPct) / 100
    )

    let qty = sizeUsd / mid
    let entryPx = mid

    if (this.settings.mode !== 'sim') {
      const network = this.liveNetwork()
      if (!network || !this.settings.privateKey) return false
      qty = await roundQty(sig.coin, qty)
      if (qty <= 0 || qty * mid < 10) {
        rt.state.thought = `$${sig.coin} order too small for the exchange`
        rt.state.thoughtAt = Date.now()
        rt.cooldownUntil = Date.now() + 60_000
        return false
      }
      const res = await liveMarketOpen(
        network,
        this.settings.privateKey,
        this.settings.walletAddress,
        sig.coin,
        qty
      )
      if (!res.ok) {
        rt.state.thought = `order rejected: ${res.error?.slice(0, 36) ?? 'exchange error'}`
        rt.state.thoughtAt = Date.now()
        rt.cooldownUntil = Date.now() + 45_000
        return false
      }
      entryPx = res.avgPx ?? mid
      sizeUsd = qty * entryPx
    }

    const reason = `${leverage}× · ${sig.reason}`
    const row = await db.trade
      .create({
        data: {
          mode: this.settings.mode,
          botKey: rt.def.key,
          coin: sig.coin,
          sizeUsd,
          qty,
          entryPx,
          riskUsd,
          status: 'open',
          reason,
        },
      })
      .catch((e) => {
        console.error(
          '[engine] trade create failed:',
          e instanceof Error ? e.message.split('\n')[0] : e
        )
        return null
      })
    if (!row) return false

    this.positions.push({
      tradeId: row.id,
      botKey: rt.def.key,
      coin: sig.coin,
      qty,
      sizeUsd,
      entryPx,
      peakPct: 0,
      lastPnlPct: 0,
      riskUsd,
      openedAt: Date.now(),
      mode: this.settings.mode,
      reason,
      adopted: false,
      plan,
    })
    // reserve the stressed risk in the ledger the moment the position exists
    this.risk.reserve(row.id, { riskUsd, mode: this.settings.mode })

    rt.state.thought = `in $${sig.coin} · ${leverage}× · ${sig.reason}`
    rt.state.thoughtAt = Date.now()
    rt.lastActiveAt = Date.now()
    return true
  }

  // ---------------- equity & thoughts ----------------

  private sampleEquity(now: number) {
    const equity = this.currentEquity()
    this.equityPoints.push({ ts: now, equity })
    if (this.equityPoints.length > 240) this.equityPoints.splice(0, this.equityPoints.length - 240)

    if (now - this.lastEquityPersistAt > 30_000) {
      this.lastEquityPersistAt = now
      db.equityPoint
        .create({ data: { mode: this.settings.mode, equity } })
        .catch(() => {})
      // prune old points (keep ~2000 per mode)
      db.equityPoint
        .deleteMany({
          where: {
            mode: this.settings.mode,
            createdAt: { lt: new Date(now - 90 * 60_000) },
          },
        })
        .catch(() => {})
    }

    // goal reached?
    const start = this.startingEquityForDisplay()
    const mult = start > 0 ? equity / start : 1
    if (mult >= this.settings.goalMultiple && !this.goalNotified && start > 0) {
      this.goalNotified = true
      const wins = Object.values(this.botStats[this.settings.mode] ?? {}).reduce((a, s) => a + s.wins, 0)
      this.notify({
        kind: 'goal',
        title: `Goal reached: ${this.settings.goalMultiple}×`,
        body: `${Math.round(start).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} → ${Math.round(equity).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} · ${wins} wins across the crew`,
        bigValue: `${this.settings.goalMultiple}×`,
      })
    }
    if (mult < this.settings.goalMultiple * 0.95) this.goalNotified = false
  }

  private rotateThoughts(now: number) {
    for (const rt of this.bots.values()) {
      const holding = this.positions.some((p) => p.mode === this.settings.mode && p.botKey === rt.def.key)
      if (holding) continue
      if (now < rt.cooldownUntil) continue
      if (now < rt.nextScanThoughtAt) continue
      rt.nextScanThoughtAt = now + rand(18000, 42000)
      const pool = rt.def.scanningThoughts
      rt.state.thought = pool[Math.floor(Math.random() * pool.length)]
      rt.state.thoughtAt = now
    }
  }

  private updateBotStatuses(now: number) {
    for (const rt of this.bots.values()) {
      const holding = this.positions.find((p) => p.mode === this.settings.mode && p.botKey === rt.def.key)
      if (holding) {
        const u = this.unrealizedFor(holding)
        rt.state.status = 'holding'
        rt.state.holding = {
          coin: holding.coin,
          pnlPct: u.pnlPct,
          sizeUsd: holding.sizeUsd,
          since: holding.openedAt,
        }
      } else {
        rt.state.holding = null
        if (now < rt.cooldownUntil) rt.state.status = 'cooling'
        else rt.state.status = this.settings.running ? 'scanning' : 'paused'
      }
    }
  }

  // ---------------- public API ----------------

  async applySettings(payload: {
    mode: TradeMode
    botName: string
    startingEquity: number
    goalMultiple: number
    leverage?: number
    positionPct?: number
    riskProfile?: string
    maxRiskPct?: number
    maxTotalRiskPct?: number
    dailyLossStopPct?: number
    privateKey?: string
    walletAddress?: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const mode = payload.mode
    if (!['sim', 'testnet', 'mainnet'].includes(mode)) {
      return { ok: false, error: 'Mode tidak valid' }
    }
    const profile = (payload.riskProfile ?? this.settings.riskProfile) as RiskProfile
    if (!['chill', 'balanced', 'turbo'].includes(profile)) {
      return { ok: false, error: 'Risk profile tidak valid' }
    }

    let privateKey = this.settings.privateKey
    let walletAddress = payload.walletAddress?.trim() || this.settings.walletAddress

    if (mode !== 'sim') {
      const newKey = payload.privateKey?.trim()
      if (newKey) {
        if (!validatePrivateKey(newKey)) {
          return { ok: false, error: 'Private key tidak valid (harus 0x + 64 hex)' }
        }
        privateKey = newKey
      }
      if (!privateKey) {
        return { ok: false, error: 'Private key wajib diisi untuk mode live' }
      }
      if (!walletAddress) walletAddress = deriveAddress(privateKey)
    }

    const modeChanged = mode !== this.settings.mode
    this.settings.mode = mode
    this.settings.botName = payload.botName
    this.settings.startingEquity = Math.max(10, payload.startingEquity)
    this.settings.goalMultiple = Math.min(5, Math.max(1.05, payload.goalMultiple))
    this.settings.leverage = Math.min(20, Math.max(1, Math.round(payload.leverage ?? this.settings.leverage)))
    this.settings.positionPct = Math.min(1, Math.max(0.05, payload.positionPct ?? this.settings.positionPct))
    this.settings.riskProfile = profile
    // risk limits: clamped INTO the hard ceilings — a config may only tighten
    const limits = clampLimits({
      maxRiskPct: payload.maxRiskPct ?? this.settings.maxRiskPct,
      maxTotalRiskPct: payload.maxTotalRiskPct ?? this.settings.maxTotalRiskPct,
      dailyLossStopPct: payload.dailyLossStopPct ?? this.settings.dailyLossStopPct,
    })
    this.settings.maxRiskPct = limits.maxRiskPct
    this.settings.maxTotalRiskPct = limits.maxTotalRiskPct
    this.settings.dailyLossStopPct = limits.dailyLossStopPct
    this.risk.setLimits(limits)
    this.settings.privateKey = privateKey
    this.settings.walletAddress = walletAddress ?? null

    if (modeChanged && mode !== 'sim') {
      this.settings.liveStartEquity = null
      this.liveAccountValue = null
    }
    if (modeChanged) {
      this.goalNotified = false
      this.recomputeStreak()
      this.refreshCrewFromStats()
      await this.reloadEquityPoints().catch(() => {})
    }

    await db.settings
      .update({
        where: { id: 'main' },
        data: {
          mode: this.settings.mode,
          botName: this.settings.botName,
          startingEquity: this.settings.startingEquity,
          goalMultiple: this.settings.goalMultiple,
          leverage: this.settings.leverage,
          positionPct: this.settings.positionPct,
          riskProfile: this.settings.riskProfile,
          maxRiskPct: this.settings.maxRiskPct,
          maxTotalRiskPct: this.settings.maxTotalRiskPct,
          dailyLossStopPct: this.settings.dailyLossStopPct,
          privateKey,
          walletAddress: this.settings.walletAddress,
          liveStartEquity: this.settings.liveStartEquity,
        },
      })
      .catch(() => {})

    return { ok: true }
  }

  async control(action: string, ids?: string[]) {
    switch (action) {
      case 'pause':
        this.settings.running = false
        await db.settings.update({ where: { id: 'main' }, data: { running: false } }).catch(() => {})
        break
      case 'resume':
        this.settings.running = true
        await db.settings.update({ where: { id: 'main' }, data: { running: true } }).catch(() => {})
        break
      case 'closeAll': {
        const open = this.positions.filter((p) => p.mode === this.settings.mode)
        for (const pos of open) {
          await this.closePosition(pos, 'manual close')
        }
        break
      }
      case 'resetSim': {
        await db.trade.deleteMany({ where: { mode: 'sim' } })
        await db.equityPoint.deleteMany({ where: { mode: 'sim' } })
        this.botStats.sim = {}
        this.positions = this.positions.filter((p) => p.mode !== 'sim')
        this.closedCache = this.closedCache.filter((t) => t.mode !== 'sim')
        this.equityPoints = []
        this.streak = 0
        this.goalNotified = false
        this.rebuildLedger()
        this.risk.reset() // a fresh SIM start also clears the daily latch
        this.refreshCrewFromStats()
        for (const rt of this.bots.values()) {
          rt.cooldownUntil = 0
          rt.lastActiveAt = Date.now()
          rt.state.thought = 'fresh start — scanning…'
          rt.state.thoughtAt = Date.now()
        }
        break
      }
      case 'resetDailyStop':
        this.risk.reset()
        this.riskLatchNotified = false
        this.riskWarn80Notified = false
        this.notify({ kind: 'info', title: 'Daily stop reset', body: 'Risk desk open — the crew may take new trades again.' })
        break
      case 'seen':
        if (ids) for (const id of ids) this.unseenIds.delete(id)
        break
    }
  }

  /** rebuild ledger reservations from live positions (after init/reset/close-all) */
  private rebuildLedger() {
    this.risk.clear()
    for (const p of this.positions) {
      const riskUsd =
        p.riskUsd > 0 ? p.riskUsd : stressedRiskOfPosition(p.sizeUsd, p.entryPx, p.plan.slPx)
      p.riskUsd = riskUsd
      this.risk.reserve(p.tradeId, { riskUsd, mode: p.mode })
    }
  }

  snapshot(): EngineSnapshot {
    const mode = this.settings.mode
    const start = this.startingEquityForDisplay()
    const equity = this.currentEquity()
    const pnl = equity - start
    const stats = this.botStats[mode] ?? this.botStats.sim
    let wins = 0
    let losses = 0
    for (const s of Object.values(stats)) {
      wins += s.wins
      losses += s.losses
    }
    const tradesClosed = wins + losses

    const openRows: TradeRow[] = this.positions
      .filter((p) => p.mode === mode)
      .map((p) => {
        const def = crewDef(p.botKey)
        const u = this.unrealizedFor(p)
        return {
          id: p.tradeId,
          botKey: p.botKey,
          botName: def.name,
          botColor: def.color,
          coin: p.coin,
          side: 'long',
          sizeUsd: p.sizeUsd,
          entryPx: p.entryPx,
          exitPx: null,
          pnl: u.pnl,
          pnlPct: u.pnlPct,
          riskUsd: p.riskUsd,
          status: 'open' as const,
          reason: p.reason,
          exitReason: null,
          openedAt: p.openedAt,
          closedAt: null,
          heldSec: null,
          mode: p.mode,
        }
      })

    const trades = [...openRows, ...this.closedCache.filter((t) => t.mode === mode)]
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, 30)

    // downsample equity curve to ~140 points
    const curve = this.equityPoints
    const step = Math.max(1, Math.ceil(curve.length / 140))
    const equityCurve = curve.filter((_, i) => i % step === 0 || i === curve.length - 1)

    return {
      ts: Date.now(),
      feedOk: this.market.feedOk,
      mode,
      running: this.settings.running,
      botName: this.settings.botName,
      walletAddress: this.settings.walletAddress,
      startingEquity: start,
      equity,
      pnl,
      pnlPct: start > 0 ? (pnl / start) * 100 : 0,
      multiple: start > 0 ? equity / start : 1,
      streak: this.streak,
      tradesClosed,
      wins,
      losses,
      winRate: tradesClosed > 0 ? wins / tradesClosed : 0,
      leverage: this.settings.leverage,
      positionPct: this.settings.positionPct,
      riskProfile: this.settings.riskProfile,
      risk: {
        perTradePct: this.risk.limits.maxRiskPct,
        totalPct: this.risk.limits.maxTotalRiskPct,
        dailyStopPct: this.risk.limits.dailyLossStopPct,
        openRiskUsd: this.risk.openRiskUsd(mode),
        openRiskPct: this.risk.openRiskPct(equity, mode),
        dailyStopUsage: this.risk.dailyStopUsage(equity),
        latched: this.risk.isLatched(),
        latchedReason: this.risk.latchReason(),
      },
      goal: { target: this.settings.goalMultiple, done: equity / (start || 1) >= this.settings.goalMultiple },
      equityCurve,
      crew: [...this.bots.values()].map((rt) => {
        // a bot's live P&L = realized + its open position's unrealized P&L
        // → crew cards, the trades list and the equity header all tie out exactly
        const holding = this.positions.find(
          (p) => p.mode === mode && p.botKey === rt.def.key
        )
        const openPnl = holding ? this.unrealizedFor(holding).pnl : 0
        return { ...rt.state, pnl: rt.state.pnl + openPnl, openPnl }
      }),
      trades,
      notifications: this.notifications.filter((n) => this.unseenIds.has(n.id)).slice(0, 5),
      openCount: openRows.length,
      liveAccountValue: this.liveAccountValue,
      pairsCount: this.market.pairsCount,
      ticker: this.market.ticker,
    }
  }
}

const g = globalThis as unknown as { __grokEngine?: Engine }

export function ensureEngine(): Engine {
  if (!g.__grokEngine) {
    g.__grokEngine = new Engine()
    g.__grokEngine.init().catch((e) => console.error('[engine] init error:', e))
  }
  return g.__grokEngine
}
