// Coin visual metadata used by CoinIcon (client) and engine labels (server)
export interface CoinMeta {
  color: string
  label: string // emoji or short letter(s) shown inside the icon
  bg?: string // optional gradient end for gradient icons
}

export const COIN_META: Record<string, CoinMeta> = {
  BTC: { color: '#F7931A', label: '₿' },
  ETH: { color: '#627EEA', label: 'Ξ' },
  SOL: { color: '#9945FF', label: '◎', bg: '#14F195' },
  DOGE: { color: '#C2A633', label: 'Ð' },
  XRP: { color: '#23292F', label: '✕' },
  AVAX: { color: '#E84142', label: '▲' },
  LINK: { color: '#2A5ADA', label: '⬡' },
  SUI: { color: '#4DA2FF', label: '≈' },
  APT: { color: '#0BB7A8', label: 'A' },
  ARB: { color: '#28A0F0', label: '◐' },
  OP: { color: '#FF0420', label: 'OP' },
  NEAR: { color: '#00C08B', label: 'N' },
  TIA: { color: '#7B2BF9', label: 'T' },
  WIF: { color: '#F5A542', label: '🐕' },
  BONK: { color: '#F5AC24', label: '🐶' },
  PEPE: { color: '#3DA842', label: '🐸' },
  TRUMP: { color: '#C9A24B', label: '🎩' },
  FARTCOIN: { color: '#39C6A5', label: '💨' },
  HYPE: { color: '#0FBF9F', label: '⚡' },
  JUP: { color: '#8BC34A', label: '🪐' },
  PURR: { color: '#F472B6', label: '🐱' },
}

export function coinMeta(coin: string): CoinMeta {
  return COIN_META[coin] ?? { color: '#8E8E93', label: coin.slice(0, 1) }
}
