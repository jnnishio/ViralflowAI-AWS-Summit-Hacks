import { http } from './http'
import type { Clip, Compilation } from '../types'

/** GET /jobs/{jobId}/clips — clips plus any cross-clip compilation reels. */
export function listClips(
  jobId: string,
): Promise<{ clips: Clip[]; compilations?: Compilation[] }> {
  return http.get<{ clips: Clip[]; compilations?: Compilation[] }>(
    `/jobs/${jobId}/clips`,
  )
}


