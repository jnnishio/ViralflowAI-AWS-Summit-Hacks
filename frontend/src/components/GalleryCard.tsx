import type { Clip } from '../types'
import { ThumbnailImage } from './ThumbnailImage'

export interface GalleryCardProps {
  clip: Clip
  selected: boolean
  onToggleSelect: () => void
  onOpenCrop: () => void
  onOpenScoreDetails: () => void
}

/**
 * Task 22.4: Gallery card, showing the video preview via presigned
 * videoUrl when available (Req 7.8), falling back to the thumbnail
 * otherwise. Height is bounded to [60%, 95%] of viewport height (Req 18.4,
 * Property 33) via a CSS variable / clamp() so the bound holds at any
 * viewport size, not just a value computed once on mount.
 */
export function GalleryCard({
  clip,
  selected,
  onToggleSelect,
  onOpenCrop,
  onOpenScoreDetails,
}: GalleryCardProps) {
  return (
    <article
      data-selected={selected}
      aria-label={clip.titleNative}
      style={{
        // Req 18.4 / Property 33: card height must be within [60%, 95%] of
        // viewport height at any viewport size; 80vh sits comfortably
        // inside that range.
        height: '80vh',
        display: 'inline-block',
      }}
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
        {clip.videoUrl ? (
          <video src={clip.videoUrl} muted playsInline />
        ) : (
          <ThumbnailImage src={clip.thumbUrl} alt={clip.titleNative} />
        )}
      </button>

      <h3>{clip.titleNative}</h3>
      <p>{clip.titleEnglish}</p>
      <span>{clip.mood}</span>
      <button type="button" onClick={onOpenScoreDetails}>
        Score: {clip.score.toFixed(2)}
      </button>
    </article>
  )
}

export default GalleryCard
