export function fmtUsd(n: number, decimals = 2): string {
  const sign = n < 0 ? '-' : ''
  return (
    sign +
    '$' +
    Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

export function fmtSignedUsd(n: number, decimals = 2): string {
  return (n >= 0 ? '+' : '-') + fmtUsd(Math.abs(n), decimals).replace('-', '')
}

export function fmtPct(n: number, decimals = 1): string {
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%'
}

export function fmtPx(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(3)
  if (n >= 0.01) return n.toFixed(4)
  return n.toFixed(6)
}

export function fmtMult(n: number): string {
  return n.toFixed(2) + '×'
}

export function fmtSizeUsd(n: number): string {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K'
  return '$' + n.toFixed(0)
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  return h + 'h'
}

export function fmtHeld(sec: number): string {
  if (sec < 60) return sec.toFixed(1).replace('.0', '') + 's'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s}s`
}
