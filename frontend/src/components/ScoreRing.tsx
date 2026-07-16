import { useId } from 'react'

export interface ScoreRingProps {
  /** Virality score on a 0–100 scale. */
  score: number
  /** Outer diameter in px. */
  size?: number
  /** Stroke thickness in px. */
  stroke?: number
  /** Optional small caption rendered under the number (e.g. "virality"). */
  label?: string
}

/**
 * Modern circular "virality" indicator — a soft track ring with a gradient
 * progress arc and rounded caps, mirroring the reference score dial. Replaces
 * the old 🔥 emoji. The arc length maps the 0–100 score onto the ring, and the
 * numeric score sits in the center.
 */
export function ScoreRing({
  score,
  size = 60,
  stroke = 7,
  label,
}: ScoreRingProps) {
  const gradientId = useId()
  const clamped = Math.min(Math.max(score, 0), 100)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (clamped / 100) * circumference

  return (
    <div
      className="score-ring"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Virality score ${Math.round(clamped)} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ring-track)"
          strokeWidth={stroke}
        />
        {/* Progress arc — starts at 12 o'clock, sweeps clockwise. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 480ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="score-ring__value" aria-hidden="true">
        <span className="score-ring__num">{Math.round(clamped)}</span>
        {label && <span className="score-ring__label">{label}</span>}
      </div>
    </div>
  )
}

export default ScoreRing
