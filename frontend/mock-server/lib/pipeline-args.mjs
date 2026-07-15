/**
 * Build the argv for the real pipeline CLI:
 *
 *   python3 -m pipeline.run --video <v> --chat-log <c> \
 *       --s3-bucket <bucket> --stream-id <sid> --outdir out/<sid> --vertical talk
 *
 * S3 is an unavoidable input/output store for the async Transcribe /
 * Rekognition jobs, so --s3-bucket is always passed.
 */

export const DEFAULT_S3_BUCKET = 'hackathon-152315741309-us-east-1-an'
export const DEFAULT_VERTICAL = 'talk'

/**
 * @param {object} opts
 * @param {string} opts.videoPath   resolved path to the uploaded video
 * @param {string} opts.chatLogPath resolved path to the uploaded chat CSV
 * @param {string} opts.streamId    used for --stream-id and out/<streamId>
 * @param {string} [opts.outdir]    defaults to `out/<streamId>`
 * @param {string} [opts.s3Bucket]
 * @param {string} [opts.vertical]
 * @returns {string[]} argv passed to python3 (excluding the interpreter)
 */
export function buildPipelineArgs({
  videoPath,
  chatLogPath,
  streamId,
  outdir,
  s3Bucket = DEFAULT_S3_BUCKET,
  vertical = DEFAULT_VERTICAL,
}) {
  if (!videoPath) throw new Error('buildPipelineArgs: videoPath is required')
  if (!chatLogPath) throw new Error('buildPipelineArgs: chatLogPath is required')
  if (!streamId) throw new Error('buildPipelineArgs: streamId is required')
  const resolvedOutdir = outdir ?? `out/${streamId}`
  return [
    '-m',
    'pipeline.run',
    '--video',
    videoPath,
    '--chat-log',
    chatLogPath,
    '--s3-bucket',
    s3Bucket,
    '--stream-id',
    streamId,
    '--outdir',
    resolvedOutdir,
    '--vertical',
    vertical,
  ]
}
