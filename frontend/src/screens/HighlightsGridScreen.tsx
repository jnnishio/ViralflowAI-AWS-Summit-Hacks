import { useCallback, useEffect, useReducer, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  confirmSelection,
  cropConfirm,
  createRefinement,
  listClips,
} from '../api/highlightsApi'
import { getJob } from '../api/jobApi'
import { CompilationModeToggle } from '../components/CompilationModeToggle'
import { CropView } from '../components/CropView'
import { GalleryView } from '../components/GalleryView'
import { GridView } from '../components/GridView'
import { ScoreDetailsPanel } from '../components/ScoreDetailsPanel'
import { SelectionBar } from '../components/SelectionBar'
import { SortControl } from '../components/SortControl'
import { ViewModeSwitch } from '../components/ViewModeSwitch'
import {
  deriveCompilationGroups,
  deriveDisplayList,
  gridReducer,
  initialGridState,
} from '../state/gridState'
import type { ChipType, JobStatus } from '../types'

/** Task 22.1: maps Job status to exactly one of: processing indicator
 * (pending/in_progress), error message (failed), empty-state message
 * (completed, zero clips), or the grid/gallery (completed, 1+ clips)
 * (Req 7.4, 7.5, 7.9, Property 17). */
export function HighlightsGridScreen() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()

  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [state, dispatch] = useReducer(gridReducer, initialGridState())
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmationMessage, setConfirmationMessage] = useState<
    string | null
  >(null)

  const refetch = useCallback(() => {
    if (!jobId) return
    // Task 26.1: always re-fetch on mount/reconnect rather than reusing
    // client-only cached state (Req 16.2).
    getJob(jobId)
      .then((job) => {
        setJobStatus(job.status)
        setFetchError(null)
        if (job.status === 'completed') {
          return listClips(jobId).then(({ clips }) => {
            dispatch({ type: 'setClips', clips })
          })
        }
      })
      .catch(() => {
        // Task 26.3: keep last known state visible, show an error
        // indication (Req 16.5).
        setFetchError('Could not refresh job status. Showing last known data.')
      })
  }, [jobId])

  useEffect(() => {
    refetch()
  }, [refetch])

  const displayClips = deriveDisplayList(state)
  const groups = state.compilationMode ? deriveCompilationGroups(state) : null

  const activeScoreDetailsClip = state.clips.find(
    (clip) => clip.clipId === state.activeScoreDetailsClipId,
  )
  const cropViewClip = state.clips.find(
    (clip) => clip.clipId === state.cropViewClipId,
  )

  const selectedGroupCount = groups
    ? groups.filter((group) =>
        group.clips.some((clip) => state.selectedClipIds.has(clip.clipId)),
      ).length
    : 0
  // Req 13.1, 13.2: chips shown iff 1+ Clips selected, or exactly one
  // Compilation_Group selected.
  const showQuickActions =
    state.selectedClipIds.size > 0 &&
    (!state.compilationMode || selectedGroupCount <= 1)

  function handleToggleSelect(clipId: string) {
    dispatch({ type: 'toggleSelection', clipId })
  }

  function handleOpenScoreDetails(clipId: string) {
    dispatch({ type: 'setActiveScoreDetails', clipId })
  }

  function handleOpenCrop(clipId: string) {
    dispatch({ type: 'setCropViewClip', clipId })
  }

  function handleCropConfirm(clipId: string, start: number, end: number) {
    if (!jobId) return Promise.reject(new Error('missing jobId'))
    return cropConfirm(jobId, clipId, start, end).then((updated) => {
      dispatch({
        type: 'updateClip',
        clipId,
        patch: { start: updated.start, end: updated.end, cropConfirmed: true },
      })
      dispatch({ type: 'setCropViewClip', clipId: null })
    })
  }

  function currentSelectionTargets(): {
    targetType: 'clip' | 'group'
    targetIds: string[]
  } {
    if (state.compilationMode && selectedGroupCount === 1 && groups) {
      const group = groups.find((g) =>
        g.clips.some((clip) => state.selectedClipIds.has(clip.clipId)),
      )
      return { targetType: 'group', targetIds: group ? [group.mood] : [] }
    }
    return { targetType: 'clip', targetIds: [...state.selectedClipIds] }
  }

  function handleChipSelect(chipType: ChipType) {
    if (!jobId) return
    const { targetType, targetIds } = currentSelectionTargets()
    setActionError(null)
    createRefinement(jobId, { targetType, targetIds, actionType: 'chip', chipType })
      .then(() => setConfirmationMessage(`"${chipType}" requested.`))
      .catch(() => setActionError('Could not submit that action. Please retry.'))
  }

  function handleFreeformSubmit(text: string) {
    if (!jobId) return
    const { targetType, targetIds } = currentSelectionTargets()
    setActionError(null)
    createRefinement(jobId, { targetType, targetIds, actionType: 'freeform', text })
      .then(() => setConfirmationMessage('Prompt submitted.'))
      .catch(() => setActionError('Could not submit your prompt. Please retry.'))
  }

  function handleConfirmSelection() {
    if (!jobId) return
    if (state.selectedClipIds.size === 0) {
      setActionError('Select at least one clip before confirming.')
      return
    }
    setActionError(null)
    confirmSelection(jobId, [...state.selectedClipIds])
      .then(({ handoffId }) => navigate(`/handoff/${handoffId}`))
      .catch(() => setActionError('Could not confirm selection. Please retry.'))
  }

  if (fetchError && state.clips.length === 0 && jobStatus === null) {
    return (
      <section>
        <h1>Highlights</h1>
        <p role="alert">{fetchError}</p>
      </section>
    )
  }

  if (jobStatus === 'failed') {
    return (
      <section>
        <h1>Highlights</h1>
        <p role="alert">Processing failed.</p>
      </section>
    )
  }

  if (jobStatus === 'pending' || jobStatus === 'in_progress') {
    return (
      <section>
        <h1>Highlights</h1>
        <p>Processing is still in progress...</p>
      </section>
    )
  }

  if (jobStatus === 'completed' && state.clips.length === 0) {
    return (
      <section>
        <h1>Highlights</h1>
        <p>No highlights were found for this job.</p>
      </section>
    )
  }

  return (
    <section>
      <h1>Highlights</h1>
      {fetchError && <p role="alert">{fetchError}</p>}

      <ViewModeSwitch
        viewMode={state.viewMode}
        onChange={(viewMode) => dispatch({ type: 'setViewMode', viewMode })}
      />
      <SortControl
        sortOrder={state.sortOrder}
        onChange={(sortOrder) => dispatch({ type: 'setSortOrder', sortOrder })}
      />
      <CompilationModeToggle
        compilationMode={state.compilationMode}
        onChange={(compilationMode) =>
          dispatch({ type: 'setCompilationMode', compilationMode })
        }
      />

      {state.viewMode === 'grid' ? (
        <GridView
          clips={displayClips}
          groups={groups}
          selectedClipIds={state.selectedClipIds}
          onToggleSelect={handleToggleSelect}
          onOpenCrop={handleOpenCrop}
          onOpenScoreDetails={handleOpenScoreDetails}
        />
      ) : (
        <GalleryView
          clips={displayClips}
          groups={groups}
          selectedClipIds={state.selectedClipIds}
          onToggleSelect={handleToggleSelect}
          onOpenCrop={handleOpenCrop}
          onOpenScoreDetails={handleOpenScoreDetails}
        />
      )}

      <SelectionBar
        selectedCount={state.selectedClipIds.size}
        onClearSelection={() => dispatch({ type: 'clearSelection' })}
        showQuickActions={showQuickActions}
        onChipSelect={handleChipSelect}
        onFreeformSubmit={handleFreeformSubmit}
        errorMessage={actionError}
        confirmationMessage={confirmationMessage}
      />

      <button type="button" onClick={handleConfirmSelection}>
        Confirm selection
      </button>

      {activeScoreDetailsClip && (
        <ScoreDetailsPanel
          clip={activeScoreDetailsClip}
          onClose={() => dispatch({ type: 'setActiveScoreDetails', clipId: null })}
        />
      )}

      {cropViewClip && (
        <CropView
          clip={cropViewClip}
          onConfirm={(start, end) =>
            handleCropConfirm(cropViewClip.clipId, start, end)
          }
          onDismiss={() => dispatch({ type: 'setCropViewClip', clipId: null })}
        />
      )}
    </section>
  )
}

export default HighlightsGridScreen
