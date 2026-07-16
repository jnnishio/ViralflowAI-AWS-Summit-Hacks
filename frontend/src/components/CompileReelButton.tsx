import { useState } from 'react'
import { compileCompilation } from '../api/compilations'
import { EDITOR_BASE_URL } from '../api/config'
import { useI18n } from '../i18n'
import type { CompilationGroup } from '../types'

export interface CompileReelButtonProps {
  /** The job whose reel is being compiled (drives the compile API call). */
  jobId?: string
  /** `video_{streamId}` — the editor target the compiled reel opens in. */
  videoId?: string
  group: CompilationGroup
}

type Phase = 'idle' | 'compiling' | 'ready' | 'error'

/**
 * "Compile this reel" — auto-edits a whole compilation into a real multi-clip
 * video using the same LLM brain + OpenCut EDL framework as the editor's AI
 * auto-edit (see pipeline/compile_edl.py). While the LLM plans the edit the
 * button mutes and shows a circular spinner; once the EDL is written it
 * brightens into "Open compilation in editor", which deep-links into the
 * editor with `?compilation=` so it loads the reel as one concatenated
 * timeline (remote-clips-manager.ts).
 */
export function CompileReelButton({
  jobId,
  videoId,
  group,
}: CompileReelButtonProps) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  // Editor deep-link: open the reel's first clip's video, flagged as a
  // compilation so the editor loads the generated multi-clip EDL. Mirrors
  // ClipCard's scoped-id scheme ("<streamId>__clip_NN").
  const firstClip = group.clips[0]
  const editorHref =
    videoId && firstClip
      ? `${EDITOR_BASE_URL}/editor/video/${videoId}/edit/${videoId.replace(
          /^video_/,
          '',
        )}__${firstClip.clipId}?compilation=${encodeURIComponent(group.id)}`
      : undefined

  const canCompile = Boolean(jobId) && group.clips.length >= 2

  async function handleCompile() {
    if (!jobId || phase === 'compiling') return
    setPhase('compiling')
    setError(null)
    try {
      await compileCompilation(jobId, group.id)
      setPhase('ready')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : t('compile.failed'))
    }
  }

  if (phase === 'ready' && editorHref) {
    return (
      <a
        className="comp-compile is-ready"
        href={editorHref}
        target="_blank"
        rel="noopener noreferrer"
        title={t('compile.openTitle')}
      >
        <PlayIcon />
        {t('compile.open')}
      </a>
    )
  }

  const compiling = phase === 'compiling'

  return (
    <button
      type="button"
      className={`comp-compile${compiling ? ' is-compiling' : ''}${
        phase === 'error' ? ' is-error' : ''
      }`}
      onClick={handleCompile}
      disabled={!canCompile || compiling}
      aria-busy={compiling}
      title={
        phase === 'error' && error ? error : t('compile.compileTitle')
      }
    >
      {compiling ? (
        <>
          <span className="comp-compile__spinner" aria-hidden="true" />
          {t('compile.compiling')}
        </>
      ) : (
        <>
          <SparkIcon />
          {phase === 'error' ? t('compile.retry') : t('compile.compile')}
        </>
      )}
    </button>
  )
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8.5 13.2 11 15.5 12l-2.3 1-1.2 2.5-1.2-2.5L8.5 12l2.3-1z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

export default CompileReelButton
