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

export type RefinementTargetType = 'clip' | 'group'
export type RefinementActionType = 'chip' | 'freeform'
export type ChipType =
  | 'reorder'
  | 'faster_pacing'
  | 'swap_intro'
  | 'more_reactions'
export type RefinementStatus = 'pending' | 'completed' | 'failed'

export interface Refinement {
  jobId: string
  refinementId: string
  targetType: RefinementTargetType
  targetIds: string[]
  actionType: RefinementActionType
  chipType: ChipType | null
  text: string | null
  status: RefinementStatus
  createdAt: string
}

export interface ConfirmedSelection {
  jobId: string
  handoffId: string
  clipIds: string[]
  createdAt: string
}

export interface HandoffClip {
  clipId: string
  titleNative: string
  thumbUrl: string | null
}

export type SortOrder = 'desc' | 'asc'
export type ViewMode = 'gallery' | 'grid'

/**
 * Shared grid state (design.md's Components and Interfaces section):
 * single source of truth for HighlightsGridScreen, driving GalleryView and
 * GridView identically via deriveDisplayList (Req 18.7).
 */
export interface GridState {
  clips: Clip[]
  sortOrder: SortOrder
  viewMode: ViewMode
  compilationMode: boolean
  selectedClipIds: Set<string>
  activeScoreDetailsClipId: string | null
  cropViewClipId: string | null
}

export interface CompilationGroup {
  mood: string
  clips: Clip[]
}
