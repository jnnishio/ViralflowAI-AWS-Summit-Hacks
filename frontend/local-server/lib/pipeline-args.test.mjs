// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildPipelineArgs,
  DEFAULT_S3_BUCKET,
  DEFAULT_VERTICAL,
} from './pipeline-args.mjs'

describe('buildPipelineArgs', () => {
  it('constructs argv with all required flags and defaults', () => {
    const args = buildPipelineArgs({
      videoPath: 'uploads/draft/stream.mp4',
      chatLogPath: 'uploads/draft/chat.csv',
      streamId: 'job-1',
    })
    expect(args).toEqual([
      '-m',
      'pipeline.run',
      '--video',
      'uploads/draft/stream.mp4',
      '--chat-log',
      'uploads/draft/chat.csv',
      '--s3-bucket',
      DEFAULT_S3_BUCKET,
      '--stream-id',
      'job-1',
      '--outdir',
      'out/job-1',
      '--vertical',
      DEFAULT_VERTICAL,
    ])
  })

  it('honors explicit outdir, bucket and vertical overrides', () => {
    const args = buildPipelineArgs({
      videoPath: 'v.mp4',
      chatLogPath: 'c.csv',
      streamId: 's',
      outdir: 'out/custom',
      s3Bucket: 'my-bucket',
      vertical: 'gaming',
    })
    expect(args).toContain('my-bucket')
    expect(args[args.indexOf('--outdir') + 1]).toBe('out/custom')
    expect(args[args.indexOf('--vertical') + 1]).toBe('gaming')
  })

  it('throws when a required field is missing', () => {
    expect(() => buildPipelineArgs({ chatLogPath: 'c', streamId: 's' })).toThrow()
    expect(() => buildPipelineArgs({ videoPath: 'v', streamId: 's' })).toThrow()
    expect(() => buildPipelineArgs({ videoPath: 'v', chatLogPath: 'c' })).toThrow()
  })
})
