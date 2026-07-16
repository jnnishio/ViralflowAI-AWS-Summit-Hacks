import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createJob } from '../api/jobApi'
import type { TargetPlatform } from '../types'
import './PlatformSelectScreen.css'

/** Brand glyphs, rendered white on their brand-colored tile. */
function TikTokLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  )
}

function InstagramLogo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function YouTubeShortsLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v12A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V6A1.5 1.5 0 0 1 4 4.5z" />
      <path d="M10 8.5v7l6-3.5-6-3.5z" fill="#ff0000" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

const PLATFORM_OPTIONS: {
  value: TargetPlatform
  label: string
  logo: ReactNode
  logoClass: string
}[] = [
  {
    value: 'tiktok',
    label: 'TikTok',
    logo: <TikTokLogo />,
    logoClass: 'platform-logo--tiktok',
  },
  {
    value: 'reels',
    label: 'Instagram Reels',
    logo: <InstagramLogo />,
    logoClass: 'platform-logo--instagram',
  },
  {
    value: 'shorts',
    label: 'YouTube Shorts',
    logo: <YouTubeShortsLogo />,
    logoClass: 'platform-logo--youtube',
  },
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
    <section className="platform-screen">
      <h1 className="platform-screen__title">Select Platforms</h1>
      <p className="platform-screen__subtitle">
        Choose which platforms your highlights are intended for.
      </p>

      <fieldset className="platform-grid">
        <legend>Target platforms</legend>
        {PLATFORM_OPTIONS.map((option) => (
          <label key={option.value} className="platform-card">
            <input
              className="platform-card__input"
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={() => togglePlatform(option.value)}
            />
            <span className="platform-card__check" aria-hidden="true">
              <CheckIcon />
            </span>
            <span className="platform-card__body">
              <span className={`platform-logo ${option.logoClass}`}>
                {option.logo}
              </span>
              <span className="platform-card__label">{option.label}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {validationMessage && (
        <p className="platform-alert" role="alert">
          {validationMessage}
        </p>
      )}

      <button
        type="button"
        className="platform-submit"
        onClick={handleStartJob}
        disabled={submitting}
      >
        Start processing
      </button>
    </section>
  )
}

export default PlatformSelectScreen
