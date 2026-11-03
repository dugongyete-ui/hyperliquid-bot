// Shared types between the trading engine (server) and the UI (client)

export type BotKey = 'sniper' | 'momentum' | 'dipHunter' | 'whaleTail' | 'scalper'
export type TradeMode = 'sim' | 'testnet' | 'mainnet'

export interface CrewBotState {
  key: BotKey
  name: string
  color: string
  face: string
  pnl: number
  wins: number
  losses: number
  status: 'scanning' | 'cooling' | 'holding' | 'paused'
  thought: string
  thoughtAt: number
  holding: {
    coin: string
    pnlPct: number
    sizeUsd: number
    since: number
  } | null
}

export interface TradeRow {
  id: string
  botKey: string
  botName: string
  botColor: string
  coin: string
  side: string
  sizeUsd: number
  entryPx: number
  exitPx: number | null
  pnl: number
  pnlPct: number
  status: 'open' | 'closed'
  reason: string
  exitReason: string | null
  openedAt: number
  closedAt: number | null
  heldSec: number | null
  mode: TradeMode
}

export interface EquityPointRow {
  ts: number
  equity: number
}

export interface NotificationRow {
  id: string
  kind: 'goal' | 'streak' | 'bigwin' | 'info' | 'error'
  title: string
  body: string
  bigValue?: string
  botKey?: string
  createdAt: number
}

export interface EngineSnapshot {
  ts: number
  feedOk: boolean
  mode: TradeMode
  running: boolean
  botName: string
  walletAddress: string | null
  startingEquity: number
  equity: number
  pnl: number
  pnlPct: number
  multiple: number
  streak: number
  tradesClosed: number
  wins: number
  losses: number
  winRate: number
  goal: { target: number; done: boolean }
  equityCurve: EquityPointRow[]
  crew: CrewBotState[]
  trades: TradeRow[]
  notifications: NotificationRow[]
  openCount: number
  liveAccountValue: number | null
}

export interface SettingsPayload {
  mode: TradeMode
  botName: string
  startingEquity: number
  goalMultiple: number
  privateKey?: string
  walletAddress?: string
}
