# HyperGrok Desk — Ported Instructions & Rules

Source: https://github.com/galleonlabs/hypergrok-trading-desk (v1.7.1+, MIT license)
Copied here for reference and attribution. All credit for the desk methodology
goes to Galleon Labs. Local adaptations (TypeScript engine implementation) live
in `src/lib/engine/risk.ts` and `src/lib/engine/engine.ts`.

## What was ported into the engine (the real implementation)

| HyperGrok rule | Where it lives in this project |
|---|---|
| **Stressed-stop sizing** — "The stop defines the size": size = risk_budget / (\|entry − stop_fill\| + fees both legs), slippage = max(10 bps, spread), round DOWN | `risk.ts → stressedStopSize()`, used in `engine.ts → openPosition()` |
| **Risk reservation ledger** — open + pending risk share one budget; new tickets rejected when full; released only on reconciled close | `risk.ts → RiskLedger`, wired in `engine.ts` (open/finalizeClose/rebuildLedger) |
| **Two-layer limits** — hard ceilings (2%/trade, 6% total, 10% daily stop, 20×) that user config may only tighten, never loosen | `risk.ts → CEILINGS + clampLimits()`; persisted in Settings table; UI sliders clamp |
| **Daily loss stop latch** — hit the stop → "no-new-risk": entries pause, exits & protection keep running; manual reset | `RiskLedger.observeDay/canOpen/reset`, control action `resetDailyStop`, badge in UI |
| **Early warning at 80% of the daily stop** | `engine.ts → tick()` notification |
| **Correlated-cluster caps** — majors (BTC/ETH/SOL), memes, L1 alts, DeFi = one risk each; max 2 positions per cluster | `risk.ts → clusterOf()`, gate in `engine.ts → tryEntries()` |
| **Three-state monitoring** — stale feed is UNAVAILABLE, never a quiet all-clear; no entries on stale data | `engine.ts → tryEntries()` staleness gate (15 s) |
| **R-multiple review** — every closed trade is graded in R (pnl ÷ risk budgeted at entry), shown on the trades list | `Trade.riskUsd` column, R badge in `TradesCard`, R in bot thoughts |
| **Unknown-result discipline** — a failed/timeout send is unknown, not failed; never blind-retry (cooldown + reconcile via account sync instead) | `engine.ts → openPosition/closePosition` live paths |
| **Per-coin max leverage** — never above the exchange's own tier | `engine.ts → openPosition()` via `market.maxLeverageOf()` |
| **Liquidity guard** — notional ≤ ~0.1% of the coin's 24h volume; dead markets (< $500K/day) never traded | `engine.ts → openPosition()`, `market.ts → liquidCoins()` |

## Not ported (deliberately)

- **Exchange-resting TP/SL trigger orders** — this bot manages exits in software
  every 2.5 s tick with priority-fresh data for held coins. Resting triggers are
  the safer design for unattended mainnet accounts; revisit before scaling live size.
- **Desk roles / ticket approval flow** — designed for human-in-the-loop agent
  chats; the engine automates the risk *numbers* instead.

## Reference copies

- `skills/` — the 17 original desk skills (risk limits, execution protocol,
  trade lifecycle, strategy lab, monitoring, incident response, post-trade
  review, Hyperliquid API references…)
- `agents/` — the 7 role profiles (desk lead, market analyst, research analyst,
  strategist, risk manager, execution trader, trade reviewer)
- `rules/`, `hooks/` — Cursor rule + exchange write-gate hook
- `SETUP.md`, `README.md`, `CHANGELOG.md`, `plugin.json`, `template/grok-bot.json`
  — original docs, unmodified
