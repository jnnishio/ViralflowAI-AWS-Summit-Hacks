import type { Clip } from '../types'
import { ThumbnailImage } from './ThumbnailImage'

export interface ClipCardProps {
  clip: Clip
  selected: boolean
  onToggleSelect: () => void
  onOpenCrop: () => void
  onOpenScoreDetails: () => void
}

/** Task 22.3: compact grid cell -- thumbnail, titleNative, mood, score
 * (Req 7.3, 18.5), a selection-toggle distinct from the crop-view click
 * target (Req 10.1), and a score-details control (Req 9.1). */
export function GridCard({
  clip,
  selected,
  onToggleSelect,
  onOpenCrop,
  onOpenScoreDetails,
}: ClipCardProps) {
  return (
    <article
      data-selected={selected}
      aria-label={clip.titleNative}
    >
      <label>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${clip.titleNative}`}
        />
        {selected && <span aria-hidden="true">✓</span>}
      </label>

      <button type="button" onClick={onOpenCrop}>
        <ThumbnailImage src={clip.thumbUrl} alt={clip.titleNative} />
      </button>

      <h3>{clip.titleNative}</h3>
      <span>{clip.mood}</span>
      <button type="button" onClick={onOpenScoreDetails}>
        Score: {clip.score.toFixed(2)}
      </button>
    </article>
  )
}

export default GridCard
