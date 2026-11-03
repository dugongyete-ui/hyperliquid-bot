'use client'

import { coinMeta } from '@/lib/coins'

export type FaceVariant = 'focused' | 'happy' | 'sparkle' | 'blush' | 'smirk'
export type BotStatus = 'scanning' | 'holding' | 'cooling' | 'paused'

interface BotAvatarProps {
  face: FaceVariant
  color: string
  size?: number
  className?: string
  breathe?: boolean
  status?: BotStatus
  pnlPct?: number
}

/**
 * Cute round robot with side knobs, antenna, dark face screen and
 * expressive white eyes — drawn fully in SVG so it scales crisply.
 * The face is alive: it blinks, looks around while scanning, hops when
 * its position is in profit and dozes off while cooling down.
 */
export function BotAvatar({
  face,
  color,
  size = 72,
  className,
  breathe,
  status,
  pnlPct = 0,
}: BotAvatarProps) {
  const gid = `g-${face}-${color.replace('#', '')}`
  const mood: 'up' | 'down' | 'flat' = pnlPct > 0.5 ? 'up' : pnlPct < -0.5 ? 'down' : 'flat'
  const sleeping = status === 'cooling' || status === 'paused'
  const wrapper =
    (sleeping ? 'animate-sleep ' : '') +
    (status === 'holding' && mood === 'up' ? 'animate-hop ' : '') +
    (breathe && !sleeping && !(status === 'holding' && mood === 'up') ? 'animate-breathe ' : '') +
    'bot-alive ' +
    (status === 'scanning' ? 'bot-look ' : '') +
    (className ?? '')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 116"
      className={wrapper.trim()}
      role="img"
      aria-label="Cute robot avatar"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.82" />
        </linearGradient>
      </defs>

      {/* antenna */}
      <g className="bot-antenna">
        <circle cx="60" cy="12" r="7.5" fill={`url(#${gid})`} />
        <rect x="57.5" y="16" width="5" height="12" rx="2.5" fill={`url(#${gid})`} />
      </g>

      {/* side knobs */}
      <circle cx="15" cy="66" r="10" fill={`url(#${gid})`} />
      <circle cx="105" cy="66" r="10" fill={`url(#${gid})`} />

      {/* head */}
      <circle cx="60" cy="64" r="42" fill={`url(#${gid})`} />
      {/* gloss */}
      <ellipse cx="44" cy="42" rx="18" ry="10" fill="white" opacity="0.22" transform="rotate(-24 44 42)" />

      {/* face screen */}
      <rect x="27" y="46" width="66" height="42" rx="21" fill="#17171C" />

      <g className="bot-eyes">
        {face === 'focused' && (
          <g>
            <circle cx="46" cy="63" r="5" fill="white" />
            <circle cx="74" cy="63" r="5" fill="white" />
            <path d="M52 75 H68" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
          </g>
        )}

        {face === 'happy' && (
          <g>
            <path d="M39 65 Q46 56 53 65" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M67 65 Q74 56 81 65" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M53 73 Q60 79 67 73" stroke="white" strokeWidth="4" strokeLinecap="round" fill="none" />
          </g>
        )}

        {face === 'sparkle' && (
          <g>
            <circle cx="46" cy="63" r="7" fill="white" />
            <circle cx="74" cy="63" r="7" fill="white" />
            <circle cx="47.5" cy="61.5" r="2.2" fill="#17171C" />
            <circle cx="75.5" cy="61.5" r="2.2" fill="#17171C" />
            <path d="M53 76 H67" stroke="white" strokeWidth="4" strokeLinecap="round" />
          </g>
        )}

        {face === 'blush' && (
          <g>
            <path d="M39 64 Q46 55 53 64" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M67 64 Q74 55 81 64" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M49 71 Q60 83 71 71 Z" fill="white" />
            <ellipse cx="33" cy="76" rx="5.5" ry="3.5" fill="#FB7185" opacity="0.85" />
            <ellipse cx="87" cy="76" rx="5.5" ry="3.5" fill="#FB7185" opacity="0.85" />
          </g>
        )}

        {face === 'smirk' && (
          <g>
            <path d="M40 63 H52" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
            <path d="M68 63 H80" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
            <path d="M52 73 Q61 78 70 70" stroke="white" strokeWidth="4" strokeLinecap="round" fill="none" />
          </g>
        )}
      </g>

      {sleeping && (
        <text x="88" y="52" fontSize="15" fontWeight="800" fill="#8E8E93" className="animate-soft-pulse">
          z
        </text>
      )}
      {status === 'holding' && mood === 'down' && (
        <text x="86" y="46" fontSize="14" fontWeight="800">
          💧
        </text>
      )}
    </svg>
  )
}

/** Black app-icon style avatar for the head bot (like Grok's icon). */
export function HeadBotAvatar({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`bot-alive ${className ?? ''}`}
      role="img"
      aria-label="Bot app icon"
    >
      <defs>
        <linearGradient id="headbot-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2A2A31" />
          <stop offset="100%" stopColor="#101014" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="27" fill="url(#headbot-g)" />
      <g className="bot-eyes" style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}>
        <rect x="27" y="33" width="15" height="34" rx="7.5" fill="white" />
        <rect x="58" y="33" width="15" height="34" rx="7.5" fill="white" />
      </g>
    </svg>
  )
}
