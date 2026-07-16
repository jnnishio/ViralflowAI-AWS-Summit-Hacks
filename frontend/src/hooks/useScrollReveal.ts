import { useEffect, useRef, useState } from 'react'

/**
 * Reveals an element once it scrolls into view (for entrance/scroll effects).
 * Returns a ref to attach and a `revealed` flag to toggle a CSS class.
 *
 * Degrades gracefully: if IntersectionObserver is unavailable (e.g. jsdom in
 * tests) or the user prefers reduced motion, it reveals immediately so nothing
 * stays hidden.
 */
export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (typeof IntersectionObserver === 'undefined' || prefersReduced) {
      setRevealed(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true)
            obs.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, revealed }
}

export default useScrollReveal
