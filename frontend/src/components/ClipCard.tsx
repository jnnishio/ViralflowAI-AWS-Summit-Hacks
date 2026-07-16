import { useState } from 'react'
import type { Clip, ClipFactors, TargetPlatform } from '../types'
import { EDITOR_BASE_URL } from '../api/config'
import { useI18n } from '../i18n'
import { ScoreRing } from './ScoreRing'
import { ThumbnailImage } from './ThumbnailImage'
import {
  PLATFORMS,
  PLATFORM_PROFILES,
  adaptMetadata,
  adaptedToText,
} from '../lib/platformProfiles'

/** Fixed factor order, matching ScoreDetailsPanel / gallery.html. */
const FACTOR_ORDER: (keyof ClipFactors)[] = ['chat', 'audio', 'visual', 'speech']

export interface ClipCardProps {
  clip: Clip
  /** Whether this is the focused (centered) card in the carousel. Only the
   * focused card reveals its full meta; previews show media only. */
  active?: boolean
  /** `video_{streamId}` — drives the "Open in Editor" deep link. */
  videoId?: string
  onOpenScoreDetails: () => void
  /** When provided (compilation view), shows a "remove from this reel" control. */
  onRemove?: () => void
}

/**
 * Rich clip card for the stories-style gallery: a 9:16 media panel (with a
 * floating virality ring) plus, when focused, an integrated meta panel with
 * native/English titles, caption, hashtags, an inline score breakdown, and an
 * "Open in Editor" deep link. Preview (non-active) cards render media only.
 */
export function ClipCard({
  clip,
  active = false,
  videoId,
  onOpenScoreDetails,
  onRemove,
}: ClipCardProps) {
  const { t } = useI18n()
  // Deep link into the vendored OpenCut editor app (a separate server from the
  // REST/pipeline API), opening this clip's scene. The editor loads clips by
  // stream, so the clip id is stream-scoped ("{stream}__clip_NN") — the stream
  // is derived from videoId ("video_{stream}"). The pipeline server's
  // editor-shaped API resolves both back to the run's real clips + auto-edit.
  const editorHref = videoId
    ? `${EDITOR_BASE_URL}/editor/video/${videoId}/edit/${videoId.replace(
        /^video_/,
        '',
      )}__${clip.clipId}`
    : undefined

  // Per-platform metadata: pick a platform, see the title/description/hashtags
  // rewritten to match that platform's algorithm, and copy it for posting.
  const [platform, setPlatform] = useState<TargetPlatform>('tiktok')
  const [copied, setCopied] = useState(false)
  const adapted = adaptMetadata(clip, platform)

  const copyForPlatform = () => {
    void navigator.clipboard?.writeText(adaptedToText(adapted))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <article
      className={`clip-card${active ? ' is-active' : ''}`}
      aria-label={clip.titleNative || clip.clipId}
    >
      <div className="clip-media">
        {active && clip.videoUrl ? (
          <video
            controls
            preload="none"
            poster={clip.thumbUrl ?? undefined}
            src={clip.videoUrl}
          />
        ) : (
          <ThumbnailImage src={clip.thumbUrl} alt={clip.titleNative} />
        )}

        <div className="clip-media__ring">
          <ScoreRing score={clip.score} size={active ? 60 : 46} />
        </div>

        {clip.mood && <span className="clip-mood">{clip.mood}</span>}

        {active && onRemove && (
          <button
            type="button"
            className="clip-remove"
            onClick={onRemove}
            aria-label={t('clip.removeAria')}
            title={t('clip.removeTitle')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>

      {active && (
        <div className="clip-meta">
          <div className="clip-platforms" role="tablist">
            {PLATFORMS.map((pf) => (
              <button
                key={pf}
                type="button"
                role="tab"
                aria-selected={pf === platform}
                className={pf === platform ? 'clip-platform is-active' : 'clip-platform'}
                onClick={() => setPlatform(pf)}
              >
                {PLATFORM_PROFILES[pf].label}
              </button>
            ))}
            <button
              type="button"
              className="clip-copy"
              onClick={copyForPlatform}
              title={t('clip.copyTitle')}
            >
              {copied ? t('clip.copied') : t('clip.copy')}
            </button>
          </div>

          {adapted.title && <h2>{adapted.title}</h2>}
          {adapted.description && <p className="clip-cap">{adapted.description}</p>}
          {adapted.hashtags.length > 0 && (
            <p className="clip-tags">{adapted.hashtags.join(' ')}</p>
          )}

          <details
            className="clip-details"
            onToggle={(e) => {
              // Keep the app's "replace score panel in place" behavior wired:
              // opening the inline details also surfaces the active clip.
              if ((e.target as HTMLDetailsElement).open) onOpenScoreDetails()
            }}
          >
            <summary>{t('clip.scoreDetails')}</summary>
            {FACTOR_ORDER.map((factor) => {
              const value = clip.factors[factor]
              const width = Math.min(Math.max(value, 0) * 33, 100)
              return (
                <div className="factor" key={factor}>
                  <span>{t(`factor.${factor}`)}</span>
                  <div className="bar">
                    <div style={{ width: `${width.toFixed(0)}%` }} />
                  </div>
                  <em>{value.toFixed(2)}</em>
                </div>
              )
            })}
            <p className="clip-range">
              {clip.start.toFixed(0)}s – {clip.end.toFixed(0)}s
              {clip.momentType ? ` · ${clip.momentType}` : ''}
            </p>
          </details>

          {editorHref && (
            <div className="clip-actions">
              <a
                className="btn"
                href={editorHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('clip.openEditor')}
              </a>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export default ClipCard
