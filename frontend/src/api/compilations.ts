import { http } from './http'

/** Result of compiling a reel: the server planned + wrote its multi-clip EDL
 * (pipeline/compile_edl.py) and returns a one-line summary of the edit. */
export interface CompileResult {
  compilationId: string
  summary: string
}

/**
 * POST /jobs/{jobId}/compilations/{compilationId}/compile — auto-edit a
 * compilation reel into a real multi-clip video EDL using the same LLM brain +
 * OpenCut EDL framework as the editor's AI auto-edit. The generated EDL is
 * stored server-side; the caller then deep-links into the editor with
 * `?compilation={compilationId}` to open it. This is the slow call (LLM
 * planning), so the UI shows a processing state while it runs.
 */
export function compileCompilation(
  jobId: string,
  compilationId: string,
): Promise<CompileResult> {
  return http.post<CompileResult>(
    `/jobs/${jobId}/compilations/${compilationId}/compile`,
  )
}
