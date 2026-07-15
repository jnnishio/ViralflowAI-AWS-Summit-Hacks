import type { SortOrder } from '../types'

export interface SortControlProps {
  sortOrder: SortOrder
  onChange: (order: SortOrder) => void
}

/** Req 8.1: controls to sort by score descending/ascending, indicating
 * which is active. */
export function SortControl({ sortOrder, onChange }: SortControlProps) {
  return (
    <div role="group" aria-label="Sort by score">
      <button
        type="button"
        aria-pressed={sortOrder === 'desc'}
        onClick={() => onChange('desc')}
      >
        Score: High to low
      </button>
      <button
        type="button"
        aria-pressed={sortOrder === 'asc'}
        onClick={() => onChange('asc')}
      >
        Score: Low to high
      </button>
    </div>
  )
}

export default SortControl
