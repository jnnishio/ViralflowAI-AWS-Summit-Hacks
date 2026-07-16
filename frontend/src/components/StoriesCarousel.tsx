import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useI18n } from '../i18n'
import type { Clip } from '../types'

export interface StoriesCarouselProps {
  clips: Clip[]
  /** Render one card. `active` is true for the centered/focused clip. */
  renderCard: (clip: Clip, active: boolean) => ReactNode
  /** Optional label for the carousel region (a11y). */
  ariaLabel?: string
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

/** How many neighbours to keep mounted/visible on each side of the focus. */
const VISIBLE_NEIGHBOURS = 2

/**
 * Instagram-web-stories style carousel: the focused clip sits large and
 * centered while its neighbours peek out smaller and dimmed on either side.
 * Prev/next chevrons and the arrow keys move the focus; clicking a neighbour
 * brings it to center. Only the focused card shows its full meta (the caller
 * decides that via the `active` flag).
 */
export function StoriesCarousel({
  clips,
  renderCard,
  ariaLabel,
}: StoriesCarouselProps) {
  const { t } = useI18n()
  const label = ariaLabel ?? t('carousel.default')
  const [active, setActive] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)

  // Keep the focus in range when the clip set changes (sort flip, curation…).
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(clips.length - 1, 0)))
  }, [clips.length])

  const go = useCallback(
    (dir: -1 | 1) => {
      setActive((current) => {
        const next = current + dir
        if (next < 0 || next > clips.length - 1) return current
        return next
      })
    },
    [clips.length],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        go(1)
      }
    },
    [go],
  )

  if (clips.length === 0) return null

  const atStart = active === 0
  const atEnd = active === clips.length - 1

  return (
    <div className="stories" aria-roledescription="carousel" aria-label={label}>
      <button
        type="button"
        className="stories__nav stories__nav--prev"
        onClick={() => go(-1)}
        disabled={atStart}
        aria-label={t('carousel.prev')}
      >
        <ChevronLeft />
      </button>

      <div
        className="stories__stage"
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-label={t('carousel.countAria', {
          current: active + 1,
          total: clips.length,
        })}
        onKeyDown={onKeyDown}
      >
        {clips.map((clip, index) => {
          const offset = index - active
          const isActive = offset === 0
          const hidden = Math.abs(offset) > VISIBLE_NEIGHBOURS
          return (
            <div
              key={clip.clipId}
              className={`stories__item${isActive ? ' is-active' : ''}`}
              data-offset={offset}
              aria-hidden={!isActive}
              style={{
                transform: `translateX(calc(${offset} * var(--stories-step))) scale(${
                  isActive ? 1 : 0.74
                })`,
                opacity: hidden ? 0 : isActive ? 1 : 0.5,
                zIndex: 100 - Math.abs(offset),
                pointerEvents: hidden ? 'none' : 'auto',
                visibility: hidden ? 'hidden' : 'visible',
              }}
            >
              {!isActive && (
                <button
                  type="button"
                  className="stories__focus-btn"
                  onClick={() => setActive(index)}
                  aria-label={t('carousel.viewAria', { index: index + 1 })}
                  tabIndex={-1}
                />
              )}
              {renderCard(clip, isActive)}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className="stories__nav stories__nav--next"
        onClick={() => go(1)}
        disabled={atEnd}
        aria-label={t('carousel.next')}
      >
        <ChevronRight />
      </button>

      <div
        className="stories__dots"
        role="tablist"
        aria-label={t('carousel.positionAria')}
      >
        {clips.map((clip, index) => (
          <button
            key={clip.clipId}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={t('carousel.goToAria', { index: index + 1 })}
            className={`stories__dot${index === active ? ' is-active' : ''}`}
            onClick={() => setActive(index)}
          />
        ))}
      </div>
    </div>
  )
}

export default StoriesCarousel
