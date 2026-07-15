import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createJob } from '../api/jobApi'
import type { TargetPlatform } from '../types'

const PLATFORM_OPTIONS: { value: TargetPlatform; label: string }[] = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'reels', label: 'Instagram Reels' },
  { value: 'shorts', label: 'YouTube Shorts' },
]

export function PlatformSelectScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const sourceKeys: string[] = (location.state as { sourceKeys?: string[] })
    ?.sourceKeys ?? []

  const [selected, setSelected] = useState<Set<TargetPlatform>>(new Set())
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  )
  const [submitting, setSubmitting] = useState(false)

  function togglePlatform(platform: TargetPlatform) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(platform)) {
        next.delete(platform)
      } else {
        next.add(platform)
      }
      return next
    })
  }

  function handleStartJob() {
    if (selected.size === 0) {
      // Req 2.4: block starting a job with zero platforms selected.
      setValidationMessage('Select at least one target platform to continue.')
      return
    }
    setValidationMessage(null)
    setSubmitting(true)
    createJob(sourceKeys, [...selected])
      .then(({ jobId }) => {
        navigate(`/processing/${jobId}`)
      })
      .catch(() => {
        setValidationMessage('Could not start the job. Please try again.')
        setSubmitting(false)
      })
  }

  return (
    <section>
      <h1>Select Platforms</h1>
      <p>Choose which platforms your highlights are intended for.</p>

      <fieldset>
        <legend>Target platforms</legend>
        {PLATFORM_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={() => togglePlatform(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      {validationMessage && <p role="alert">{validationMessage}</p>}

      <button type="button" onClick={handleStartJob} disabled={submitting}>
        Start processing
      </button>
    </section>
  )
}

export default PlatformSelectScreen
