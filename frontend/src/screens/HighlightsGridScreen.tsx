import { useCallback, useEffect, useReducer, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useI18n } from '../i18n'
import { listClips } from '../api/highlightsApi'
import { getJob } from '../api/jobApi'
import { CompilationModeToggle } from '../components/CompilationModeToggle'
import { GalleryView } from '../components/GalleryView'
import { ScoreDetailsPanel } from '../components/ScoreDetailsPanel'
import { SortControl } from '../components/SortControl'
import {
  deriveCompilationGroups,
  deriveDisplayList,
  gridReducer,
  initialGridState,
} from '../state/gridState'
import type { JobStatus } from '../types'
import { EDITOR_VIDEO_ID } from '../api/config'
import '../components/clips.css'

/** Suggested-highlights page: a single gallery row of scored clips (sortable,
 * with inline score details), plus Compilation mode which groups the clips
 * into themed reels. Each card deep-links into the built-in editor. */
export function HighlightsGridScreen() {
  const { jobId } = useParams<{ jobId: string }>()
  const { t } = useI18n()

  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [state, dispatch] = useReducer(gridReducer, initialGridState())

  const refetch = useCallback(() => {
    if (!jobId) return
    // Always re-fetch on mount/reconnect rather than reusing client-only
    // cached state (Req 16.2).
    getJob(jobId)
      .then((job) => {
        setJobStatus(job.status)
        setFetchError(null)
        if (job.status === 'completed') {
          return listClips(jobId).then(({ clips, compilations }) => {
            dispatch({ type: 'setClips', clips })
            dispatch({
              type: 'setCompilations',
              compilations: compilations ?? [],
            })
          })
        }
      })
      .catch(() => {
        // Keep last known state visible, show an error indication (Req 16.5).
        setFetchError(t('highlights.refreshError'))
      })
  }, [jobId, t])

  useEffect(() => {
    refetch()
  }, [refetch])

  const displayClips = deriveDisplayList(state)
  const groups = state.compilationMode ? deriveCompilationGroups(state) : null

  // "Open in Editor" target video id. Prefer the configured
  // VITE_EDITOR_VIDEO_ID; fall back to video_{jobId}.
  const editorVideoId =
    EDITOR_VIDEO_ID || (jobId ? `video_${jobId}` : undefined)

  const activeScoreDetailsClip = state.clips.find(
    (clip) => clip.clipId === state.activeScoreDetailsClipId,
  )

  function handleOpenScoreDetails(clipId: string) {
    dispatch({ type: 'setActiveScoreDetails', clipId })
  }

  if (fetchError && state.clips.length === 0 && jobStatus === null) {
    return (
      <section className="highlights">
        <h1>{t('highlights.title')}</h1>
        <p role="alert">{fetchError}</p>
      </section>
    )
  }

  if (jobStatus === 'failed') {
    return (
      <section className="highlights">
        <h1>{t('highlights.title')}</h1>
        <p role="alert">{t('highlights.failed')}</p>
      </section>
    )
  }

  if (jobStatus === 'pending' || jobStatus === 'in_progress') {
    return (
      <section className="highlights">
        <h1>{t('highlights.title')}</h1>
        <p className="highlights__subtitle">{t('highlights.inProgress')}</p>
      </section>
    )
  }

  if (jobStatus === 'completed' && state.clips.length === 0) {
    return (
      <section className="highlights">
        <h1>{t('highlights.title')}</h1>
        <p className="highlights__subtitle">{t('highlights.empty')}</p>
      </section>
    )
  }

  return (
    <section className="highlights">
      <h1>{t('highlights.title')}</h1>
      <p className="highlights__subtitle">{t('highlights.subtitle')}</p>
      {fetchError && <p role="alert">{fetchError}</p>}

      <div className="highlights-controls">
        {/* In compilation mode each reel carries its own sort control, so the
            global one is hidden to avoid a control that spans all groups. */}
        {!state.compilationMode && (
          <SortControl
            sortOrder={state.sortOrder}
            onChange={(sortOrder) =>
              dispatch({ type: 'setSortOrder', sortOrder })
            }
          />
        )}
        <CompilationModeToggle
          compilationMode={state.compilationMode}
          onChange={(compilationMode) =>
            dispatch({ type: 'setCompilationMode', compilationMode })
          }
        />
      </div>

      <GalleryView
        clips={displayClips}
        groups={groups}
        jobId={jobId}
        videoId={editorVideoId}
        onOpenScoreDetails={handleOpenScoreDetails}
        onAddToCompilation={(compilationId, clipId) =>
          dispatch({ type: 'addClipToCompilation', compilationId, clipId })
        }
        onRemoveFromCompilation={(compilationId, clipId) =>
          dispatch({ type: 'removeClipFromCompilation', compilationId, clipId })
        }
      />

      {activeScoreDetailsClip && (
        <ScoreDetailsPanel
          clip={activeScoreDetailsClip}
          onClose={() => dispatch({ type: 'setActiveScoreDetails', clipId: null })}
        />
      )}
    </section>
  )
}

export default HighlightsGridScreen
