// Boots the trading engine when the Next.js server starts (node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { ensureEngine } = await import('@/lib/engine/engine')
  ensureEngine()
}
