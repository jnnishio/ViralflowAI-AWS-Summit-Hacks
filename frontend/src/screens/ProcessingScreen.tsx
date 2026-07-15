import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getJob } from '../api/jobApi'
import { connectProgress, type ProgressClient } from '../api/progressApi'
import type { JobStatus } from '../types'

const POLL_INTERVAL_MS = 5000

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
      <section>
        <h1>Processing</h1>
        <p role="alert">Processing failed. Please try again.</p>
      </section>
    )
  }

  return (
    <section>
      <h1>Processing</h1>
      <p>Your VOD is being analyzed.</p>
      <p aria-live="polite">
        {stage ? `Current stage: ${stage}` : 'Starting pipeline...'}
      </p>
      {isPolling && <p>Reconnecting... checking status every 5 seconds.</p>}
    </section>
  )
}

export default ProcessingScreen
