// The trading engine: 5 autonomous agent bots trading the Hyperliquid universe.
// SIM mode = paper fills at live mainnet prices.
// LIVE modes = real signed orders via the official Hyperliquid SDK.

import { db } from '@/lib/db'
import { CREW, crewDef, type CrewDef } from './crew'
import { MarketData } from './market'
import { evaluateSignal, type Signal, type TradeSide } from './strategies'
import { rejectReason, verdict, kindOf } from './brain'
import {
  CEILINGS,
  RiskLedger,
  TAKER_FEE,
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

/** regime labels for bot speech (Bahasa Indonesia) */
const REGIME_ID: Record<ExitPlan['regime'], string> = {
  trending: 'tren',
  ranging: 'sideways',
  manual: 'manual',
}

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
 * entry so a TP on calm BTC isn't the same distance as on FARTCOIN.
 * regime: 'trending' (targets widened — let winners run) | 'ranging'
 * (targets tightened — grab profit fast) | 'manual' (user-fixed TP/SL). */
interface ExitPlan {
  tpPx: number
  slPx: number
  trailPx: number
  timeStopSec: number
  regime: 'trending' | 'ranging' | 'manual'
  auto: boolean
}

interface OpenPosition {
  tradeId: string
  botKey: BotKey
  coin: string
  side: TradeSide // long = buy first, short = sell first (profits when price falls)
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
  /** once-only time-stop extension for trades that are working but need time */
  timeExtended?: boolean
}

interface BotStats {
  pnl: number
  wins: number
  losses: number
}

/** per-agent form memory — the desk learns which agent is hot or cold */
interface AgentForm {
  consecLoss: number
  consecWin: number
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
  /** adaptive exit engine: TP/SL computed per-trade from live ATR + regime */
  autoExit: boolean
  /** manual fixed targets, used when autoExit = false */
  tpPct: number
  slPct: number
  /** allow SHORT entries (profit when a coin falls) — off = long-only */
  allowShort: boolean
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
    autoExit: true,
    tpPct: 1.2,
    slPct: 0.6,
    allowShort: true,
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
  /** loss memory: coin → blocked-until. A coin that just stopped us out stays
   * off-limits for a while — re-entering a loser is how small losses compound */
  private coinBlock = new Map<string, number>()
  /** agent form (consecutive wins/losses, current mode) → adaptive score boost */
  private form = new Map<BotKey, AgentForm>()
  /** brain activity counters, reset on a rolling 5-min window */
  private smart = { scans: 0, vetoes: 0, entries: 0, windowStart: Date.now() }
  /** desk-wide entry pacing — no second entry until this timestamp (burst dampener) */
  private nextEntryAt = 0
  private lastVetoThoughtAt = new Map<BotKey, number>()
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
      autoExit: s.autoExit ?? true,
      tpPct: s.tpPct ?? 1.2,
      slPct: s.slPct ?? 0.6,
      allowShort: s.allowShort ?? true,
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
          score: null,
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
        side: (t.side === 'short' ? 'short' : 'long') as TradeSide,
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
      side: string
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
      side: t.side === 'short' ? 'short' : 'long',
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
   * Adaptive exit plan (all numbers are price-move %).
   *
   * AUTO (autoExit = true) — "target profit otomatis, ikut karakter market":
   *  - base distance from live ATR (a TP on calm BTC ≠ FARTCOIN) scaled by the
   *    hold-window horizon, capped by the bot's personality ceiling
   *  - REGIME scaling via Kaufman ER (market.regime):
   *      trending → TP ×1.45, trail ×1.2, timeStop ×1.5  (let winners run)
   *      ranging  → TP ×0.78, trail ×0.85, timeStop ×0.8 (grab profit fast)
   *  - stop distance stays pure-volatility — the disaster stop is not loosened
   *    by a trend, and not tightened into chop whipsaw
   *  - MANAGE-TIME ladder (managePositions): breakeven lock at 55% of TP
   *    ("kunci BEP" — worst case becomes a scratch, never a full stop), trail
   *    width floored at 0.24% so 1m noise can't knock winners out for free
   *
   * MANUAL (autoExit = false) — the user's fixed tpPct/slPct, trail = profile
   * fraction of TP. Targets only, discipline identical.
   */
  private exitPlan(def: CrewDef, coin: string): ExitPlan {
    const prof = PROFILES[this.settings.riskProfile] ?? PROFILES.balanced
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

    if (!this.settings.autoExit) {
      const tp = clamp(this.settings.tpPct, 0.1, 30)
      const sl = clamp(this.settings.slPct, 0.05, 15)
      return {
        tpPx: tp,
        slPx: sl,
        trailPx: Math.max(0.2, tp * prof.trailFrac),
        timeStopSec: prof.timeStop,
        regime: 'manual',
        auto: false,
      }
    }

    const vol = this.market.atrPct(coin, 14) ?? 0.18 // % per 1m candle
    const horizon = Math.sqrt(prof.timeStop / 60) // diffusion-style time scaling
    const reg = this.market.regime(coin)
    const trending = reg?.kind === 'trending'
    const tpReg = trending ? 1.45 : 0.78
    const trailReg = trending ? 1.2 : 0.85
    // ranging ×0.8 was the "habis waktu" factory: 14/28 exits died at the bell
    // (~3 min) — a ranging market needs MORE time for its edge to play out,
    // not less. ×1.1 gives mean reversion room while winners still extend.
    const timeReg = trending ? 1.5 : 1.1
    const tpBase = clamp(1.7 * horizon * vol, 0.3, def.exit.tp * prof.tpMul)
    const slBase = clamp(1.15 * horizon * vol, 0.18, def.exit.sl * prof.slMul)
    // R:R floor — the data autopsy showed ranging TP ×0.78 with an unchanged SL
    // collapsed payoff to ~1.16:1, needing a 46% win rate while the desk ran
    // 36%. A trade whose target is smaller than 1.5× its stop is a fee donation.
    const tpPx = Math.max(
      clamp(tpBase * tpReg, 0.2, def.exit.tp * prof.tpMul * 1.6),
      slBase * 1.5
    )
    return {
      tpPx,
      slPx: slBase,
      trailPx: Math.max(0.22, prof.trailFrac * tpBase * trailReg),
      timeStopSec: Math.round(prof.timeStop * timeReg),
      regime: reg ? reg.kind : 'ranging', // no candle data yet → conservative ranging
      auto: true,
    }
  }

  private unrealizedFor(pos: OpenPosition): { pnl: number; pnlPct: number } {
    if (pos.mode === 'sim') {
      const mark = this.market.mid(pos.coin) ?? pos.entryPx
      // paper fills happen at the live mid with no fees — keeps the demo honest
      // long: profit when mark > entry · short: profit when mark < entry
      const pnl = pos.qty * (pos.side === 'long' ? mark - pos.entryPx : pos.entryPx - mark)
      return { pnl, pnlPct: pos.sizeUsd > 0 ? (pnl / pos.sizeUsd) * 100 : 0 }
    }
    // live: mark-to-market from the last synced qty/entry whenever we have a fresh mid,
    // otherwise fall back to the exchange's authoritative unrealized figure
    const mid = this.market.mid(pos.coin)
    if (mid != null && pos.qty > 0) {
      const pnl = pos.qty * (pos.side === 'long' ? mid - pos.entryPx : pos.entryPx - mid)
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
        title: 'Daily stop kena — tanpa risiko baru',
        body: `Turun ${Math.abs(this.risk.dailyLossPct(modeEquity)).toFixed(1)}% hari ini. Exit & proteksi tetap jalan; entry baru berhenti sampai daily stop direset.`,
      })
    }
    if (!this.risk.isLatched() && this.riskLatchNotified) {
      this.riskLatchNotified = false
      this.notify({ kind: 'info', title: 'Meja risiko buka lagi', body: 'Daily stop direset — crew boleh ambil trade baru.' })
    }
    const usage = this.risk.dailyStopUsage(modeEquity)
    if (usage >= 0.8 && usage < 1 && !this.riskWarn80Notified) {
      this.riskWarn80Notified = true
      this.notify({
        kind: 'info',
        title: 'Mendekati daily loss stop',
        body: `${Math.round(usage * 100)}% dari daily stop −${this.risk.limits.dailyLossStopPct}% sudah terpakai. Exit tetap aktif; entry mulai jarang.`,
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

    // brain counters roll on a 5-minute window
    if (now - this.smart.windowStart > 300_000) {
      this.smart = { scans: 0, vetoes: 0, entries: 0, windowStart: now }
    }
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

    // adopt exchange positions not tracked locally (longs AND shorts)
    for (const p of st.positions) {
      if (p.szi === 0) continue
      const side: TradeSide = p.szi > 0 ? 'long' : 'short'
      const tracked = this.positions.some(
        (pos) =>
          pos.mode === this.settings.mode &&
          pos.coin === p.coin &&
          pos.side === side
      )
      if (tracked) continue
      const idleBot =
        [...this.bots.values()].find(
          (b) => !this.positions.some((pos) => pos.mode === this.settings.mode && pos.botKey === b.def.key)
        ) ?? this.bots.get('whaleTail')!
      const sizeUsd = p.positionValue || Math.abs(p.szi) * p.entryPx
      const row = await db.trade
        .create({
          data: {
            mode: this.settings.mode,
            botKey: idleBot.def.key,
            coin: p.coin,
            side,
            sizeUsd,
            qty: Math.abs(p.szi),
            entryPx: p.entryPx,
            status: 'open',
            reason: 'adopsi posisi yang sudah ada',
          },
        })
        .catch(() => null)
      if (!row) continue
      this.positions.push({
        tradeId: row.id,
        botKey: idleBot.def.key,
        coin: p.coin,
        side,
        qty: Math.abs(p.szi),
        sizeUsd,
        entryPx: p.entryPx,
        peakPct: Math.max(0, p.unrealizedPnl / (p.positionValue || 1)) * 100,
        lastPnlPct: p.positionValue > 0 ? (p.unrealizedPnl / p.positionValue) * 100 : 0,
        lastPnlUsd: p.unrealizedPnl,
        riskUsd: 0, // re-derived below from the live plan
        openedAt: Date.now(),
        mode: this.settings.mode,
        reason: 'adopsi posisi yang sudah ada',
        adopted: true,
        plan: this.exitPlan(idleBot.def, p.coin),
      })
      const adopted = this.positions[this.positions.length - 1]
      adopted.riskUsd = stressedRiskOfPosition(sizeUsd, p.entryPx, adopted.plan.slPx)
      this.risk.reserve(row.id, { riskUsd: adopted.riskUsd, mode: this.settings.mode })
      idleBot.state.thought = `adopsi ${side === 'short' ? 'short' : ''} $${p.coin} dari exchange`.trim()
      idleBot.state.thoughtAt = Date.now()
    }

    // update tracked positions from exchange data (match the position side too)
    for (const pos of [...this.positions]) {
      if (pos.mode !== this.settings.mode) continue
      const ex = st.positions.find((p) =>
        pos.side === 'long' ? p.coin === pos.coin && p.szi > 0 : p.coin === pos.coin && p.szi < 0
      )
      if (ex) {
        pos.lastPnlPct = ex.positionValue > 0 ? (ex.unrealizedPnl / ex.positionValue) * 100 : 0
        pos.lastPnlUsd = ex.unrealizedPnl
        pos.peakPct = Math.max(pos.peakPct, pos.lastPnlPct)
        if (ex.entryPx > 0) pos.entryPx = ex.entryPx
        if (Math.abs(ex.szi) > 0) pos.qty = Math.abs(ex.szi)
      } else if (Date.now() - pos.openedAt > 20_000) {
        // position vanished on the exchange (closed externally)
        await this.finalizeClose(pos, 'tertutup di exchange', ex?.entryPx ?? null, this.unrealizedFor(pos).pnl)
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
      // trail width has a noise floor — a trail tighter than ~0.24% gets
      // knocked out by ordinary 1m chop for zero reason (data: exits at
      // -0.10R after 2m were exactly this)
      const trail = Math.max(trailPx, 0.24)
      // breakeven lock ("kunci BEP"): once the trade has shown 55% of its
      // target, the worst case becomes a tiny fee-covered exit instead of
      // watching a winner rot into a full -1R stop loss. An extended trade
      // (given extra time at the bell) arms earlier — it already proved itself.
      const beFloor = 0.05
      const armed = pos.peakPct >= tpPx * (pos.timeExtended ? 0.3 : 0.55)
      const dynStop = Math.max(beFloor, pos.peakPct - trail)

      let exitReason: string | null = null
      if (pos.lastPnlPct >= tpPx) exitReason = 'ambil profit'
      else if (pos.lastPnlPct <= -slPx) exitReason = 'stop loss'
      else if (armed && pos.lastPnlPct <= dynStop)
        exitReason = pos.peakPct - trail > beFloor ? 'trailing stop' : 'kunci BEP'
      else if (!armed && age >= timeStopSec) {
        // HyperGrok lifecycle discipline: never decapitate a working trade at
        // the bell. If it already walked ≥30% of the way to target, extend the
        // clock ONCE (+75%) and let the BEP/trail machinery protect it. Trades
        // going nowhere still exit — dead capital is a cost too.
        if (!pos.timeExtended && pos.lastPnlPct >= tpPx * 0.3) {
          pos.timeExtended = true
          pos.plan.timeStopSec = timeStopSec + Math.round(timeStopSec * 0.75)
        } else {
          exitReason = 'habis waktu'
        }
      }

      // margin guard (SIM honesty): never let a sim loss exceed ~92% of margin
      if (
        !exitReason &&
        pos.mode === 'sim' &&
        this.settings.leverage > 1 &&
        u.pnl <= -(pos.sizeUsd / this.settings.leverage) * 0.92
      )
        exitReason = 'pengaman likuidasi'

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
          rt.state.thought = `gagal tutup $${pos.coin}: ${res.error?.slice(0, 40) ?? 'error exchange'}`
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
    // honest accounting: entry + exit are BOTH taker fills (market orders),
    // so subtract the round-trip fee. Without this the SIM quietly hides
    // ~0.09% of notional per trade — on the first 151 closed trades that
    // hidden cost was larger than the entire reported PnL.
    const feeUsd = pos.qty * (pos.entryPx + (exitPx ?? pos.entryPx)) * TAKER_FEE
    pnl -= feeUsd
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
        ? `flat di $${pos.coin} · ${reason}`
        : pnl >= 0
          ? `panen +${pnlPct.toFixed(1)}% di $${pos.coin}${rMult != null ? ` (+${rMult.toFixed(2)}R)` : ''}`
          : `potong ${pnlPct.toFixed(1)}% di $${pos.coin}${rMult != null ? ` (${rMult.toFixed(2)}R)` : ''}`
      rt.state.thoughtAt = Date.now()
    }

    // ---- learning: agent form + coin loss memory (current mode only) ----
    if (!isScratch && pos.mode === this.settings.mode) {
      const f = this.form.get(pos.botKey) ?? { consecLoss: 0, consecWin: 0 }
      if (pnl > 0) {
        f.consecWin++
        f.consecLoss = 0
      } else {
        f.consecLoss++
        f.consecWin = 0
        // loss memory: this coin just cost us — no re-entry on it for 8 minutes
        this.coinBlock.set(pos.coin, Date.now() + 8 * 60_000)
        if (this.coinBlock.size > 120) {
          const now2 = Date.now()
          for (const [c, until] of this.coinBlock) if (until < now2) this.coinBlock.delete(c)
        }
      }
      this.form.set(pos.botKey, f)
    }

    // streak (current mode only)
    if (pos.mode === this.settings.mode && !isScratch) {
      if (pnl > 0) {
        this.streak++
        if (this.streak >= this.nextStreakMilestone) {
          this.notify({
            kind: 'streak',
            title: `Panen beruntun: ${this.streak} menang berturut`,
            body: `${this.streak} menang di seluruh crew · lanjut terus!`,
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
          title: `${def.name} panen +${pnlPct.toFixed(0)}% di $${pos.coin}`,
          body: `${reason} · ${pos.coin} · tahan ${((closedAt.getTime() - pos.openedAt) / 1000).toFixed(0)}s`,
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
      side: pos.side,
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
    // desk-wide pacing: entries 10-20s apart in bursts were correlated noise
    // paying the spread twice (data: median close-to-close gap hit 5s). One
    // desk, one deliberate position at a time — HyperGrok sends a ticket, not
    // a machine gun.
    if (now < this.nextEntryAt) return
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
      // NOTE: the old "bored relax" (easier agent triggers after 90s idle, plus
      // −8 on the brain score) is GONE — the first 151 closed trades showed it
      // was responsible for the zero-edge churn: 60% of all exits were flat
      // "habis waktu" fills. Patience beats activity on a small account.
      const sig = evaluateSignal(rt.def, this.market)
      if (!sig) {
        // rare idle whisper so a quiet desk doesn't look frozen (rate-limited)
        if (idleSec > 240 && now - (this.lastVetoThoughtAt.get(rt.def.key) ?? 0) > 20_000) {
          this.lastVetoThoughtAt.set(rt.def.key, now)
          rt.state.thought = 'tidak ada setup layak — menunggu, bukan memaksa'
          rt.state.thoughtAt = now
        }
        continue
      }
      if (heldCoins.has(sig.coin)) continue
      // user gate: short entries off → long-only mode
      if (sig.side === 'short' && !this.settings.allowShort) continue

      // loss memory — a coin that just stopped us out is off-limits for a while
      if (now < (this.coinBlock.get(sig.coin) ?? 0)) continue

      // ---- the entry brain: confluence gate on every candidate ----
      const f = this.form.get(rt.def.key)
      // losing streak → pickier (needs a higher score); 3+ wins → a little bolder.
      // momentum carries a permanent +6: the first 151 closed trades showed a
      // 32% win rate and the worst PnL of the crew — it must clear a higher bar.
      const boost =
        (f ? (f.consecLoss > 0 ? Math.min(15, f.consecLoss * 5) : f.consecWin >= 3 ? -5 : 0) : 0) +
        (rt.def.key === 'momentum' ? 6 : 0)
      const v = verdict(sig.coin, this.market, kindOf(rt.def.key), sig.side, { bored: false, boost })
      this.smart.scans++
      if (!v.ok) {
        this.smart.vetoes++
        // whisper the rejection (rate-limited) — the crew shows its reasoning live
        if (now - (this.lastVetoThoughtAt.get(rt.def.key) ?? 0) > 12_000) {
          this.lastVetoThoughtAt.set(rt.def.key, now)
          rt.state.thought = `$${sig.coin} dilewati · ${rejectReason(v)}`
          rt.state.thoughtAt = now
        }
        continue
      }
      this.smart.entries++

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

      const ok = await this.openPosition(rt, sig, v)
      if (ok) {
        heldCoins.add(sig.coin)
        clusterCount.set(cl, (clusterCount.get(cl) ?? 0) + 1)
        openForMode.push(this.positions[this.positions.length - 1])
        this.nextEntryAt = now + 30_000 // desk-wide breathing room after every open
      }
    }
  }

  private async openPosition(rt: BotRuntime, sig: Signal, v: ReturnType<typeof verdict>): Promise<boolean> {
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
          ? `$${sig.coin}: anggaran risiko kekecilan untuk stop-nya`
          : `$${sig.coin} terlalu tipis untuk trade aman`
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
      qty = await roundQty(sig.coin, qty, network)
      if (qty <= 0 || qty * mid < 10) {
        rt.state.thought = `order $${sig.coin} terlalu kecil untuk exchange`
        rt.state.thoughtAt = Date.now()
        rt.cooldownUntil = Date.now() + 60_000
        return false
      }
      // short = market SELL order on Hyperliquid (open the position on the other side)
      const res = await liveMarketOpen(
        network,
        this.settings.privateKey,
        this.settings.walletAddress,
        sig.coin,
        qty,
        sig.side === 'long'
      )
      if (!res.ok) {
        rt.state.thought = `order ditolak: ${res.error?.slice(0, 36) ?? 'error exchange'}`
        rt.state.thoughtAt = Date.now()
        rt.cooldownUntil = Date.now() + 45_000
        return false
      }
      entryPx = res.avgPx ?? mid
      sizeUsd = qty * entryPx
    }

    const verb = sig.side === 'short' ? 'short' : 'beli'
    const reason = `${sig.side === 'short' ? 'SHORT' : 'LONG'} ${leverage}× · ${sig.reason}`
    const row = await db.trade
      .create({
        data: {
          mode: this.settings.mode,
          botKey: rt.def.key,
          coin: sig.coin,
          side: sig.side,
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
      side: sig.side,
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

    const exitTag = plan.auto
      ? `TP ${plan.tpPx.toFixed(2)}% · ${REGIME_ID[plan.regime]}`
      : `TP ${plan.tpPx.toFixed(2)}%/SL ${plan.slPx.toFixed(2)}%`
    rt.state.thought = `${verb} $${sig.coin} · ${leverage}× · ${sig.reason} · skor ${v.score} · ${exitTag}`
    rt.state.score = v.score
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
        title: `Target tercapai: ${this.settings.goalMultiple}×`,
        body: `${Math.round(start).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} → ${Math.round(equity).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} · ${wins} menang di seluruh crew`,
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
          side: holding.side,
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
    autoExit?: boolean
    tpPct?: number
    slPct?: number
    allowShort?: boolean
    maxRiskPct?: number
    maxTotalRiskPct?: number
    dailyLossStopPct?: number
    privateKey?: string
    walletAddress?: string
    /** a bundled preset package was applied → fresh SIM on save (if SIM active) */
    presetReset?: boolean
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
    // capture the config BEFORE applying, to detect what the save actually changes
    const prev = {
      lev: this.settings.leverage,
      pos: this.settings.positionPct,
      goal: this.settings.goalMultiple,
      mr: this.settings.maxRiskPct,
      tr: this.settings.maxTotalRiskPct,
      ds: this.settings.dailyLossStopPct,
    }
    // modal change (all modes share one startingEquity): a SIM modal change
    // wipes SIM history so equity starts exactly at the new modal — clean monitoring
    const newEquity = Math.max(10, Math.round(payload.startingEquity || 0) * 100) / 100
    const equityChanged = newEquity !== this.settings.startingEquity
    this.settings.mode = mode
    this.settings.botName = payload.botName
    this.settings.startingEquity = newEquity
    this.settings.goalMultiple = Math.min(5, Math.max(1.05, payload.goalMultiple))
    this.settings.leverage = Math.min(20, Math.max(1, Math.round(payload.leverage ?? this.settings.leverage)))
    this.settings.positionPct = Math.min(1, Math.max(0.05, payload.positionPct ?? this.settings.positionPct))
    this.settings.riskProfile = profile
    // adaptive exit engine: auto (ATR + regime) or manual fixed targets
    this.settings.autoExit = payload.autoExit ?? this.settings.autoExit
    this.settings.tpPct = Math.min(30, Math.max(0.1, payload.tpPct ?? this.settings.tpPct))
    this.settings.slPct = Math.min(15, Math.max(0.05, payload.slPct ?? this.settings.slPct))
    // short entries: user may turn the short side on/off
    this.settings.allowShort = payload.allowShort ?? this.settings.allowShort
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
    // modal awal berubah / paket preset diterapkan + mode SIM → reset otomatis:
    // riwayat bersih supaya hasil pantauan murni dari konfigurasi yang baru
    const presetApplied = payload.presetReset === true
    const configChanged =
      equityChanged ||
      prev.lev !== this.settings.leverage ||
      Math.abs(prev.pos - this.settings.positionPct) > 1e-9 ||
      Math.abs(prev.goal - this.settings.goalMultiple) > 1e-9 ||
      Math.abs(prev.mr - this.settings.maxRiskPct) > 1e-9 ||
      Math.abs(prev.tr - this.settings.maxTotalRiskPct) > 1e-9 ||
      Math.abs(prev.ds - this.settings.dailyLossStopPct) > 1e-9
    if (mode === 'sim' && (equityChanged || (presetApplied && configChanged))) {
      await this.resetSimInternal()
      const byPreset = presetApplied && !equityChanged
      this.notify({
        kind: 'info',
        title: byPreset ? 'Paket preset diterapkan — SIM mulai segar' : 'SIM dimulai dari modal baru',
        body: byPreset
          ? `Konfigurasi paket aktif — riwayat SIM di-reset, equity mulai $${newEquity.toFixed(0)}. Hasil pantauan sekarang murni dari paket ini.`
          : `Modal awal diganti ke $${newEquity.toFixed(0)} — riwayat SIM di-reset, equity mulai pas $${newEquity.toFixed(0)}.`,
      })
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
          autoExit: this.settings.autoExit,
          tpPct: this.settings.tpPct,
          slPct: this.settings.slPct,
          allowShort: this.settings.allowShort,
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

  /** wipe SIM history + open sim positions and start clean from the current startingEquity */
  private async resetSimInternal() {
    await db.trade.deleteMany({ where: { mode: 'sim' } })
    await db.equityPoint.deleteMany({ where: { mode: 'sim' } })
    this.botStats.sim = {}
    this.positions = this.positions.filter((p) => p.mode !== 'sim')
    this.closedCache = this.closedCache.filter((t) => t.mode !== 'sim')
    this.equityPoints = []
    this.streak = 0
    this.goalNotified = false
    this.form.clear()
    this.coinBlock.clear()
    this.lastVetoThoughtAt.clear()
    this.nextEntryAt = 0
    this.smart = { scans: 0, vetoes: 0, entries: 0, windowStart: Date.now() }
    for (const rt of this.bots.values()) rt.state.score = null
    this.rebuildLedger()
    this.risk.reset() // a fresh SIM start also clears the daily latch
    this.refreshCrewFromStats()
    for (const rt of this.bots.values()) {
      rt.cooldownUntil = 0
      rt.lastActiveAt = Date.now()
      rt.state.thought = 'mulai baru — memindai…'
      rt.state.thoughtAt = Date.now()
    }
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
          await this.closePosition(pos, 'tutup manual')
        }
        break
      }
      case 'resetSim': {
        await this.resetSimInternal()
        break
      }
      case 'resetDailyStop':
        this.risk.reset()
        this.riskLatchNotified = false
        this.riskWarn80Notified = false
        this.notify({ kind: 'info', title: 'Daily stop direset', body: 'Meja risiko buka — crew boleh ambil trade baru lagi.' })
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
          side: p.side,
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
      autoExit: this.settings.autoExit,
      tpPct: this.settings.tpPct,
      slPct: this.settings.slPct,
      allowShort: this.settings.allowShort,
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
      // live proof that targets adapt to the market: top-volume coins, their
      // current regime and the exact TP/SL the engine would assign right now
      regimeSamples: this.market.ticker.slice(0, 4).map((t) => {
        const plan = this.exitPlan(crewDef('momentum'), t.coin)
        return { coin: t.coin, regime: plan.regime, tpPct: plan.tpPx, slPct: plan.slPx }
      }),
      // live proof the entry brain is working: how many candidate signals it
      // reviewed in the last window and how many it refused to risk money on
      smart: {
        scans: this.smart.scans,
        vetoes: this.smart.vetoes,
        entries: this.smart.entries,
        windowSec: 300,
      },
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
