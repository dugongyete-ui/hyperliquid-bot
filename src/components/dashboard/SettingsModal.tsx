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
import { AlertTriangle } from 'lucide-react'
import type { EngineSnapshot, TradeMode } from '@/lib/shared-types'

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
    tag: 'Paper money',
    color: '#17171C',
  },
  {
    key: 'testnet',
    name: 'TESTNET',
    desc: 'Order nyata · dana virtual · app.hyperliquid-testnet.xyz',
    tag: 'Fake money',
    color: '#22B8CF',
  },
  {
    key: 'mainnet',
    name: 'MAINNET',
    desc: 'Order nyata · dana sungguhan · app.hyperliquid.xyz',
    tag: 'Real funds',
    color: '#FF4D00',
  },
]

export function SettingsModal({ open, onOpenChange, state, onSaved }: SettingsModalProps) {
  const [mode, setMode] = useState<TradeMode>('sim')
  const [botName, setBotName] = useState('Grok Bot')
  const [startingEquity, setStartingEquity] = useState('1000')
  const [goalMultiple, setGoalMultiple] = useState('2')
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
      setWalletAddress(state.walletAddress ?? '')
      setPrivateKey('')
      setError(null)
    }
    prevOpen.current = open
  }, [open, state])

  const isLive = mode !== 'sim'

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

  async function action(kind: 'pause' | 'resume' | 'closeAll' | 'resetSim') {
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
          <DialogTitle className="text-[22px] font-black tracking-tight">Crew Settings</DialogTitle>
          <DialogDescription className="text-[13px] font-semibold">
            Atur mode trading, modal, dan target profit.
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

        {isLive && (
          <div className="mt-4 space-y-3 rounded-2xl bg-[#FFF7ED] p-4">
            <p className="flex items-start gap-1.5 text-[12.5px] font-extrabold text-[#C2410C]">
              <AlertTriangle size={15} strokeWidth={2.4} className="mt-[1px] shrink-0" aria-hidden />
              {mode === 'mainnet' ? 'DANA SUNGGUHAN — bot akan membuat order nyata di Hyperliquid mainnet.' : 'Mode testnet: butuh dana virtual dari faucet testnet Hyperliquid.'}
            </p>
            <p className="text-[11.5px] font-bold text-[#9A3412]">
              Minimum order exchange Hyperliquid: $10 per trade (dipakai juga di SIM agar realistis).
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

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="eq" className="text-[12px] font-extrabold">
              Modal awal (SIM)
            </Label>
            <Input
              id="eq"
              type="number"
              min={100}
              step={100}
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
            {state?.running ? 'Pause' : 'Resume'}
          </Button>
          <Button
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => action('closeAll')}
            className="h-10 rounded-xl text-[12.5px] font-extrabold"
          >
            Close all
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
