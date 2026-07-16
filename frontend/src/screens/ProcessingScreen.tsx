import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getJob } from '../api/jobApi'
import { connectProgress, type ProgressClient } from '../api/progressApi'
import type { JobStatus } from '../types'
import './ProcessingScreen.css'

const POLL_INTERVAL_MS = 5000

/**
 * Canonical, display-ordered pipeline phases shown in the stepper. The
 * backend emits stage strings in two dialects — cloud names ("fusion/scoring",
 * "visual analysis") and the dev mock's human labels ("Scoring highlight
 * candidates", "Analyzing video (Rekognition)") — so we map either onto one
 * of these phases rather than assuming a fixed vocabulary.
 */
const PIPELINE_PHASES = [
  { key: 'prepare', label: 'Preparing video' },
  { key: 'transcribe', label: 'Transcribing speech' },
  { key: 'visual', label: 'Analyzing video' },
  { key: 'audio', label: 'Analyzing audio' },
  { key: 'chat', label: 'Analyzing chat' },
  { key: 'score', label: 'Scoring & selecting highlights' },
  { key: 'render', label: 'Rendering & finalizing' },
] as const

/** First-match-wins rules mapping any stage string to a phase key. More
 * specific patterns are listed before generic ones (e.g. "align" beats the
 * generic "video" in "Aligning chat with video"). */
const STAGE_TO_PHASE: [RegExp, (typeof PIPELINE_PHASES)[number]['key']][] = [
  [/rekognition|visual/i, 'visual'],
  [/align/i, 'chat'],
  [/\bchat\b/i, 'chat'],
  [/\baudio\b/i, 'audio'],
  [/transcrib|transcript|speech/i, 'transcribe'],
  [/normalize|proxy|prepar/i, 'prepare'],
  [/fusion|scoring|director|select|categor/i, 'score'],
  [/render|finaliz|contract|edl|publish|pipeline/i, 'render'],
  [/\bvideo\b/i, 'visual'],
]

function phaseIndexForStage(stage: string | null): number {
  if (!stage) return -1
  for (const [re, key] of STAGE_TO_PHASE) {
    if (re.test(stage)) {
      return PIPELINE_PHASES.findIndex((p) => p.key === key)
    }
  }
  return -1
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  )
}

export function ProcessingScreen() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()

  const [stage, setStage] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus>('pending')
  const [isPolling, setIsPolling] = useState(false)

  const terminalRef = useRef(false)
  const clientRef = useRef<ProgressClient | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId) return
    const currentJobId = jobId
    terminalRef.current = false

    function goToTerminalState(nextStatus: JobStatus) {
      if (terminalRef.current) return
      terminalRef.current = true
      setStatus(nextStatus)
      stopPolling()
      clientRef.current?.close()
      if (nextStatus === 'completed') {
        // Req 5.7: navigate to Highlights_Grid on completion.
        navigate(`/highlights/${currentJobId}`)
      }
      // Req 5.8: failed status shows the error state on this screen
      // instead of navigating.
    }

    function startPolling() {
      if (pollTimerRef.current) return
      setIsPolling(true)
      pollTimerRef.current = setInterval(() => {
        getJob(currentJobId)
          .then((job) => {
            setStatus(job.status)
            if (job.status === 'completed' || job.status === 'failed') {
              goToTerminalState(job.status)
            }
          })
          .catch(() => {
            // Req 16.5: keep last known state, keep polling.
          })
      }, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      setIsPolling(false)
    }

    // Req 5.1: connect + subscribe to Progress_API for this job.
    clientRef.current = connectProgress(jobId, {
      onEvent: (event) => {
        setStage(event.stage)
        if (event.status === 'completed' && event.stage === 'pipeline') {
          goToTerminalState('completed')
        } else if (event.status === 'failed') {
          goToTerminalState('failed')
        } else {
          setStatus('in_progress')
        }
        stopPolling()
      },
      // Req 5.5: WebSocket unavailable/drops -> poll at a fixed 5s interval
      // until reconnect or a terminal status.
      onClose: () => {
        if (!terminalRef.current) startPolling()
      },
      onError: () => {
        if (!terminalRef.current) startPolling()
      },
    })

    return () => {
      stopPolling()
      clientRef.current?.close()
    }
  }, [jobId, navigate])

  if (status === 'failed') {
    return (
      <section className="processing-screen">
        <h1 className="processing-screen__title">Processing</h1>
        <div className="proc-error">
          <span className="proc-error__icon" aria-hidden="true">
            <AlertIcon />
          </span>
          <p className="proc-error__text" role="alert">
            Processing failed. Please try again.
          </p>
        </div>
      </section>
    )
  }

  const activeIndex = phaseIndexForStage(stage)

  return (
    <section className="processing-screen">
      <h1 className="processing-screen__title">Processing</h1>
      <p className="processing-screen__subtitle">Your VOD is being analyzed.</p>

      <div className="proc-orb" aria-hidden="true">
        <span className="proc-orb__ring" />
        <span className="proc-orb__ring" />
        <span className="proc-orb__ring" />
        <div className="proc-orb__disc">
          <div className="proc-eq">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>

      <p className="proc-stage" key={stage ?? 'start'} aria-live="polite">
        {stage ?? 'Starting pipeline\u2026'}
      </p>

      <ol className="proc-steps">
        {PIPELINE_PHASES.map((phase, index) => {
          // Before we've matched any stage, keep everything upcoming.
          const state =
            activeIndex === -1
              ? 'upcoming'
              : index < activeIndex
                ? 'done'
                : index === activeIndex
                  ? 'active'
                  : 'upcoming'
          return (
            <li key={phase.key} className={`proc-step is-${state}`}>
              <span className="proc-step__marker">
                {state === 'done' && <CheckIcon />}
              </span>
              <span className="proc-step__label">{phase.label}</span>
            </li>
          )
        })}
      </ol>

      {isPolling && (
        <div className="proc-reconnect" role="status">
          <span className="proc-reconnect__dot" aria-hidden="true" />
          Reconnecting… checking status every 5 seconds.
        </div>
      )}
    </section>
  )
}

export default ProcessingScreen
