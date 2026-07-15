import { http } from './http'
import type { Job, TargetPlatform } from '../types'

export interface CreateJobResponse {
  jobId: string
  status: Job['status']
}

/** POST /jobs (Req 4.1-4.4). */
export function createJob(
  sourceKeys: string[],
  targets: TargetPlatform[],
): Promise<CreateJobResponse> {
  return http.post<CreateJobResponse>('/jobs', { sourceKeys, targets })
}

/** GET /jobs/{jobId} (Req 4.5, 4.6, 16.6, 16.7). */
export function getJob(jobId: string): Promise<Job> {
  return http.get<Job>(`/jobs/${jobId}`)
}
