import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getHandoff } from '../api/highlightsApi'
import { ThumbnailImage } from '../components/ThumbnailImage'
import type { HandoffClip } from '../types'

/** Task 25.8: lists each confirmed Clip's thumbnail + titleNative
 * (Req 15.4), and states that AI auto-editing and the built-in editor are
 * not yet implemented (Req 15.6). */
export function HandoffStubScreen() {
  const { handoffId } = useParams<{ handoffId: string }>()
  const [clips, setClips] = useState<HandoffClip[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!handoffId) return
    getHandoff(handoffId)
      .then((res) => setClips(res.clips))
      .catch(() => setError('Could not load the confirmed selection.'))
  }, [handoffId])

  return (
    <section>
      <h1>Selection Confirmed</h1>
      <p>AI auto-editing and the built-in editor are not yet implemented.</p>

      {error && <p role="alert">{error}</p>}

      <ul>
        {clips.map((clip) => (
          <li key={clip.clipId}>
            <ThumbnailImage src={clip.thumbUrl} alt={clip.titleNative} />
            <span>{clip.titleNative}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default HandoffStubScreen
