import type { SortOrder } from '../types'

export interface SortControlProps {
  sortOrder: SortOrder
  onChange: (order: SortOrder) => void
}

function ArrowUp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  )
}

function ArrowDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  )
}

/**
 * Compact "Sort by Score" control: a single pill holding the label plus a
 * stacked up/down arrow pair. The active direction is highlighted (down =
 * high→low, up = low→high). Req 8.1/8.3.
 */
export function SortControl({ sortOrder, onChange }: SortControlProps) {
  return (
    <div className="sort-control" role="group" aria-label="Sort by score">
      <span className="sort-control__label">Sort by Score</span>
      <div className="sort-control__arrows">
        <button
          type="button"
          className="sort-control__arrow"
          aria-pressed={sortOrder === 'desc'}
          aria-label="Sort by score, high to low"
          title="High to low"
          onClick={() => onChange('desc')}
        >
          <ArrowDown />
        </button>
        <button
          type="button"
          className="sort-control__arrow"
          aria-pressed={sortOrder === 'asc'}
          aria-label="Sort by score, low to high"
          title="Low to high"
          onClick={() => onChange('asc')}
        >
          <ArrowUp />
        </button>
      </div>
    </div>
  )
}

export default SortControl
