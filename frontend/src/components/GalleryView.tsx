import type { Clip, CompilationGroup } from '../types'
import { ClipCard } from './ClipCard'

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

/** Horizontally scrollable row of rich clip cards. When `groups` is provided
 * (Compilation mode), renders one titled reel section per compilation with
 * light add/remove curation; otherwise a single flat row of all clips. */
export function GalleryView({
  clips,
  groups,
  videoId,
  onOpenScoreDetails,
  onAddToCompilation,
  onRemoveFromCompilation,
}: GalleryViewProps) {
  function renderCard(clip: Clip, onRemove?: () => void) {
    return (
      <ClipCard
        key={clip.clipId}
        clip={clip}
        videoId={videoId}
        onOpenScoreDetails={() => onOpenScoreDetails(clip.clipId)}
        onRemove={onRemove}
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
      <div>
        {groups.map((group) => {
          const memberIds = new Set(group.clips.map((clip) => clip.clipId))
          const candidates = clips.filter(
            (clip) => !memberIds.has(clip.clipId),
          )
          const heading = group.titleNative || group.titleEnglish || group.id
          return (
            <section
              key={group.id}
              className="clip-section comp-section"
              aria-label={`Compilation reel: ${heading}`}
            >
              <header className="comp-header">
                <div className="comp-title">
                  <h2>{heading}</h2>
                  {group.titleNative && group.titleEnglish && (
                    <p className="comp-en">{group.titleEnglish}</p>
                  )}
                </div>
                <span className="comp-count">
                  {group.clips.length}{' '}
                  {group.clips.length === 1 ? 'clip' : 'clips'}
                </span>
              </header>
              {group.reason && <p className="comp-reason">{group.reason}</p>}
              <div className="clip-row">
                {group.clips.map((clip) =>
                  renderCard(
                    clip,
                    onRemoveFromCompilation
                      ? () => onRemoveFromCompilation(group.id, clip.clipId)
                      : undefined,
                  ),
                )}
                {onAddToCompilation && candidates.length > 0 && (
                  <details className="comp-add">
                    <summary>＋ Add clip</summary>
                    <div className="comp-add-list">
                      {candidates.map((clip) => (
                        <button
                          type="button"
                          key={clip.clipId}
                          onClick={() =>
                            onAddToCompilation(group.id, clip.clipId)
                          }
                        >
                          <span className="comp-add-score">🔥 {clip.score}</span>
                          <span className="comp-add-title">
                            {clip.titleNative || clip.titleEnglish || clip.clipId}
                          </span>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  return <div className="clip-row">{clips.map((clip) => renderCard(clip))}</div>
}

export default GalleryView
