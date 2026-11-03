'use client'

interface SparklineProps {
  points: number[]
  baseline: number
  height?: number
}

/** Smooth green equity sparkline with dashed baseline + pulsing end dot. */
export function Sparkline({ points, baseline, height = 72 }: SparklineProps) {
  const W = 300
  const H = 80
  const data = points.length >= 2 ? points : [baseline, baseline]
  const min = Math.min(...data, baseline)
  const max = Math.max(...data, baseline)
  const pad = Math.max((max - min) * 0.15, 0.5)
  const lo = min - pad
  const hi = max + pad

  const xOf = (i: number) => (i / (data.length - 1)) * W
  const yOf = (v: number) => H - ((v - lo) / (hi - lo)) * H

  // Catmull-Rom → cubic bezier for a smooth cute curve
  let d = `M ${xOf(0)} ${yOf(data[0])}`
  for (let i = 0; i < data.length - 1; i++) {
    const p0 = data[Math.max(0, i - 1)]
    const p1 = data[i]
    const p2 = data[i + 1]
    const p3 = data[Math.min(data.length - 1, i + 2)]
    const c1x = xOf(i) + (xOf(i + 1) - xOf(i)) / 3
    const c1y = yOf(p1) + ((yOf(p2) - yOf(p0)) / 6)
    const c2x = xOf(i + 1) - (xOf(i + 1) - xOf(i)) / 3
    const c2y = yOf(p2) - ((yOf(p3) - yOf(p1)) / 6)
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xOf(i + 1)} ${yOf(p2)}`
  }
  const areaD = `${d} L ${W} ${H} L 0 ${H} Z`

  const lastY = yOf(data[data.length - 1])
  const lastYPct = (lastY / H) * 100
  const baselineYPct = (yOf(baseline) / H) * 100
  const goingUp = data[data.length - 1] >= baseline

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22C55E" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#22C55E" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* dashed baseline */}
        <line
          x1="0"
          x2={W}
          y1={yOf(baseline)}
          y2={yOf(baseline)}
          stroke="#C9C9CE"
          strokeWidth="1.5"
          strokeDasharray="5 6"
          vectorEffect="non-scaling-stroke"
        />
        <path d={areaD} fill="url(#spark-fill)" />
        <path
          d={d}
          fill="none"
          stroke={goingUp ? '#22C55E' : '#EF4444'}
          strokeWidth="2.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* pulsing end dot */}
      <div
        className="absolute right-0 -translate-y-1/2 translate-x-1/2"
        style={{ top: `${lastYPct}%` }}
      >
        <div className="relative">
          <div
            className="animate-dot-flash absolute inset-0 rounded-full"
            style={{ background: goingUp ? '#22C55E' : '#EF4444' }}
          />
          <div
            className="relative h-3 w-3 rounded-full border-2 border-white shadow"
            style={{ background: goingUp ? '#22C55E' : '#EF4444' }}
          />
        </div>
      </div>
      {/* hide baseline dot marker (subtle tick) */}
      <div
        className="pointer-events-none absolute left-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C9C9CE]"
        style={{ top: `${baselineYPct}%` }}
      />
    </div>
  )
}
