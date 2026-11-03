import type { BotKey } from '@/lib/shared-types'

export interface CrewDef {
  key: BotKey
  name: string
  color: string
  face: string
  /** coins this bot watches */
  universe: string[]
  /** fraction of equity per trade */
  sizing: number
  exit: {
    tp: number // take profit %
    sl: number // stop loss %
    trail?: number // trailing stop: close when pnlPct drops this much below peak
    timeStop: number // seconds
  }
  winCooldown: [number, number]
  lossCooldown: [number, number]
  scanningThoughts: string[]
}

export const CREW: CrewDef[] = [
  {
    key: 'sniper',
    name: 'Sniper',
    color: '#F7931A',
    face: 'focused',
    universe: ['SOL', 'DOGE', 'WIF', 'BONK', 'PEPE', 'TRUMP', 'FARTCOIN', 'HYPE'],
    sizing: 0.3,
    exit: { tp: 4.0, sl: 1.2, trail: 0.55, timeStop: 80 },
    winCooldown: [30, 60],
    lossCooldown: [70, 130],
    scanningThoughts: [
      'lurking for a breakout…',
      'watching 20m range highs',
      'finger on the trigger',
      'waiting for liquidity sweep',
    ],
  },
  {
    key: 'momentum',
    name: 'Momentum',
    color: '#2E90FA',
    face: 'happy',
    universe: ['BTC', 'ETH', 'SOL', 'SUI', 'JUP', 'HYPE', 'TIA', 'APT'],
    sizing: 0.32,
    exit: { tp: 2.6, sl: 1.0, trail: 0.8, timeStop: 150 },
    winCooldown: [25, 55],
    lossCooldown: [60, 110],
    scanningThoughts: [
      'measuring buyer pressure…',
      'riding the trend wave',
      'scanning 5m momentum',
      'chasing green candles',
    ],
  },
  {
    key: 'dipHunter',
    name: 'Dip Hunter',
    color: '#22B8CF',
    face: 'sparkle',
    universe: ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'XRP', 'NEAR', 'ARB', 'OP'],
    sizing: 0.3,
    exit: { tp: 2.2, sl: 1.0, timeStop: 240 },
    winCooldown: [35, 70],
    lossCooldown: [80, 150],
    scanningThoughts: [
      'hunting RSI oversold…',
      'bids stacked below',
      'waiting for the dip',
      'watching for wick rejections',
    ],
  },
  {
    key: 'whaleTail',
    name: 'Whale Tail',
    color: '#B453FF',
    face: 'blush',
    universe: ['WIF', 'BONK', 'PEPE', 'TRUMP', 'FARTCOIN', 'DOGE', 'HYPE', 'JUP'],
    sizing: 0.35,
    exit: { tp: 2.8, sl: 1.1, trail: 1.0, timeStop: 170 },
    winCooldown: [30, 65],
    lossCooldown: [70, 120],
    scanningThoughts: [
      'listening for whale prints…',
      'tracking big wallets',
      'watching volume anomalies',
      'following smart money',
    ],
  },
  {
    key: 'scalper',
    name: 'Scalper',
    color: '#7048E8',
    face: 'smirk',
    universe: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX'],
    sizing: 0.25,
    exit: { tp: 0.35, sl: 0.45, timeStop: 100 },
    winCooldown: [15, 35],
    lossCooldown: [40, 80],
    scanningThoughts: [
      'reading the order book…',
      'sniping micro spreads',
      'grid of tiny wins',
      'watching bid/ask imbalance',
    ],
  },
]

export function crewDef(key: BotKey): CrewDef {
  return CREW.find((c) => c.key === key) ?? CREW[0]
}
