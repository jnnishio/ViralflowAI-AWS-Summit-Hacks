// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseLogLine, stripTimestamp, toProgressEvent } from './progress.mjs'

describe('stripTimestamp', () => {
  it('removes a leading [HH:MM:SS] prefix', () => {
    expect(stripTimestamp('[12:34:56] chat: analyzing')).toBe('chat: analyzing')
    expect(stripTimestamp('no timestamp here')).toBe('no timestamp here')
  })
})

describe('parseLogLine: stage classification', () => {
  const cases = [
    ['[00:00:01] chat: analyzing event log', 'Analyzing chat activity'],
    ['[00:00:02] audio: extracting track from VOD', 'Analyzing audio'],
    ['[00:00:03] transcribe: starting vod-1', 'Transcribing speech (Transcribe)'],
    ['[00:00:04] transcript: out/1/transcript.json', 'Transcribing speech (Transcribe)'],
    ['[00:00:05] rekognition(fast): face jobs on 5 segments', 'Analyzing video (Rekognition)'],
    ['[00:00:06] align: chat->video offset 12s', 'Aligning chat with video'],
    ['[00:00:07] fusion: building excitement curve', 'Scoring highlight candidates'],
    ['[00:00:08] director: judging candidates with Bedrock', 'AI Director selecting highlights (Bedrock)'],
    ['[00:00:09] render: cutting vertical clips', 'Rendering vertical clips'],
    ['[00:00:10] contracts: emitting canonical clips.json', 'Finalizing highlights'],
    ['[00:00:11] edl: emitting per-clip EDLs', 'Finalizing highlights'],
  ]
  for (const [line, stage] of cases) {
    it(`maps "${line}" -> "${stage}"`, () => {
      expect(parseLogLine(line)).toEqual({ type: 'stage', stage, raw: expect.any(String) })
    })
  }

  it('recognizes the DONE terminal line', () => {
    expect(parseLogLine('[00:10:00] DONE')).toEqual({ type: 'done' })
  })

  it('returns null for unrecognized / empty lines', () => {
    expect(parseLogLine('[00:00:00] some unrelated debug output')).toBeNull()
    expect(parseLogLine('')).toBeNull()
    expect(parseLogLine('   ')).toBeNull()
  })

  it('does NOT treat a soft FAILED log line as a stage or terminal state', () => {
    // "transcribe FAILED ... continuing without speech" -> still the transcribe stage,
    // never a failure (only a non-zero exit is a real failure).
    const parsed = parseLogLine('[00:00:03] transcribe FAILED: reason (continuing without speech)')
    expect(parsed).toEqual({ type: 'stage', stage: 'Transcribing speech (Transcribe)', raw: expect.any(String) })
  })
})

describe('toProgressEvent', () => {
  it('produces a started ProgressEvent for a stage line', () => {
    const parsed = parseLogLine('[00:00:01] fusion: scoring')
    expect(toProgressEvent('job-9', parsed)).toEqual({
      jobId: 'job-9',
      stage: 'Scoring highlight candidates',
      status: 'started',
    })
  })

  it('returns null for done/null parses (server handles completion separately)', () => {
    expect(toProgressEvent('job-9', { type: 'done' })).toBeNull()
    expect(toProgressEvent('job-9', null)).toBeNull()
  })
})
