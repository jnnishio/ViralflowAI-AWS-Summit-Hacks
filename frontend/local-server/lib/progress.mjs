/**
 * Parse real pipeline stdout into UI progress signals.
 *
 * The pipeline prints structured lines like:
 *   [12:34:56] chat: analyzing event log
 *   [12:35:10] director: judging candidates with Bedrock
 *   [12:40:02] DONE
 *
 * We strip the timestamp and classify the message by its stage prefix into a
 * human-readable label the ProcessingScreen shows verbatim. `DONE` signals
 * completion. Unrecognized lines return null (ignored for progress, but the
 * server still logs them).
 *
 * NOTE: log lines containing "FAILED" (e.g. "transcribe FAILED ... continuing
 * without speech") are SOFT — the pipeline recovers and keeps going. Only a
 * non-zero process exit is a real failure, decided by the runner, not here.
 */

const TIMESTAMP_RE = /^\s*\[\d{2}:\d{2}:\d{2}\]\s*/

/** Ordered [matcher, label] rules; first match wins (most specific first). */
const STAGE_RULES = [
  [/rekognition/i, 'Analyzing video (Rekognition)'],
  [/^chat\b/i, 'Analyzing chat activity'],
  [/^audio\b/i, 'Analyzing audio'],
  [/^transcrib/i, 'Transcribing speech (Transcribe)'],
  [/^transcript\b/i, 'Transcribing speech (Transcribe)'],
  [/^visual\b/i, 'Analyzing video'],
  [/^align\b/i, 'Aligning chat with video'],
  [/^fusion\b/i, 'Scoring highlight candidates'],
  [/^director\b/i, 'AI Director selecting highlights (Bedrock)'],
  [/^render\b/i, 'Rendering vertical clips'],
  [/^contracts\b/i, 'Finalizing highlights'],
  [/^edl\b/i, 'Finalizing highlights'],
  [/^publish\b/i, 'Publishing'],
]

/** Remove the leading `[HH:MM:SS] ` timestamp, if present. */
export function stripTimestamp(line) {
  return String(line).replace(TIMESTAMP_RE, '').trim()
}

/**
 * Classify a single stdout line.
 * @returns {{type:'done'}|{type:'stage',stage:string,raw:string}|null}
 */
export function parseLogLine(line) {
  const msg = stripTimestamp(line)
  if (!msg) return null
  if (/^done\b/i.test(msg)) return { type: 'done' }
  for (const [re, stage] of STAGE_RULES) {
    if (re.test(msg)) return { type: 'stage', stage, raw: msg }
  }
  return null
}

/**
 * Convert a parsed line into a ProgressEvent for a job, or null if the line
 * carries no progress signal. `done` is intentionally NOT mapped here — the
 * server emits the terminal {stage:'pipeline',status:'completed'} event only
 * after it has loaded the manifest, so callers handle `done` explicitly.
 */
export function toProgressEvent(jobId, parsed) {
  if (!parsed || parsed.type !== 'stage') return null
  return { jobId, stage: parsed.stage, status: 'started' }
}
