import { useI18n } from '../i18n'
import type { Clip, CompilationGroup } from '../types'
import { ClipCard } from './ClipCard'
import { CompilationSection } from './CompilationSection'
import { StoriesCarousel } from './StoriesCarousel'

export interface GalleryViewProps {
  clips: Clip[]
  groups: CompilationGroup[] | null
  /** The job these clips belong to — threaded to each reel's compile action. */
  jobId?: string
  /** `video_{streamId}` — threaded to each card's "Open in Editor" link. */
  videoId?: string
  onOpenScoreDetails: (clipId: string) => void
  /** Compilation curation (only used when `groups` is provided). */
  onAddToCompilation?: (compilationId: string, clipId: string) => void
  onRemoveFromCompilation?: (compilationId: string, clipId: string) => void
}

/** Stories-style focused gallery of rich clip cards. When `groups` is provided
 * (Compilation mode), renders one titled reel section per compilation — each
 * its own carousel with an independent Sort-by-Score control and scroll-in
 * dividers; otherwise a single carousel over all clips. */
export function GalleryView({
  clips,
  groups,
  jobId,
  videoId,
  onOpenScoreDetails,
  onAddToCompilation,
  onRemoveFromCompilation,
}: GalleryViewProps) {
  const { t } = useI18n()
  if (groups) {
    if (groups.length === 0) {
      return <p className="comp-empty">{t('gallery.noReels')}</p>
    }
    return (
      <div className="comp-list">
        {groups.map((group) => {
          const memberIds = new Set(group.clips.map((clip) => clip.clipId))
          const candidates = clips.filter((clip) => !memberIds.has(clip.clipId))
          return (
            <CompilationSection
              key={group.id}
              group={group}
              candidates={candidates}
              jobId={jobId}
              videoId={videoId}
              onOpenScoreDetails={onOpenScoreDetails}
              onAddToCompilation={
                onAddToCompilation
                  ? (clipId) => onAddToCompilation(group.id, clipId)
                  : undefined
              }
              onRemoveFromCompilation={
                onRemoveFromCompilation
                  ? (clipId) => onRemoveFromCompilation(group.id, clipId)
                  : undefined
              }
            />
          )
        })}
      </div>
    )
  }

  return (
    <StoriesCarousel
      clips={clips}
      ariaLabel={t('carousel.suggested')}
      renderCard={(clip, active) => (
        <ClipCard
          clip={clip}
          active={active}
          videoId={videoId}
          onOpenScoreDetails={() => onOpenScoreDetails(clip.clipId)}
        />
      )}
    />
  )
}

export default GalleryView
