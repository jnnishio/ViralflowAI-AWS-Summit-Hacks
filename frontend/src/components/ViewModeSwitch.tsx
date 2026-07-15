import type { ViewMode } from '../types'

export interface ViewModeSwitchProps {
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
}

/** Task 18 support (Req 18.1): switches between exactly "gallery" and
 * "grid". State preservation across the switch is handled by the parent's
 * reducer, not this component (Property 22, 32). */
export function ViewModeSwitch({ viewMode, onChange }: ViewModeSwitchProps) {
  return (
    <div role="group" aria-label="View mode">
      <button
        type="button"
        aria-pressed={viewMode === 'gallery'}
        onClick={() => onChange('gallery')}
      >
        Gallery
      </button>
      <button
        type="button"
        aria-pressed={viewMode === 'grid'}
        onClick={() => onChange('grid')}
      >
        Grid
      </button>
    </div>
  )
}

export default ViewModeSwitch
