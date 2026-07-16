import { useState } from 'react'
import type { Clip, ClipFactors, TargetPlatform } from '../types'
import { EDITOR_BASE_URL } from '../api/config'
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
  /** `video_{streamId}` — drives the "Open in Editor" deep link. */
  videoId?: string
  onOpenScoreDetails: () => void
  /** When provided (compilation view), shows a "remove from this reel" control. */
  onRemove?: () => void
}

/**
 * Rich clip card, a 1:1 visual match of out/clips/gallery.html: 9:16 video
 * (thumbnail poster), 🔥 virality score + mood pill, native/English titles,
 * caption, hashtags, an inline score-details <details> with factor bars, and
 * an "Open in Editor" deep link. Layout (grid cell vs. horizontal row item)
 * is decided by the parent view via the wrapping `.clip-grid` / `.clip-row`.
 */
export function ClipCard({
  clip,
  videoId,
  onOpenScoreDetails,
  onRemove,
}: ClipCardProps) {
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
    <article className="clip-card" aria-label={clip.titleNative || clip.clipId}>
      {onRemove && (
        <button
          type="button"
          className="clip-remove"
          onClick={onRemove}
          aria-label="Remove from compilation"
          title="Remove from this reel"
        >
          ×
        </button>
      )}

      {clip.videoUrl ? (
        <video
          controls
          preload="none"
          poster={clip.thumbUrl ?? undefined}
          src={clip.videoUrl}
        />
      ) : (
        <ThumbnailImage src={clip.thumbUrl} alt={clip.titleNative} />
      )}

      <div className="clip-meta">
        <div className="clip-score">
          🔥 {clip.score}
          {clip.mood && <span className="clip-mood">{clip.mood}</span>}
        </div>

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
            title="Copy title + description + hashtags"
          >
            {copied ? 'Copied ✓' : 'Copy'}
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
          <summary>score details</summary>
          {FACTOR_ORDER.map((factor) => {
            const value = clip.factors[factor]
            const width = Math.min(Math.max(value, 0) * 33, 100)
            return (
              <div className="factor" key={factor}>
                <span>{factor}</span>
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
              Open in Editor →
            </a>
          </div>
        )}
      </div>
    </article>
  )
}

export default ClipCard
