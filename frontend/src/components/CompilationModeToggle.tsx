export interface CompilationModeToggleProps {
  compilationMode: boolean
  onChange: (next: boolean) => void
}

/** Toggles Compilation mode: groups the highlights into AI-suggested themed
 * reels (pipeline/compilations.py) instead of one flat list. */
export function CompilationModeToggle({
  compilationMode,
  onChange,
}: CompilationModeToggleProps) {
  return (
    <label className="comp-toggle">
      <input
        type="checkbox"
        checked={compilationMode}
        onChange={(event) => onChange(event.target.checked)}
      />
      Compilation reels
    </label>
  )
}

export default CompilationModeToggle
