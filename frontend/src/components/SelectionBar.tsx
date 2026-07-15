import { useState } from 'react'
import type { ChipType } from '../types'

const CHIP_LABELS: { type: ChipType; label: string }[] = [
  { type: 'reorder', label: 'Reorder' },
  { type: 'faster_pacing', label: 'Faster pacing' },
  { type: 'swap_intro', label: 'Swap intro' },
  { type: 'more_reactions', label: 'More reactions' },
]

const MAX_FREEFORM_LENGTH = 1000

export interface SelectionBarProps {
  selectedCount: number
  onClearSelection: () => void
  showQuickActions: boolean
  onChipSelect: (chip: ChipType) => void
  onFreeformSubmit: (text: string) => void
  errorMessage?: string | null
  confirmationMessage?: string | null
}

/** Task 23.3 / 25.2 / 25.4: always-visible selected count with a
 * clear-selection control disabled iff count is zero (Req 10.3, 10.5,
 * 10.6); quick-action chips shown iff selection is non-empty (Req 13.1,
 * 13.2); freeform prompt input with validation (Req 14.3, 14.4). */
export function SelectionBar({
  selectedCount,
  onClearSelection,
  showQuickActions,
  onChipSelect,
  onFreeformSubmit,
  errorMessage,
  confirmationMessage,
}: SelectionBarProps) {
  const [freeformText, setFreeformText] = useState('')
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  )

  function handleSubmit() {
    const trimmed = freeformText.trim()
    if (trimmed.length === 0) {
      setValidationMessage('Enter a prompt before submitting.')
      return
    }
    if (freeformText.length > MAX_FREEFORM_LENGTH) {
      setValidationMessage(
        `Prompt must be at most ${MAX_FREEFORM_LENGTH} characters.`,
      )
      return
    }
    setValidationMessage(null)
    onFreeformSubmit(freeformText)
  }

  return (
    <div role="toolbar" aria-label="Selection actions">
      <span>Selected: {selectedCount}</span>
      <button
        type="button"
        onClick={onClearSelection}
        disabled={selectedCount === 0}
      >
        Clear selection
      </button>

      {showQuickActions && (
        <div>
          {CHIP_LABELS.map((chip) => (
            <button
              key={chip.type}
              type="button"
              onClick={() => onChipSelect(chip.type)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {showQuickActions && (
        <div>
          <label htmlFor="freeform-prompt">Describe a custom change</label>
          <textarea
            id="freeform-prompt"
            value={freeformText}
            onChange={(event) => setFreeformText(event.target.value)}
          />
          <button type="button" onClick={handleSubmit}>
            Submit
          </button>
          {validationMessage && <p role="alert">{validationMessage}</p>}
        </div>
      )}

      {errorMessage && <p role="alert">{errorMessage}</p>}
      {confirmationMessage && <p role="status">{confirmationMessage}</p>}
    </div>
  )
}

export default SelectionBar
