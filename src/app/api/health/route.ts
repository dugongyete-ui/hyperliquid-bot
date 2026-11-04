import { NextResponse } from 'next/server'
import { ensureEngine } from '@/lib/engine/engine'

// Keep-alive endpoint: dipanggil cronjob tiap ~1 menit supaya server & engine
// tidak tertidur. Harus super murah, tidak boleh gagal, dan tidak boleh kena
// cache di layer mana pun (kalau kena cache, ping tidak sampai ke server).

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    // Sekalian memastikan engine singleton hidup — kalau server cold-restart
    // dan belum ada yang buka UI, ping ini yang mem-boot engine lebih awal.
    const engine = ensureEngine()
    const s = engine.settings

    return NextResponse.json(
      {
        ok: true,
        ts: Date.now(),
        uptimeSec: Math.round(process.uptime()),
        mode: s.mode,
        running: s.running,
        feedOk: engine.market.feedOk,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } },
    )
  } catch (e) {
    // Tetap 200 supaya pinger tidak menganggap gagal — tujuan utamanya
    // menjaga server tetap bangun walau engine sedang bermasalah.
    return NextResponse.json(
      {
        ok: false,
        ts: Date.now(),
        degraded: true,
        error: e instanceof Error ? e.message : 'unknown error',
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } },
    )
  }
}
