import type {
  Clip,
  Compilation,
  CompilationGroup,
  GridState,
  SortOrder,
} from '../types'

/** GridState initial value + reducer actions. */
export function initialGridState(clips: Clip[] = []): GridState {
  return {
    clips,
    compilations: [],
    sortOrder: 'desc', // Req 8.3
    compilationMode: false,
    activeScoreDetailsClipId: null,
  }
}

export type GridAction =
  | { type: 'setClips'; clips: Clip[] }
  | { type: 'setCompilations'; compilations: Compilation[] }
  | { type: 'setSortOrder'; sortOrder: SortOrder }
  | { type: 'setCompilationMode'; compilationMode: boolean }
  | { type: 'addClipToCompilation'; compilationId: string; clipId: string }
  | { type: 'removeClipFromCompilation'; compilationId: string; clipId: string }
  | { type: 'setActiveScoreDetails'; clipId: string | null }

export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case 'setClips':
      return { ...state, clips: action.clips }
    case 'setCompilations':
      return { ...state, compilations: action.compilations }
    case 'setSortOrder':
      return { ...state, sortOrder: action.sortOrder }
    case 'setCompilationMode':
      return { ...state, compilationMode: action.compilationMode }
    case 'addClipToCompilation':
      return {
        ...state,
        compilations: state.compilations.map((comp) =>
          comp.id === action.compilationId &&
          !comp.clipIds.includes(action.clipId)
            ? { ...comp, clipIds: [...comp.clipIds, action.clipId] }
            : comp,
        ),
      }
    case 'removeClipFromCompilation':
      return {
        ...state,
        compilations: state.compilations.map((comp) =>
          comp.id === action.compilationId
            ? {
                ...comp,
                clipIds: comp.clipIds.filter((id) => id !== action.clipId),
              }
            : comp,
        ),
      }
    case 'setActiveScoreDetails':
      return { ...state, activeScoreDetailsClipId: action.clipId }
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

/** Sort a clip list by score in the given direction (clipId ascending
 * tiebreak). Shared by the flat list and per-compilation sort controls. */
export function sortClipsByScore(clips: Clip[], sortOrder: SortOrder): Clip[] {
  return [...clips].sort((a, b) => compareClips(a, b, sortOrder))
}

/** Flat sorted list of all clips (default, non-compilation view). */
export function deriveDisplayList(state: GridState): Clip[] {
  return sortClipsByScore(state.clips, state.sortOrder)
}

/**
 * Resolve each Compilation to its member Clip objects for rendering, in the
 * compilations' given order, each group internally sorted like the flat list.
 * Compilations whose members are all missing are dropped.
 */
export function deriveCompilationGroups(state: GridState): CompilationGroup[] {
  const byId = new Map(state.clips.map((clip) => [clip.clipId, clip]))
  return state.compilations
    .map((comp) => ({
      id: comp.id,
      titleNative: comp.titleNative,
      titleEnglish: comp.titleEnglish,
      reason: comp.reason,
      clips: comp.clipIds
        .map((clipId) => byId.get(clipId))
        .filter((clip): clip is Clip => clip !== undefined)
        .sort((a, b) => compareClips(a, b, state.sortOrder)),
    }))
    .filter((group) => group.clips.length > 0)
}
