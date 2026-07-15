import type { Clip, CompilationGroup } from '../types'
import { ClipCard } from './ClipCard'

export interface GalleryViewProps {
  clips: Clip[]
  groups: CompilationGroup[] | null
  selectedClipIds: Set<string>
  /** `video_{streamId}` — threaded to each card's "Open in Editor" link. */
  videoId?: string
  onToggleSelect: (clipId: string) => void
  onOpenCrop: (clipId: string) => void
  onOpenScoreDetails: (clipId: string) => void
}

/** Task 22.4: horizontally scrollable row where more than one card is at
 * least partially visible at once (Req 18.3), using the same rich card as
 * the grid (matches out/clips/gallery.html), ordered/grouped consistently
 * with GridView. */
export function GalleryView({
  clips,
  groups,
  selectedClipIds,
  videoId,
  onToggleSelect,
  onOpenCrop,
  onOpenScoreDetails,
}: GalleryViewProps) {
  function renderCard(clip: Clip) {
    return (
      <ClipCard
        key={clip.clipId}
        clip={clip}
        videoId={videoId}
        selected={selectedClipIds.has(clip.clipId)}
        onToggleSelect={() => onToggleSelect(clip.clipId)}
        onOpenCrop={() => onOpenCrop(clip.clipId)}
        onOpenScoreDetails={() => onOpenScoreDetails(clip.clipId)}
      />
    )
  }

  if (groups) {
    return (
      <div>
        {groups.map((group) => (
          <section
            key={group.mood}
            className="clip-section"
            aria-label={`Compilation group: ${group.mood}`}
          >
            <h2>{group.mood}</h2>
            <div className="clip-row">{group.clips.map(renderCard)}</div>
          </section>
        ))}
      </div>
    )
  }

  return <div className="clip-row">{clips.map(renderCard)}</div>
}

export default GalleryView
