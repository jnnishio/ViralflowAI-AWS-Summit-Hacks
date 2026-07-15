import type { Clip, CompilationGroup } from '../types'
import { GridCard } from './GridCard'

export interface GridViewProps {
  clips: Clip[]
  groups: CompilationGroup[] | null
  selectedClipIds: Set<string>
  onToggleSelect: (clipId: string) => void
  onOpenCrop: (clipId: string) => void
  onOpenScoreDetails: (clipId: string) => void
}

/** Task 22.3: compact multi-column grid, one cell per Clip (Property 16),
 * grouped into Compilation_Group sections when `groups` is provided
 * (Req 12.2). */
export function GridView({
  clips,
  groups,
  selectedClipIds,
  onToggleSelect,
  onOpenCrop,
  onOpenScoreDetails,
}: GridViewProps) {
  function renderCard(clip: Clip) {
    return (
      <GridCard
        key={clip.clipId}
        clip={clip}
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
          <section key={group.mood} aria-label={`Compilation group: ${group.mood}`}>
            <h2>{group.mood}</h2>
            <div className="grid">{group.clips.map(renderCard)}</div>
          </section>
        ))}
      </div>
    )
  }

  return <div className="grid">{clips.map(renderCard)}</div>
}

export default GridView
