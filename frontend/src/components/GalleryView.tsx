import type { CSSProperties } from 'react'
import type { Clip, CompilationGroup } from '../types'
import { GalleryCard } from './GalleryCard'

export interface GalleryViewProps {
  clips: Clip[]
  groups: CompilationGroup[] | null
  selectedClipIds: Set<string>
  onToggleSelect: (clipId: string) => void
  onOpenCrop: (clipId: string) => void
  onOpenScoreDetails: (clipId: string) => void
}

/** Task 22.4: horizontally scrollable row where more than one card is at
 * least partially visible at once (Req 18.3), ordered/grouped consistently
 * with GridView. */
export function GalleryView({
  clips,
  groups,
  selectedClipIds,
  onToggleSelect,
  onOpenCrop,
  onOpenScoreDetails,
}: GalleryViewProps) {
  function renderCard(clip: Clip) {
    return (
      <GalleryCard
        key={clip.clipId}
        clip={clip}
        selected={selectedClipIds.has(clip.clipId)}
        onToggleSelect={() => onToggleSelect(clip.clipId)}
        onOpenCrop={() => onOpenCrop(clip.clipId)}
        onOpenScoreDetails={() => onOpenScoreDetails(clip.clipId)}
      />
    )
  }

  const rowStyle: CSSProperties = {
    display: 'flex',
    overflowX: 'auto',
    scrollSnapType: 'x proximity',
    gap: '1rem',
  }

  if (groups) {
    return (
      <div>
        {groups.map((group) => (
          <section key={group.mood} aria-label={`Compilation group: ${group.mood}`}>
            <h2>{group.mood}</h2>
            <div style={rowStyle}>{group.clips.map(renderCard)}</div>
          </section>
        ))}
      </div>
    )
  }

  return <div style={rowStyle}>{clips.map(renderCard)}</div>
}

export default GalleryView
