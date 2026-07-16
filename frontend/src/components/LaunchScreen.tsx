import { useEffect, useState } from 'react'
import './LaunchScreen.css'

/** Must match the --launch-fade-in duration in LaunchScreen.css. */
const FADE_IN_MS = 500
/** How long the branding stays fully visible before it begins fading out. */
const HOLD_MS = 1000
/** Must match the --launch-fade-out duration in LaunchScreen.css. */
const FADE_OUT_MS = 600

interface LaunchScreenProps {
  /** Called once the screen has fully faded out and can be unmounted. */
  onFinish: () => void
}

/**
 * Full-screen splash shown on app launch. A solid black layer covers the app
 * instantly, the Viralflow AI branding fades in from black, holds for ~3s,
 * then the whole screen fades out to reveal the app underneath.
 */
export function LaunchScreen({ onFinish }: LaunchScreenProps) {
  const [entered, setEntered] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Fade in on the next frame so the initial (opacity: 0) state paints first.
    const enterRaf = requestAnimationFrame(() => setEntered(true))
    // Begin fading out once the branding has faded in and held fully visible.
    const leaveTimer = window.setTimeout(
      () => setLeaving(true),
      FADE_IN_MS + HOLD_MS,
    )
    // Unmount once the fade-out has finished. Driven by a timer (rather than
    // transitionend) so it stays robust under prefers-reduced-motion.
    const doneTimer = window.setTimeout(
      onFinish,
      FADE_IN_MS + HOLD_MS + FADE_OUT_MS,
    )

    return () => {
      cancelAnimationFrame(enterRaf)
      window.clearTimeout(leaveTimer)
      window.clearTimeout(doneTimer)
    }
  }, [onFinish])

  const className = [
    'launch-screen',
    entered ? 'is-entered' : '',
    leaving ? 'is-leaving' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} role="presentation" aria-hidden="true">
      <div className="launch-screen__scene">
        <div className="launch-screen__content">
          <div className="launch-screen__brand">
            <h1 className="launch-screen__wordmark">Viralflow AI</h1>

            <span className="launch-screen__logo" aria-hidden="true">
              <svg
                className="launch-screen__logo-glyph"
                viewBox="0 0 48 46"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fill="#ffffff"
                  d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
                />
              </svg>
            </span>
          </div>

          <p className="launch-screen__tagline launch-screen__tagline--zh">
            你活在當下，我們編輯精華，<strong>你上傳成果</strong>。
          </p>
          <p className="launch-screen__tagline launch-screen__tagline--en">
            You create the moment. We find it. <strong>You shape it</strong>.
          </p>
        </div>
      </div>
    </div>
  )
}

export default LaunchScreen
