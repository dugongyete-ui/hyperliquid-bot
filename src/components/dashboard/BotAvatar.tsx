'use client'

import { coinMeta } from '@/lib/coins'

export type FaceVariant = 'focused' | 'happy' | 'sparkle' | 'blush' | 'smirk'

interface BotAvatarProps {
  face: FaceVariant
  color: string
  size?: number
  className?: string
  breathe?: boolean
}

/**
 * Cute round robot with side knobs, antenna, dark face screen and
 * expressive white eyes — drawn fully in SVG so it scales crisply.
 */
export function BotAvatar({ face, color, size = 72, className, breathe }: BotAvatarProps) {
  const gid = `g-${face}-${color.replace('#', '')}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 116"
      className={breathe ? `animate-breathe ${className ?? ''}` : className}
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
      <circle cx="60" cy="12" r="7.5" fill={`url(#${gid})`} />
      <rect x="57.5" y="16" width="5" height="12" rx="2.5" fill={`url(#${gid})`} />

      {/* side knobs */}
      <circle cx="15" cy="66" r="10" fill={`url(#${gid})`} />
      <circle cx="105" cy="66" r="10" fill={`url(#${gid})`} />

      {/* head */}
      <circle cx="60" cy="64" r="42" fill={`url(#${gid})`} />
      {/* gloss */}
      <ellipse cx="44" cy="42" rx="18" ry="10" fill="white" opacity="0.22" transform="rotate(-24 44 42)" />

      {/* face screen */}
      <rect x="27" y="46" width="66" height="42" rx="21" fill="#17171C" />

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
      className={className}
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
      <rect x="27" y="33" width="15" height="34" rx="7.5" fill="white" />
      <rect x="58" y="33" width="15" height="34" rx="7.5" fill="white" />
    </svg>
  )
}

/** Small round coin icon with brand color + emoji/letter, with optional agent badge. */
export function CoinIcon({
  coin,
  size = 40,
  badgeColor,
  badgeFace,
}: {
  coin: string
  size?: number
  badgeColor?: string
  badgeFace?: FaceVariant
}) {
  const meta = coinMeta(coin)
  const bg = meta.bg
    ? `linear-gradient(135deg, ${meta.color}, ${meta.bg})`
    : `linear-gradient(135deg, ${meta.color}, ${meta.color}CC)`
  const isEmoji = /\p{Extended_Pictographic}/u.test(meta.label)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full shadow-sm"
        style={{ background: bg }}
      >
        <span
          className="font-extrabold text-white leading-none"
          style={{ fontSize: isEmoji ? size * 0.44 : size * 0.42, paddingTop: isEmoji ? 2 : 0 }}
        >
          {meta.label}
        </span>
      </div>
      {badgeColor && badgeFace && (
        <div className="absolute -bottom-1 -left-1 rounded-full bg-white p-[2px] shadow-md">
          <BotAvatar face={badgeFace} color={badgeColor} size={Math.max(16, size * 0.44)} />
        </div>
      )}
    </div>
  )
}
