'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  AlertTriangle,
  Gauge,
  Layers,
  MoveHorizontal,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react'
import type { EngineSnapshot, RiskProfile, TradeMode } from '@/lib/shared-types'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: EngineSnapshot | null
  onSaved: () => void
}

const MODES: {
  key: TradeMode
  name: string
  desc: string
  tag: string
  color: string
}[] = [
  {
    key: 'sim',
    name: 'SIM',
    desc: 'Latihan dengan uang kertas · harga live Hyperliquid mainnet',
    tag: 'Uang kertas',
    color: '#17171C',
  },
  {
    key: 'testnet',
    name: 'TESTNET',
    desc: 'Order nyata · dana virtual · app.hyperliquid-testnet.xyz',
    tag: 'Uang palsu',
    color: '#22B8CF',
  },
  {
    key: 'mainnet',
    name: 'MAINNET',
    desc: 'Order nyata · dana sungguhan · app.hyperliquid.xyz',
    tag: 'Dana nyata',
    color: '#FF4D00',
  },
]

const PROFILES: { key: RiskProfile; name: string; desc: string }[] = [
  { key: 'chill', name: 'Chill', desc: 'Hold lebih lama · TP/SL longgar' },
  { key: 'balanced', name: 'Balanced', desc: 'Seimbang antara sabar dan cepat' },
  { key: 'turbo', name: 'Turbo', desc: 'Scalp cepat · cut loss disiplin' },
]

/** preset modal — dari yang paling kecil yang masih layak sampai standar */
const CAPITAL_PRESETS: { v: number; label: string }[] = [
  { v: 25, label: 'Mini' },
  { v: 50, label: 'Kecil' },
  { v: 100, label: 'Starter' },
  { v: 250, label: 'Wajar' },
  { v: 500, label: 'Serius' },
  { v: 1000, label: 'Standar' },
]

export function SettingsModal({ open, onOpenChange, state, onSaved }: SettingsModalProps) {
  const [mode, setMode] = useState<TradeMode>('sim')
  const [botName, setBotName] = useState('Grok Bot')
  const [startingEquity, setStartingEquity] = useState('1000')
  const [goalMultiple, setGoalMultiple] = useState('2')
  const [leverage, setLeverage] = useState(5)
  const [positionPct, setPositionPct] = useState(30)
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('balanced')
  const [autoExit, setAutoExit] = useState(true)
  const [tpPct, setTpPct] = useState('1.2')
  const [slPct, setSlPct] = useState('0.6')
  const [allowShort, setAllowShort] = useState(true)
  const [maxRiskPct, setMaxRiskPct] = useState(1)
  const [maxTotalRiskPct, setMaxTotalRiskPct] = useState(4)
  const [dailyLossStopPct, setDailyLossStopPct] = useState(6)
  const [privateKey, setPrivateKey] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const prevOpen = useRef(false)

  useEffect(() => {
    // only (re)populate the form when the dialog transitions closed → open,
    // otherwise live polling would wipe in-progress edits
    if (open && !prevOpen.current && state) {
      setMode(state.mode)
      setBotName(state.botName)
      setStartingEquity(String(state.startingEquity))
      setGoalMultiple(String(state.goal.target))
      setLeverage(state.leverage ?? 5)
      setPositionPct(Math.round((state.positionPct ?? 0.3) * 100))
      setRiskProfile(state.riskProfile ?? 'balanced')
      setAutoExit(state.autoExit ?? true)
      setTpPct(String(state.tpPct ?? 1.2))
      setSlPct(String(state.slPct ?? 0.6))
      setAllowShort(state.allowShort ?? true)
      setMaxRiskPct(state.risk?.perTradePct ?? 1)
      setMaxTotalRiskPct(state.risk?.totalPct ?? 4)
      setDailyLossStopPct(state.risk?.dailyStopPct ?? 6)
      setWalletAddress(state.walletAddress ?? '')
      setPrivateKey('')
      setError(null)
    }
    prevOpen.current = open
  }, [open, state])

  const isLive = mode !== 'sim'
  // estimates follow what the form will save: SIM → the modal field, live → wallet equity
  const equityNow = isLive
    ? state?.equity ?? (Number(startingEquity) || 1000)
    : Number(startingEquity) || state?.equity || 1000
  const marginEst = (equityNow * positionPct) / 100
  const notionalEst = marginEst * leverage
  const equityImpactPerPctMove = ((marginEst * leverage) / equityNow) * 100

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          botName: botName.trim() || 'Grok Bot',
          startingEquity: Number(startingEquity) || 1000,
          goalMultiple: Number(goalMultiple) || 2,
          leverage,
          positionPct: positionPct / 100,
          riskProfile,
          autoExit,
          tpPct: Number(tpPct) || 1.2,
          slPct: Number(slPct) || 0.6,
          allowShort,
          maxRiskPct,
          maxTotalRiskPct,
          dailyLossStopPct,
          privateKey: privateKey.trim() || undefined,
          walletAddress: walletAddress.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Gagal menyimpan')
      setPrivateKey('')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  async function action(kind: 'pause' | 'resume' | 'closeAll' | 'resetSim' | 'resetDailyStop') {
    setBusyAction(kind)
    try {
      await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: kind }),
      })
      onSaved()
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scroll max-h-[85vh] max-w-[440px] overflow-y-auto rounded-[28px] p-6">
        <DialogHeader>
          <DialogTitle className="text-[22px] font-black tracking-tight">Pengaturan Crew</DialogTitle>
          <DialogDescription className="text-[13px] font-semibold">
            Atur mode, modal, leverage, dan gaya trading.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          {MODES.map((m) => {
            const active = mode === m.key
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`w-full rounded-2xl border-2 p-3.5 text-left transition-all ${
                  active
                    ? 'border-[#17171C] bg-[#FAFAFB]'
                    : 'border-[#ECECEE] bg-white hover:border-[#D6D6DB]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-md px-2 py-0.5 text-[12px] font-black text-white"
                    style={{ background: m.color }}
                  >
                    {m.name}
                  </span>
                  <span className="text-[12px] font-bold text-[#8E8E93]">{m.tag}</span>
                  {active && (
                    <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#22C55E]">
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="white">
                        <path d="M8 13.4 4.6 10l-1.2 1.2L8 15.8l8.6-8.6L15.4 6z" />
                      </svg>
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12.5px] font-semibold text-[#8E8E93]">{m.desc}</p>
              </button>
            )
          })}
        </div>

        {/* ---------- trading engine settings ---------- */}
        <div className="mt-4 rounded-2xl border-2 border-[#ECECEE] p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-black tracking-tight">
            <Gauge size={15} strokeWidth={2.4} aria-hidden /> Ukuran & Risiko Trade
          </p>

          {/* leverage */}
          <div className="mt-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="lev" className="flex items-center gap-1.5 text-[12px] font-extrabold">
                <Zap size={13} strokeWidth={2.4} aria-hidden /> Leverage
              </Label>
              <span
                className={`rounded-lg px-2 py-0.5 text-[13px] font-black tabular-nums ${
                  leverage >= 10 ? 'bg-[#FEF2F2] text-[#DC2626]' : 'bg-[#F2F2F4] text-[#17171C]'
                }`}
              >
                {leverage}×
              </span>
            </div>
            <Slider
              id="lev"
              min={1}
              max={20}
              step={1}
              value={[leverage]}
              onValueChange={(v) => setLeverage(v[0] ?? 5)}
              aria-label="Leverage"
            />
            <p className="text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
              Profit &amp; loss dikali {leverage}×. {leverage >= 10 ? 'Tinggi — hati-hati.' : 'Moderat.'}
            </p>
          </div>

          {/* position size */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pos" className="flex items-center gap-1.5 text-[12px] font-extrabold">
                <Layers size={13} strokeWidth={2.4} aria-hidden /> Ukuran posisi
              </Label>
              <span className="rounded-lg bg-[#F2F2F4] px-2 py-0.5 text-[13px] font-black tabular-nums">
                {positionPct}%
              </span>
            </div>
            <Slider
              id="pos"
              min={5}
              max={100}
              step={5}
              value={[positionPct]}
              onValueChange={(v) => setPositionPct(v[0] ?? 30)}
              aria-label="Ukuran posisi"
            />
            <p className="text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
              Margin per trade: ≈ ${marginEst.toFixed(0)} → notional ≈ $
              {notionalEst.toFixed(0)} ({leverage}×)
            </p>
          </div>

          {/* risk profile */}
          <div className="mt-4 space-y-2">
            <Label className="text-[12px] font-extrabold">Gaya trading</Label>
            <div className="grid grid-cols-3 gap-2">
              {PROFILES.map((p) => {
                const active = riskProfile === p.key
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setRiskProfile(p.key)}
                    className={`rounded-xl border-2 px-2 py-2 text-center transition-all ${
                      active
                        ? 'border-[#17171C] bg-[#17171C] text-white'
                        : 'border-[#ECECEE] bg-white text-[#17171C] hover:border-[#D6D6DB]'
                    }`}
                  >
                    <span className="block text-[12.5px] font-black">{p.name}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
              {PROFILES.find((p) => p.key === riskProfile)?.desc} — bot pinter: profit jalan
              pakai trailing stop (tidak di-kill timer), loss dipotong cepat.
            </p>
          </div>

          {/* impact estimate */}
          <div className="mt-3.5 rounded-xl bg-[#F2F2F4] px-3 py-2.5">
            <p className="text-[11.5px] font-bold leading-snug text-[#3C3C43]">
              Pergerakan harga 1% ≈{' '}
              {equityImpactPerPctMove > 400
                ? 'sangat agresif — turunkan leverage atau posisi'
                : `≈ ${equityImpactPerPctMove.toFixed(1)}% equity`}{' '}
              per trade aktif ({leverage}× × {positionPct}% modal).
            </p>
          </div>
        </div>

        {/* ---------- adaptive take profit ---------- */}
        <div className="mt-4 rounded-2xl border-2 border-[#ECECEE] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-black tracking-tight">
              <Target size={15} strokeWidth={2.4} aria-hidden /> Target profit
            </p>
            <Switch
              checked={autoExit}
              onCheckedChange={setAutoExit}
              aria-label="Target profit otomatis"
            />
          </div>

          {autoExit ? (
            <>
              <p className="mt-1.5 text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
                <span className="font-extrabold text-[#17171C]">OTOMATIS (adaptif)</span> — bot
                menghitung TP/SL per coin dari volatilitas live (ATR) dan rezim market:
                trending → target dilebar (profit dip biarkan jalan), ranging → diperketat
                (profit diambil cepat sebelum balik arah).
              </p>
              <div className="mt-3 space-y-1.5">
                {(state?.regimeSamples ?? []).length === 0 && (
                  <p className="rounded-xl bg-[#F2F2F4] px-3 py-2 text-[11.5px] font-bold text-[#8E8E93]">
                    Mengukur rezim market…
                  </p>
                )}
                {(state?.regimeSamples ?? []).map((s) => (
                  <div
                    key={s.coin}
                    className="flex items-center gap-2 rounded-xl bg-[#F2F2F4] px-3 py-2"
                  >
                    <span className="text-[12px] font-black">${s.coin}</span>
                    {s.regime === 'trending' ? (
                      <span className="flex items-center gap-1 rounded-md bg-[#DCFCE7] px-1.5 py-0.5 text-[10.5px] font-black text-[#15803D]">
                        <TrendingUp size={11} strokeWidth={2.6} aria-hidden /> TREN
                      </span>
                    ) : s.regime === 'ranging' ? (
                      <span className="flex items-center gap-1 rounded-md bg-[#ECECEE] px-1.5 py-0.5 text-[10.5px] font-black text-[#636366]">
                        <MoveHorizontal size={11} strokeWidth={2.6} aria-hidden /> SIDEWAYS
                      </span>
                    ) : (
                      <span className="rounded-md bg-[#ECECEE] px-1.5 py-0.5 text-[10.5px] font-black text-[#636366]">
                        MANUAL
                      </span>
                    )}
                    <span className="ml-auto text-[11.5px] font-extrabold tabular-nums text-[#3C3C43]">
                      TP ≈ {s.tpPct.toFixed(2)}% · SL ≈ {s.slPct.toFixed(2)}%
                    </span>
                  </div>
                ))}
                <p className="text-[10.5px] font-semibold leading-snug text-[#B4B4B9]">
                  Pratinjau langsung — angka nyata yang akan dipakai bot sekarang untuk 4 coin
                  volume terbesar. Angka final dihitung ulang saat entry (ikut kondisi terkini).
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
                <span className="font-extrabold text-[#17171C]">MANUAL</span> — semua trade pakai
                target tetap di bawah. Disiplin exit (trailing, time stop) tetap jalan.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tpp" className="text-[12px] font-extrabold">
                    Take profit %
                  </Label>
                  <Input
                    id="tpp"
                    type="number"
                    min={0.1}
                    max={30}
                    step={0.1}
                    value={tpPct}
                    onChange={(e) => setTpPct(e.target.value)}
                    className="h-10 rounded-xl border-[#ECECEE] text-[14px] font-extrabold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="slp" className="text-[12px] font-extrabold">
                    Stop loss %
                  </Label>
                  <Input
                    id="slp"
                    type="number"
                    min={0.05}
                    max={15}
                    step={0.05}
                    value={slPct}
                    onChange={(e) => setSlPct(e.target.value)}
                    className="h-10 rounded-xl border-[#ECECEE] text-[14px] font-extrabold"
                  />
                </div>
              </div>
              <p className="mt-2 text-[10.5px] font-semibold leading-snug text-[#B4B4B9]">
                Trailing stop = 40% dari TP (ikut gaya trading). Catatan: sizing tetap dihitung
                dari stop — SL terlalu lebar mengecilkan ukuran posisi otomatis.
              </p>
            </>
          )}
        </div>

        {/* ---------- direction: long & short ---------- */}
        <div className="mt-4 rounded-2xl border-2 border-[#ECECEE] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-black tracking-tight">
              <TrendingDown size={15} strokeWidth={2.4} aria-hidden /> Arah trading — Long &amp; Short
            </p>
            <Switch
              checked={allowShort}
              onCheckedChange={setAllowShort}
              aria-label="Izinkan posisi short"
            />
          </div>
          <p className="mt-1.5 text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
            {allowShort ? (
              <>
                <span className="font-extrabold text-[#17171C]">LONG + SHORT</span> — saat market
                turun, crew boleh <span className="font-extrabold">short</span> (untung justru saat
                harga jatuh). Hanya jika tren 5m benar-benar turun + tekanan jual kuat — otak entry
                tetap jadi hakim.
              </>
            ) : (
              <>
                <span className="font-extrabold text-[#17171C]">LONG ONLY</span> — bot hanya beli,
                lalu jual untuk ambil profit / potong rugi. Market turun = crew menunggu di pinggir.
              </>
            )}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-md bg-[#DCFCE7] px-2 py-1 text-[10.5px] font-black text-[#15803D]">
              <TrendingUp size={11} strokeWidth={2.6} aria-hidden /> LONG: naik = untung
            </span>
            <span
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-black ${
                allowShort ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#ECECEE] text-[#B4B4B9]'
              }`}
            >
              <TrendingDown size={11} strokeWidth={2.6} aria-hidden /> SHORT: turun = untung
              {!allowShort && ' · mati'}
            </span>
          </div>
        </div>

        {/* ---------- desk risk limits (HyperGrok) ---------- */}
        <div className="mt-4 rounded-2xl border-2 border-[#ECECEE] p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-black tracking-tight">
            <ShieldAlert size={15} strokeWidth={2.4} aria-hidden /> Risk Desk — batas kerugian
          </p>
          <p className="mt-1 text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
            Ukuran trade dihitung dari stop ("the stop defines the size"): slippage + fee
            dua kaki dihitung, jadi loss riil saat stop kena tidak melebihi anggaran.
          </p>

          {/* risk per trade */}
          <div className="mt-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="rp" className="text-[12px] font-extrabold">
                Risiko per trade
              </Label>
              <span className="rounded-lg bg-[#F2F2F4] px-2 py-0.5 text-[13px] font-black tabular-nums">
                {maxRiskPct.toFixed(1)}%
              </span>
            </div>
            <Slider
              id="rp"
              min={0.1}
              max={2}
              step={0.1}
              value={[maxRiskPct]}
              onValueChange={(v) => setMaxRiskPct(v[0] ?? 1)}
              aria-label="Risiko per trade"
            />
            <p className="text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
              Maks ≈ ${(((state?.equity ?? 1000) * maxRiskPct) / 100).toFixed(2)} hilang jika stop kena
              (dari equity sekarang).
            </p>
          </div>

          {/* total open risk */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="tr" className="text-[12px] font-extrabold">
                Total risiko terbuka
              </Label>
              <span className="rounded-lg bg-[#F2F2F4] px-2 py-0.5 text-[13px] font-black tabular-nums">
                {maxTotalRiskPct.toFixed(1)}%
              </span>
            </div>
            <Slider
              id="tr"
              min={0.5}
              max={6}
              step={0.5}
              value={[maxTotalRiskPct]}
              onValueChange={(v) => setMaxTotalRiskPct(v[0] ?? 4)}
              aria-label="Total risiko terbuka"
            />
            <p className="text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
              Gabungan seluruh posisi aktif. Penuh → ticket baru ditolak
              (reservasi dihitung, bukan cuma posisi).
            </p>
          </div>

          {/* daily loss stop */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ds" className="text-[12px] font-extrabold">
                Daily loss stop
              </Label>
              <span className="rounded-lg bg-[#F2F2F4] px-2 py-0.5 text-[13px] font-black tabular-nums">
                −{dailyLossStopPct.toFixed(1)}%
              </span>
            </div>
            <Slider
              id="ds"
              min={1}
              max={10}
              step={0.5}
              value={[dailyLossStopPct]}
              onValueChange={(v) => setDailyLossStopPct(v[0] ?? 6)}
              aria-label="Daily loss stop"
            />
            <p className="text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
              Kalau equity hari ini turun {dailyLossStopPct.toFixed(1)}%, bot MEMASANG "no-new-risk":
              entry baru berhenti, exit &amp; proteksi tetap jalan. Reset manual di bawah.
            </p>
          </div>

          {/* live usage */}
          {state?.risk && (
            <div className="mt-3.5 rounded-xl bg-[#F2F2F4] px-3 py-2.5">
              <p className="text-[11.5px] font-bold leading-snug text-[#3C3C43]">
                Terpakai sekarang: ${state.risk.openRiskUsd.toFixed(2)} risiko terbuka
                ({state.risk.openRiskPct.toFixed(2)}% dari limit {state.risk.totalPct}%) ·
                daily stop {Math.round(state.risk.dailyStopUsage * 100)}% terpakai
              </p>
            </div>
          )}

          {state?.risk?.latched && (
            <div className="mt-3 rounded-xl bg-[#FEF2F2] px-3 py-2.5">
              <p className="text-[11.5px] font-extrabold text-[#DC2626]">
                TERKUNCI: tanpa risiko baru ({state.risk.latchedReason}). Tombol "Reset stop
                harian" di bawah untuk buka lagi.
              </p>
            </div>
          )}

          {state?.risk?.latched && (
            <Button
              variant="outline"
              disabled={busyAction !== null}
              onClick={() => action('resetDailyStop')}
              className="mt-3 h-10 w-full rounded-xl text-[12.5px] font-extrabold"
            >
              Reset stop harian
            </Button>
          )}

          <p className="mt-3 text-[10.5px] font-semibold leading-snug text-[#B4B4B9]">
            Ceiling keras (tidak bisa dilewati): 2% per trade · 6% total terbuka · 10% daily stop ·
            maks 2 posisi per cluster correlated (majors/memes/L1/DeFi).
          </p>
        </div>

        {isLive && (
          <div className="mt-4 space-y-3 rounded-2xl bg-[#FFF7ED] p-4">
            <p className="flex items-start gap-1.5 text-[12.5px] font-extrabold text-[#C2410C]">
              <AlertTriangle size={15} strokeWidth={2.4} className="mt-[1px] shrink-0" aria-hidden />
              {mode === 'mainnet' ? 'DANA SUNGGUHAN — bot akan membuat order nyata di Hyperliquid mainnet.' : 'Mode testnet: butuh dana virtual dari faucet testnet Hyperliquid.'}
            </p>
            <p className="text-[11.5px] font-bold text-[#9A3412]">
              Minimum order exchange Hyperliquid: $10 per trade (dipakai juga di SIM agar realistis).
              Leverage mengikuti batas maksimum tiap coin di exchange.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pk" className="text-[12px] font-extrabold">
                Private key (agent wallet)
              </Label>
              <Input
                id="pk"
                type="password"
                placeholder="0x…"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="h-11 rounded-xl border-[#ECECEE] bg-white text-[14px] font-semibold"
                autoComplete="off"
              />
              {state?.walletAddress && (
                <p className="text-[11.5px] font-semibold text-[#8E8E93]">
                  Wallet aktif: {state.walletAddress.slice(0, 8)}…{state.walletAddress.slice(-6)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa" className="text-[12px] font-extrabold">
                Alamat wallet utama (opsional, untuk agent wallet)
              </Label>
              <Input
                id="wa"
                placeholder="0x… (kosongkan jika bukan agent wallet)"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="h-11 rounded-xl border-[#ECECEE] bg-white text-[14px] font-semibold"
                autoComplete="off"
              />
            </div>
            {mode === 'testnet' && (
              <p className="text-[11.5px] font-semibold text-[#92400E]">
                Faucet dana testnet: buka app.hyperliquid-testnet.xyz → tombol Deposit (drip USDC palsu).
              </p>
            )}
          </div>
        )}

        {/* ---------- modal: preset & nominal (berlaku semua mode) ---------- */}
        <div className="mt-4 rounded-2xl border-2 border-[#ECECEE] p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-black tracking-tight">
            <Wallet size={15} strokeWidth={2.4} aria-hidden /> Modal awal
          </p>
          <p className="mt-1 text-[11.5px] font-semibold leading-snug text-[#8E8E93]">
            Berlaku di <span className="font-extrabold text-[#17171C]">semua mode</span> — SIM ·
            TESTNET · MAINNET. Preset kecil enak untuk uji coba dulu di SIM.
          </p>

          {/* preset chips */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {CAPITAL_PRESETS.map((p) => {
              const active = Number(startingEquity) === p.v
              return (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setStartingEquity(String(p.v))}
                  className={`rounded-xl border-2 px-2 py-2 text-center transition-all ${
                    active
                      ? 'border-[#17171C] bg-[#17171C] text-white'
                      : 'border-[#ECECEE] bg-white text-[#17171C] hover:border-[#D6D6DB]'
                  }`}
                >
                  <span className="block text-[13.5px] font-black tabular-nums">${p.v}</span>
                  <span
                    className={`block text-[10px] font-bold ${
                      active ? 'text-white/70' : 'text-[#8E8E93]'
                    }`}
                  >
                    {p.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* nominal input + goal */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="eq" className="text-[12px] font-extrabold">
                Nominal sendiri (USD)
              </Label>
              <Input
                id="eq"
                type="number"
                min={10}
                step={5}
                value={startingEquity}
                onChange={(e) => setStartingEquity(e.target.value)}
                className="h-11 rounded-xl border-[#ECECEE] text-[14px] font-extrabold"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal" className="text-[12px] font-extrabold">
                Target profit
              </Label>
              <div className="flex h-11 items-center gap-1.5 rounded-xl border border-[#ECECEE] px-3">
                <Input
                  id="goal"
                  type="number"
                  min={1.05}
                  max={5}
                  step={0.25}
                  value={goalMultiple}
                  onChange={(e) => setGoalMultiple(e.target.value)}
                  className="h-full border-0 p-0 text-[14px] font-extrabold shadow-none focus-visible:ring-0"
                />
                <span className="text-[14px] font-black text-[#8E8E93]">×</span>
              </div>
            </div>
          </div>

          {/* kelayakan order vs minimum exchange $10 */}
          {(() => {
            const estEq = Number(startingEquity) || 1000
            const estMargin = Math.min(estEq, Math.max(5, (estEq * positionPct) / 100))
            const estCap = estMargin * leverage
            const ok = estCap >= 20
            const thin = estCap >= 10 && estCap < 20
            return (
              <div
                className={`mt-3 rounded-xl px-3 py-2.5 ${
                  ok ? 'bg-[#F0FDF4]' : thin ? 'bg-[#FEF3C7]' : 'bg-[#FEF2F2]'
                }`}
              >
                <p
                  className={`text-[11.5px] font-bold leading-snug ${
                    ok ? 'text-[#15803D]' : thin ? 'text-[#B45309]' : 'text-[#DC2626]'
                  }`}
                >
                  {ok
                    ? `Layak — ukuran order maks ≈ $${estCap.toFixed(0)} per trade (minimum exchange $10). Modal $25 adalah paling kecil yang masih sehat.`
                    : thin
                      ? `Pas-pasan — order maks ≈ $${estCap.toFixed(0)}. Stop lebar bisa membuat ticket ditolak (min $10). Naikkan leverage atau modal.`
                      : `Kegedean resikonya dibalik modal — order maks ≈ $${estCap.toFixed(
                          0
                        )}, di bawah minimum exchange $10. Naikkan leverage / ukuran posisi, atau pilih modal lebih besar.`}
                </p>
              </div>
            )
          })()}

          <p className="mt-2 text-[10.5px] font-semibold leading-snug text-[#B4B4B9]">
            Ganti nominal &amp; mode SIM aktif → SIM otomatis di-reset (riwayat bersih) supaya
            equity mulai persis dari modal baru. Di mode live, PnL tetap dihitung dari saldo
            wallet asli.
          </p>
        </div>

        <div className="mt-3 space-y-1.5">
          <Label htmlFor="bn" className="text-[12px] font-extrabold">
            Nama bot
          </Label>
          <Input
            id="bn"
            value={botName}
            onChange={(e) => setBotName(e.target.value)}
            className="h-11 rounded-xl border-[#ECECEE] text-[14px] font-extrabold"
          />
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-[#FEF2F2] px-3 py-2 text-[12.5px] font-bold text-[#DC2626]">
            {error}
          </p>
        )}

        <Button
          onClick={save}
          disabled={saving || (isLive && !privateKey && !state?.walletAddress)}
          className="mt-4 h-12 w-full rounded-2xl bg-[#17171C] text-[15px] font-extrabold hover:bg-[#2A2A31]"
        >
          {saving ? 'Menyimpan…' : 'Simpan & Terapkan'}
        </Button>
        {isLive && !privateKey && !state?.walletAddress && (
          <p className="text-center text-[11.5px] font-semibold text-[#8E8E93]">
            Isi private key untuk mengaktifkan mode live.
          </p>
        )}

        <Separator className="my-4" />

        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => action(state?.running ? 'pause' : 'resume')}
            className="h-10 rounded-xl text-[12.5px] font-extrabold"
          >
            {state?.running ? 'Jeda' : 'Lanjut'}
          </Button>
          <Button
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => action('closeAll')}
            className="h-10 rounded-xl text-[12.5px] font-extrabold"
          >
            Tutup semua
          </Button>
          <Button
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => action('resetSim')}
            className="h-10 rounded-xl text-[12.5px] font-extrabold text-[#DC2626] hover:text-[#DC2626]"
          >
            Reset SIM
          </Button>
        </div>

        <p className="mt-3 text-center text-[11px] font-semibold leading-relaxed text-[#B4B4B9]">
          Private key hanya disimpan di database sandbox ini dan hanya dipakai untuk
          menandatangani order ke API Hyperliquid. Gunakan agent wallet terpisah dengan dana
          terbatas. DYOR — bot trading berisiko.
        </p>
      </DialogContent>
    </Dialog>
  )
}
