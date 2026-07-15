/**
 * Shared wire-shape types (Task 16.2), matching design.md's Data Models /
 * API contract section exactly so the frontend and backend agree on field
 * names without any translation layer.
 */

export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type TargetPlatform = 'tiktok' | 'reels' | 'shorts'

export interface Job {
  jobId: string
  status: JobStatus
  targets: TargetPlatform[]
  createdAt: string
}

export interface ClipFactors {
  chat: number
  audio: number
  visual: number
  speech: number
}

export interface Clip {
  clipId: string
  start: number
  end: number
  score: number
  factors: ClipFactors
  mood: string
  momentType: string
  titleNative: string
  titleEnglish: string
  caption: string
  hashtags: string[]
  thumbUrl: string | null
  videoUrl: string | null
  cropConfirmed: boolean
}

export type SortOrder = 'desc' | 'asc'

/**
 * Shared grid state: single source of truth for HighlightsGridScreen,
 * driving the GalleryView via deriveDisplayList.
 */
/** A cross-clip compilation reel proposed by the pipeline (compilations.py),
 * referencing its member clips by id. Editable client-side (add/remove). */
export interface Compilation {
  id: string
  titleNative: string
  titleEnglish: string
  reason: string
  clipIds: string[]
}

export interface GridState {
  clips: Clip[]
  compilations: Compilation[]
  sortOrder: SortOrder
  compilationMode: boolean
  activeScoreDetailsClipId: string | null
}

/** A Compilation resolved to its member Clip objects, for rendering. */
export interface CompilationGroup {
  id: string
  titleNative: string
  titleEnglish: string
  reason: string
  clips: Clip[]
}
