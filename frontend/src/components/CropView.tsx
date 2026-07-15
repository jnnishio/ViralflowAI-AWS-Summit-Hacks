import { useState } from 'react'
import type { Clip } from '../types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export interface CropViewProps {
  clip: Clip
  onConfirm: (start: number, end: number) => Promise<void>
  onDismiss: () => void
}

/** Task 23.5: start/end editor clamped to the Clip's original bounds
 * (Req 11.2, 11.3), blocks confirm when start >= end (Req 11.4), preserves
 * adjusted values and shows an error on API failure (Req 11.6), discards
 * adjustments on dismiss (Req 11.8). */
export function CropView({ clip, onConfirm, onDismiss }: CropViewProps) {
  const origStart = clip.start
  const origEnd = clip.end

  const [start, setStart] = useState(origStart)
  const [end, setEnd] = useState(origEnd)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleStartChange(value: number) {
    setStart(clamp(value, origStart, origEnd))
  }

  function handleEndChange(value: number) {
    setEnd(clamp(value, origStart, origEnd))
  }

  const invalid = start >= end

  function handleConfirm() {
    if (invalid) return
    setSaving(true)
    setError(null)
    onConfirm(start, end)
      .then(() => {
        setSaving(false)
      })
      .catch(() => {
        // Req 11.6: preserve adjusted values, show error, stay open.
        setError('Could not save the crop. Please try again.')
        setSaving(false)
      })
  }

  return (
    <div role="dialog" aria-label={`Crop ${clip.titleNative}`}>
      <h2>Crop</h2>
      <label>
        Start (s)
        <input
          type="number"
          step={0.01}
          value={start}
          onChange={(event) => handleStartChange(Number(event.target.value))}
        />
      </label>
      <label>
        End (s)
        <input
          type="number"
          step={0.01}
          value={end}
          onChange={(event) => handleEndChange(Number(event.target.value))}
        />
      </label>

      {invalid && <p role="alert">Start must be before end.</p>}
      {error && <p role="alert">{error}</p>}

      <button type="button" onClick={handleConfirm} disabled={invalid || saving}>
        Confirm crop
      </button>
      <button type="button" onClick={onDismiss}>
        Cancel
      </button>
    </div>
  )
}

export default CropView
