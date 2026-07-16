import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { useScrollReveal } from '../hooks/useScrollReveal'
import { sortClipsByScore } from '../state/gridState'
import type { Clip, CompilationGroup, SortOrder } from '../types'
import { ClipCard } from './ClipCard'
import { CompileReelButton } from './CompileReelButton'
import { ScoreRing } from './ScoreRing'
import { SortControl } from './SortControl'
import { StoriesCarousel } from './StoriesCarousel'

export interface CompilationSectionProps {
  group: CompilationGroup
  /** Clips not already in this reel — offered in the "Add clip" dropdown. */
  candidates: Clip[]
  /** The job this reel belongs to — drives the "Compile this reel" call. */
  jobId?: string
  /** `video_{streamId}` — threaded to each card's "Open in Editor" link. */
  videoId?: string
  onOpenScoreDetails: (clipId: string) => void
  onAddToCompilation?: (clipId: string) => void
  onRemoveFromCompilation?: (clipId: string) => void
}

/**
 * One themed compilation reel: a leading decorative divider, a header (bilingual
 * title, then a control cluster with the clip count, its OWN Sort-by-Score
 * control, and an "Add clip" dropdown), and the stories-style carousel. Sorting
 * is local so each reel is ordered independently. The whole block reveals with
 * a subtle scroll-in effect.
 */
export function CompilationSection({
  group,
  candidates,
  jobId,
  videoId,
  onOpenScoreDetails,
  onAddToCompilation,
  onRemoveFromCompilation,
}: CompilationSectionProps) {
  const { t } = useI18n()
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const { ref, revealed } = useScrollReveal<HTMLDivElement>()

  const sortedClips = useMemo(
    () => sortClipsByScore(group.clips, sortOrder),
    [group.clips, sortOrder],
  )

  const heading = group.titleNative || group.titleEnglish || group.id

  return (
    <div ref={ref} className={`comp-block${revealed ? ' is-visible' : ''}`}>
      <div className="comp-divider" aria-hidden="true">
        <span className="comp-divider__line" />
        <span className="comp-divider__mark" />
        <span className="comp-divider__line" />
      </div>

      <section
        className="comp-section"
        aria-label={t('comp.reelAria', { title: heading })}
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
              {group.clips.length === 1 ? t('comp.clipOne') : t('comp.clipMany')}
            </span>

            <SortControl sortOrder={sortOrder} onChange={setSortOrder} />

            {onAddToCompilation && candidates.length > 0 && (
              <details className="comp-add">
                <summary
                  aria-label={t('comp.addClipAria')}
                  title={t('comp.addClipAria')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                  {t('comp.addClip')}
                </summary>
                <div className="comp-add-list">
                  {candidates.map((clip) => (
                    <button
                      type="button"
                      key={clip.clipId}
                      onClick={() => onAddToCompilation(clip.clipId)}
                    >
                      <ScoreRing score={clip.score} size={30} stroke={4} />
                      <span className="comp-add-title">
                        {clip.titleNative || clip.titleEnglish || clip.clipId}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            )}

            <CompileReelButton jobId={jobId} videoId={videoId} group={group} />
          </div>
        </header>

        {group.reason && <p className="comp-reason">{group.reason}</p>}

        <StoriesCarousel
          clips={sortedClips}
          ariaLabel={t('comp.reelAria', { title: heading })}
          renderCard={(clip, active) => (
            <ClipCard
              clip={clip}
              active={active}
              videoId={videoId}
              onOpenScoreDetails={() => onOpenScoreDetails(clip.clipId)}
              onRemove={
                onRemoveFromCompilation
                  ? () => onRemoveFromCompilation(clip.clipId)
                  : undefined
              }
            />
          )}
        />
      </section>
    </div>
  )
}

export default CompilationSection
