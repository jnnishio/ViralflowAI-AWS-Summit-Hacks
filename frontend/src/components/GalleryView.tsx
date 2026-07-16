import type { Clip, CompilationGroup } from '../types'
import { ClipCard } from './ClipCard'
import { ScoreRing } from './ScoreRing'
import { StoriesCarousel } from './StoriesCarousel'

export interface GalleryViewProps {
  clips: Clip[]
  groups: CompilationGroup[] | null
  /** `video_{streamId}` — threaded to each card's "Open in Editor" link. */
  videoId?: string
  onOpenScoreDetails: (clipId: string) => void
  /** Compilation curation (only used when `groups` is provided). */
  onAddToCompilation?: (compilationId: string, clipId: string) => void
  onRemoveFromCompilation?: (compilationId: string, clipId: string) => void
}

/** Stories-style focused gallery of rich clip cards. When `groups` is provided
 * (Compilation mode), renders one titled reel section per compilation — each
 * its own carousel — with light add/remove curation; otherwise a single
 * carousel over all clips. */
export function GalleryView({
  clips,
  groups,
  videoId,
  onOpenScoreDetails,
  onAddToCompilation,
  onRemoveFromCompilation,
}: GalleryViewProps) {
  function renderCarousel(
    list: Clip[],
    ariaLabel: string,
    onRemove?: (clipId: string) => void,
  ) {
    return (
      <StoriesCarousel
        clips={list}
        ariaLabel={ariaLabel}
        renderCard={(clip, active) => (
          <ClipCard
            clip={clip}
            active={active}
            videoId={videoId}
            onOpenScoreDetails={() => onOpenScoreDetails(clip.clipId)}
            onRemove={onRemove ? () => onRemove(clip.clipId) : undefined}
          />
        )}
      />
    )
  }

  if (groups) {
    if (groups.length === 0) {
      return (
        <p className="comp-empty">
          No compilation reels were suggested for these clips.
        </p>
      )
    }
    return (
      <div className="comp-list">
        {groups.map((group) => {
          const memberIds = new Set(group.clips.map((clip) => clip.clipId))
          const candidates = clips.filter(
            (clip) => !memberIds.has(clip.clipId),
          )
          const heading = group.titleNative || group.titleEnglish || group.id
          return (
            <section
              key={group.id}
              className="comp-section"
              aria-label={`Compilation reel: ${heading}`}
            >
              <header className="comp-header">
                <div className="comp-title">
                  <h2>{heading}</h2>
                  {group.titleNative && group.titleEnglish && (
                    <p className="comp-en">{group.titleEnglish}</p>
                  )}
                </div>
                <div className="comp-header__meta">
                  <span className="comp-count">
                    {group.clips.length}{' '}
                    {group.clips.length === 1 ? 'clip' : 'clips'}
                  </span>
                  {onAddToCompilation && candidates.length > 0 && (
                    <details className="comp-add">
                      <summary aria-label="Add clip to this reel" title="Add clip to this reel">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                          aria-hidden="true">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                        Add clip
                      </summary>
                      <div className="comp-add-list">
                        {candidates.map((clip) => (
                          <button
                            type="button"
                            key={clip.clipId}
                            onClick={() =>
                              onAddToCompilation(group.id, clip.clipId)
                            }
                          >
                            <ScoreRing score={clip.score} size={30} stroke={4} />
                            <span className="comp-add-title">
                              {clip.titleNative ||
                                clip.titleEnglish ||
                                clip.clipId}
                            </span>
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </header>
              {group.reason && <p className="comp-reason">{group.reason}</p>}

              {renderCarousel(
                group.clips,
                `Compilation reel: ${heading}`,
                onRemoveFromCompilation
                  ? (clipId) => onRemoveFromCompilation(group.id, clipId)
                  : undefined,
              )}
            </section>
          )
        })}
      </div>
    )
  }

  return renderCarousel(clips, 'Suggested highlights')
}

export default GalleryView
