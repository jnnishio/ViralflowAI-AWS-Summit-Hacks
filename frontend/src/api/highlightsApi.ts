import { http } from './http'
import type {
  ChipType,
  Clip,
  HandoffClip,
  Refinement,
  RefinementActionType,
  RefinementTargetType,
} from '../types'

/** GET /jobs/{jobId}/clips (Req 7.1, 7.2, 7.6, 7.8). */
export function listClips(jobId: string): Promise<{ clips: Clip[] }> {
  return http.get<{ clips: Clip[] }>(`/jobs/${jobId}/clips`)
}

/** PATCH /jobs/{jobId}/clips/{clipId} (Req 11.5). */
export function cropConfirm(
  jobId: string,
  clipId: string,
  start: number,
  end: number,
): Promise<Pick<Clip, 'clipId' | 'start' | 'end' | 'cropConfirmed'>> {
  return http.patch(`/jobs/${jobId}/clips/${clipId}`, { start, end })
}

export interface CreateRefinementInput {
  targetType: RefinementTargetType
  targetIds: string[]
  actionType: RefinementActionType
  chipType?: ChipType
  text?: string
}

/** POST /jobs/{jobId}/refinements (Req 13.3, 13.4, 14.2). */
export function createRefinement(
  jobId: string,
  input: CreateRefinementInput,
): Promise<Refinement> {
  return http.post<Refinement>(`/jobs/${jobId}/refinements`, input)
}

/** POST /jobs/{jobId}/confirm-selection (Req 15.3). */
export function confirmSelection(
  jobId: string,
  clipIds: string[],
): Promise<{ handoffId: string }> {
  return http.post(`/jobs/${jobId}/confirm-selection`, { clipIds })
}

/** GET /handoff/{handoffId} (Req 15.4). */
export function getHandoff(
  handoffId: string,
): Promise<{ clips: HandoffClip[] }> {
  return http.get(`/handoff/${handoffId}`)
}
