// Live-order wrapper around the official `hyperliquid` TypeScript SDK.
// Orders are EIP-712 signed with the user's agent wallet key and sent to
// https://api.hyperliquid.xyz (mainnet) or https://api.hyperliquid-testnet.xyz (testnet).

import { Hyperliquid } from 'hyperliquid'
import { Wallet } from 'ethers'

export type LiveNetwork = 'testnet' | 'mainnet'

export function validatePrivateKey(pk: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(pk.trim())
}

export function deriveAddress(pk: string): string {
  return new Wallet(pk.trim()).address
}

export interface LiveSdk {
  sdk: Hyperliquid
  address: string
}

const cache = new Map<string, LiveSdk>()

export function getLiveSdk(network: LiveNetwork, privateKey: string, walletAddress?: string | null): LiveSdk {
  const key = `${network}:${privateKey.slice(0, 10)}:${walletAddress ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const sdk = new Hyperliquid({
    privateKey: privateKey.trim(),
    testnet: network === 'testnet',
    enableWs: false,
    walletAddress: walletAddress?.trim() || undefined,
  })
  const entry: LiveSdk = { sdk, address: deriveAddress(privateKey) }
  cache.set(key, entry)
  return entry
}

export interface OpenLiveResult {
  ok: boolean
  avgPx: number | null
  filledSz: number | null
  error?: string
  /** true when the send's result was uncertain and was resolved by
   * reconciling the account (HyperGrok execution protocol) */
  unknown?: boolean
}

interface OrderStatusWire {
  type: string
  filled?: { avgPx?: string; totalSz?: string }
  error?: string
}

export async function liveMarketOpen(
  network: LiveNetwork,
  privateKey: string,
  walletAddress: string | null | undefined,
  coin: string,
  qty: number,
  isBuy: boolean = true // false = market SELL → opens/flips into a SHORT position
): Promise<OpenLiveResult> {
  const { sdk } = getLiveSdk(network, privateKey, walletAddress)
  try {
    await sdk.ensureInitialized()
    const res = await sdk.exchange.marketOpen(coin, isBuy, qty, undefined, 0.03)
    const statuses: OrderStatusWire[] =
      (res as { response?: { data?: { statuses?: OrderStatusWire[] } } })?.response?.data?.statuses ?? []
    const first = statuses[0]
    if (first?.type === 'filled' && first.filled?.avgPx) {
      return {
        ok: true,
        avgPx: parseFloat(first.filled.avgPx),
        filledSz: parseFloat(first.filled.totalSz ?? String(qty)),
      }
    }
    if (first?.type === 'error') return { ok: false, avgPx: null, filledSz: null, error: first.error }
    // resting / unknown — treat as ok at unknown price
    return { ok: true, avgPx: null, filledSz: null }
  } catch (e) {
    // HyperGrok execution protocol: a timeout/exception means the result is
    // UNKNOWN, not failed — the order may already have filled. Never declare
    // failure blindly: reconcile once against the account state first.
    const msg = e instanceof Error ? e.message : String(e)
    try {
      const { address } = getLiveSdk(network, privateKey, walletAddress)
      const acct = await liveAccountState(network, walletAddress?.trim() || address)
      const pos = acct?.positions.find((p) => p.coin === coin && Math.abs(p.szi) > 0)
      if (pos) {
        return {
          ok: true,
          avgPx: pos.entryPx > 0 ? pos.entryPx : null,
          filledSz: Math.abs(pos.szi),
          unknown: true,
        }
      }
    } catch {
      /* reconciliation failed too — report the original error */
    }
    return { ok: false, avgPx: null, filledSz: null, error: msg }
  }
}

export async function liveMarketClose(
  network: LiveNetwork,
  privateKey: string,
  walletAddress: string | null | undefined,
  coin: string
): Promise<OpenLiveResult> {
  const { sdk } = getLiveSdk(network, privateKey, walletAddress)
  try {
    await sdk.ensureInitialized()
    const res = await sdk.exchange.marketClose(coin)
    const statuses: OrderStatusWire[] =
      (res as { response?: { data?: { statuses?: OrderStatusWire[] } } })?.response?.data?.statuses ?? []
    const first = statuses[0]
    if (first?.type === 'error') return { ok: false, avgPx: null, filledSz: null, error: first.error }
    return { ok: true, avgPx: null, filledSz: null }
  } catch (e) {
    // Same protocol for closes: unknown result ≠ failure. If the position is
    // GONE from the account, the close actually went through.
    const msg = e instanceof Error ? e.message : String(e)
    try {
      const { address } = getLiveSdk(network, privateKey, walletAddress)
      const acct = await liveAccountState(network, walletAddress?.trim() || address)
      const stillOpen = acct?.positions.find((p) => p.coin === coin && Math.abs(p.szi) > 0)
      if (!stillOpen) return { ok: true, avgPx: null, filledSz: null, unknown: true }
    } catch {
      /* reconciliation failed too — report the original error */
    }
    return { ok: false, avgPx: null, filledSz: null, error: msg }
  }
}

export interface LiveAccountState {
  accountValue: number
  positions: Array<{
    coin: string
    szi: number
    entryPx: number
    unrealizedPnl: number
    returnOnEquity: number
    positionValue: number
  }>
}

export async function liveAccountState(
  network: LiveNetwork,
  address: string
): Promise<LiveAccountState | null> {
  try {
    const res = await fetch(`https://api.hyperliquid${network === 'testnet' ? '-testnet' : ''}.xyz/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: address }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      marginSummary?: { accountValue?: string }
      assetPositions?: Array<{
        position?: {
          coin?: string
          szi?: string
          entryPx?: string
          unrealizedPnl?: string
          returnOnEquity?: string
          positionValue?: string
        }
      }>
    }
    const accountValue = parseFloat(data.marginSummary?.accountValue ?? '0')
    const positions = (data.assetPositions ?? [])
      .map((ap) => ap.position)
      .filter((p): p is NonNullable<typeof p> => !!p && !!p.coin)
      .map((p) => ({
        coin: p.coin,
        szi: parseFloat(p.szi ?? '0'),
        entryPx: parseFloat(p.entryPx ?? '0'),
        unrealizedPnl: parseFloat(p.unrealizedPnl ?? '0'),
        returnOnEquity: parseFloat(p.returnOnEquity ?? '0') * 100,
        positionValue: parseFloat(p.positionValue ?? '0'),
      }))
    return { accountValue: isFinite(accountValue) ? accountValue : 0, positions }
  } catch {
    return null
  }
}

/** perp meta (szDecimals) cached per network — used to round order sizes.
 * Mainnet and testnet universes are kept separate on purpose (HyperGrok rule:
 * never mix networks — ids and precision can differ). */
const metaCache = new Map<LiveNetwork, { meta: Array<{ name: string; szDecimals: number }>; at: number }>()

export async function szDecimalsFor(coin: string, network: LiveNetwork = 'mainnet'): Promise<number | null> {
  const now = Date.now()
  const hit = metaCache.get(network)
  if (!hit || now - hit.at > 10 * 60_000) {
    try {
      const res = await fetch(`https://api.hyperliquid${network === 'testnet' ? '-testnet' : ''}.xyz/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' }),
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      })
      const data = (await res.json()) as { universe?: Array<{ name: string; szDecimals: number }> }
      metaCache.set(network, { meta: data.universe ?? [], at: now })
    } catch {
      return null
    }
  }
  return metaCache.get(network)?.meta.find((u) => u.name === coin)?.szDecimals ?? null
}

export async function roundQty(coin: string, qty: number, network: LiveNetwork = 'mainnet'): Promise<number> {
  const dec = await szDecimalsFor(coin, network)
  if (dec == null) return parseFloat(qty.toFixed(3))
  const f = Math.pow(10, dec)
  return Math.floor(qty * f) / f
}
