import type { Clip, ClipFactors } from '../types'

const FACTOR_ORDER: (keyof ClipFactors)[] = ['chat', 'audio', 'visual', 'speech']

function formatSigned(value: number): string {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}${Math.abs(value).toFixed(2)}`
}

export interface ScoreDetailsPanelProps {
  clip: Clip
  onClose: () => void
}

/**
 * Task 23.1: exactly the 4 factors{} entries, fixed order, sign-prefixed,
 * rounded to 2 decimals (Req 9.2, 9.3). Parent (HighlightsGridScreen) is
 * responsible for the "replace in place when a different clip's score
 * control is activated" behavior (Req 9.6) by just swapping which clip is
 * passed in -- this component itself is a pure function of its `clip` prop.
 */
export function ScoreDetailsPanel({ clip, onClose }: ScoreDetailsPanelProps) {
  return (
    <div role="dialog" aria-label={`Score details for ${clip.titleNative}`}>
      <h2>Score details</h2>
      <dl>
        {FACTOR_ORDER.map((factor) => (
          <div key={factor}>
            <dt>{factor}</dt>
            <dd>{formatSigned(clip.factors[factor])}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

export default ScoreDetailsPanel
