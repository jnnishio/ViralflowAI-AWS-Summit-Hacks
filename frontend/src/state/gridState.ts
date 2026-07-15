import type { Clip, CompilationGroup, GridState, SortOrder, ViewMode } from '../types'

/** Task 20.1: GridState initial value + reducer actions. */
export function initialGridState(clips: Clip[] = []): GridState {
  return {
    clips,
    sortOrder: 'desc', // Req 8.3
    viewMode: 'gallery', // Req 18.2
    compilationMode: false,
    selectedClipIds: new Set(),
    activeScoreDetailsClipId: null,
    cropViewClipId: null,
  }
}

export type GridAction =
  | { type: 'setClips'; clips: Clip[] }
  | { type: 'setSortOrder'; sortOrder: SortOrder }
  | { type: 'setViewMode'; viewMode: ViewMode }
  | { type: 'setCompilationMode'; compilationMode: boolean }
  | { type: 'toggleSelection'; clipId: string }
  | { type: 'clearSelection' }
  | { type: 'setActiveScoreDetails'; clipId: string | null }
  | { type: 'setCropViewClip'; clipId: string | null }
  | { type: 'updateClip'; clipId: string; patch: Partial<Clip> }

export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case 'setClips':
      return { ...state, clips: action.clips }
    case 'setSortOrder':
      // Req 10.4, 12.5, 18.6 (Property 22): changing sort order must not
      // touch selection or compilation mode.
      return { ...state, sortOrder: action.sortOrder }
    case 'setViewMode':
      // Req 18.6 (Property 22): view mode switch preserves selection, sort
      // order, and compilation mode.
      return { ...state, viewMode: action.viewMode }
    case 'setCompilationMode':
      // Req 12.5 (Property 22): toggling compilation mode preserves selection.
      return { ...state, compilationMode: action.compilationMode }
    case 'toggleSelection': {
      const next = new Set(state.selectedClipIds)
      if (next.has(action.clipId)) {
        next.delete(action.clipId)
      } else {
        next.add(action.clipId)
      }
      return { ...state, selectedClipIds: next }
    }
    case 'clearSelection':
      return { ...state, selectedClipIds: new Set() }
    case 'setActiveScoreDetails':
      return { ...state, activeScoreDetailsClipId: action.clipId }
    case 'setCropViewClip':
      return { ...state, cropViewClipId: action.clipId }
    case 'updateClip':
      return {
        ...state,
        clips: state.clips.map((clip) =>
          clip.clipId === action.clipId ? { ...clip, ...action.patch } : clip,
        ),
      }
    default:
      return state
  }
}

/** Property 15: score in the selected direction, clipId ascending tiebreak. */
function compareClips(a: Clip, b: Clip, sortOrder: SortOrder): number {
  const direction = sortOrder === 'desc' ? -1 : 1
  if (a.score !== b.score) {
    return (a.score - b.score) * direction
  }
  return a.clipId < b.clipId ? -1 : a.clipId > b.clipId ? 1 : 0
}

/**
 * Task 20.2: pure derivation of what to render from GridState. When
 * compilationMode is off, returns a flat sorted list. When on, returns
 * Compilation_Group sections ordered alphabetically by mood (Req 12.2),
 * each internally sorted the same way (Req 8.4).
 */
export function deriveDisplayList(state: GridState): Clip[] {
  return [...state.clips].sort((a, b) => compareClips(a, b, state.sortOrder))
}

export function deriveCompilationGroups(state: GridState): CompilationGroup[] {
  const byMood = new Map<string, Clip[]>()
  for (const clip of state.clips) {
    const list = byMood.get(clip.mood) ?? []
    list.push(clip)
    byMood.set(clip.mood, list)
  }
  return [...byMood.entries()]
    .sort(([moodA], [moodB]) => (moodA < moodB ? -1 : moodA > moodB ? 1 : 0))
    .map(([mood, clips]) => ({
      mood,
      clips: [...clips].sort((a, b) => compareClips(a, b, state.sortOrder)),
    }))
}
