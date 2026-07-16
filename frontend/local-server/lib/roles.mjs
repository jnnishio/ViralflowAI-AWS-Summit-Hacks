/**
 * Resolve which uploaded source is the VIDEO vs the CHAT LOG by file
 * EXTENSION — never by array position.
 *
 * This is the deliberate fix for the ordering bug found in the AWS pipeline
 * (backend/lambdas/pipeline_stages/audio.py and director.py both hard-code
 * `video_key = source_keys[0]`). The upload UI lets a user add the video and
 * the chat-log CSV in either order, so position is not a reliable signal.
 */

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv']
export const CHAT_LOG_EXTENSIONS = ['.csv']

/** Last path segment of a source key like "<jobDraftId>/<filename>". */
export function keyFilename(key) {
  return String(key).split('/').filter(Boolean).pop() ?? ''
}

/** Lower-cased extension (including the dot) of a filename, or '' if none. */
export function extensionOf(filename) {
  const name = keyFilename(filename)
  const idx = name.lastIndexOf('.')
  return idx === -1 ? '' : name.slice(idx).toLowerCase()
}

/** Classify a filename/key as 'video' | 'chatLog' | 'unknown'. */
export function roleOf(filename) {
  const ext = extensionOf(filename)
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (CHAT_LOG_EXTENSIONS.includes(ext)) return 'chatLog'
  return 'unknown'
}

/**
 * Given the sourceKeys from POST /jobs, pick the video key and chat-log key
 * by extension. First match of each role wins; extras are ignored. Missing
 * roles come back as null so the caller can decide how to handle a partial
 * upload.
 *
 * @param {string[]} sourceKeys
 * @returns {{ videoKey: string|null, chatLogKey: string|null,
 *             videoName: string|null, chatLogName: string|null }}
 */
export function resolveRoles(sourceKeys) {
  let videoKey = null
  let chatLogKey = null
  for (const key of sourceKeys ?? []) {
    if (!key) continue
    const role = roleOf(key)
    if (role === 'video' && videoKey === null) videoKey = key
    else if (role === 'chatLog' && chatLogKey === null) chatLogKey = key
  }
  return {
    videoKey,
    chatLogKey,
    videoName: videoKey ? keyFilename(videoKey) : null,
    chatLogName: chatLogKey ? keyFilename(chatLogKey) : null,
  }
}
