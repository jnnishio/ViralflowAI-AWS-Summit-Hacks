export interface CompilationModeToggleProps {
  compilationMode: boolean
  onChange: (next: boolean) => void
}

/** Task 25.1: menu control toggling Compilation Mode (Req 12.1). Selection
 * preservation across the toggle is handled by the reducer (Req 12.5), not
 * this component. */
export function CompilationModeToggle({
  compilationMode,
  onChange,
}: CompilationModeToggleProps) {
  return (
    <label>
      <input
        type="checkbox"
        checked={compilationMode}
        onChange={(event) => onChange(event.target.checked)}
      />
      Compilation mode
    </label>
  )
}

export default CompilationModeToggle
