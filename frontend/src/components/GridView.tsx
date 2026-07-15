import type { Clip, CompilationGroup } from '../types'
import { ClipCard } from './ClipCard'

export interface GridViewProps {
  clips: Clip[]
  groups: CompilationGroup[] | null
  selectedClipIds: Set<string>
  /** `video_{streamId}` — threaded to each card's "Open in Editor" link. */
  videoId?: string
  onToggleSelect: (clipId: string) => void
  onOpenCrop: (clipId: string) => void
  onOpenScoreDetails: (clipId: string) => void
}

/** Task 22.3: responsive multi-column grid, one rich card per Clip
 * (matches out/clips/gallery.html), grouped into Compilation_Group sections
 * when `groups` is provided (Req 12.2). */
export function GridView({
  clips,
  groups,
  selectedClipIds,
  videoId,
  onToggleSelect,
  onOpenCrop,
  onOpenScoreDetails,
}: GridViewProps) {
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
            <div className="clip-grid">{group.clips.map(renderCard)}</div>
          </section>
        ))}
      </div>
    )
  }

  return <div className="clip-grid">{clips.map(renderCard)}</div>
}

export default GridView
