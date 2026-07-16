/**
 * Spawn and track the real pipeline subprocess.
 *
 * The server runs `python3 -m pipeline.run ...` (see pipeline-args.mjs) with
 * the parent process environment inherited so AWS credentials flow through.
 * Rather than a persistent Python service, each job is a one-shot subprocess.
 *
 * `spawnImpl` is injectable so tests can drive a fake child (an EventEmitter
 * with stdout/stderr streams) through the full state machine without really
 * launching Python.
 */
import { spawn as nodeSpawn } from 'node:child_process'

/**
 * Split an arbitrary stream of chunks into complete lines, invoking `onLine`
 * for each. Call `flush()` when the stream ends to emit any trailing partial
 * line. Handles \n and \r\n.
 */
export function makeLineSplitter(onLine) {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        onLine(line)
      }
    },
    flush() {
      if (buffer.length > 0) {
        const line = buffer.replace(/\r$/, '')
        buffer = ''
        onLine(line)
      }
    },
  }
}

/**
 * Spawn the pipeline. Returns a handle with a live `state` object:
 *   state.status: 'running' -> 'exited' (code 0) | 'failed' (code != 0)
 *   state.pid, state.exitCode
 *
 * @param {object} opts
 * @param {string} [opts.python]  interpreter (default 'python3')
 * @param {string[]} opts.args    argv from buildPipelineArgs
 * @param {string} opts.cwd       repo root (so `pipeline` imports + out/ land correctly)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(line:string)=>void} [opts.onStdoutLine]
 * @param {(chunk:string)=>void} [opts.onStderr]
 * @param {(code:number, stderr:string)=>void} [opts.onExit]
 * @param {Function} [opts.spawnImpl]
 */
export function spawnPipeline({
  python = 'python3',
  args,
  cwd,
  env = process.env,
  onStdoutLine,
  onStderr,
  onExit,
  spawnImpl = nodeSpawn,
}) {
  const child = spawnImpl(python, args, { cwd, env })
  const state = { pid: child.pid ?? null, status: 'running', exitCode: null }

  const splitter = makeLineSplitter((line) => {
    if (onStdoutLine) onStdoutLine(line)
  })

  if (child.stdout) {
    child.stdout.setEncoding?.('utf-8')
    child.stdout.on('data', (d) => splitter.push(d.toString()))
  }

  let stderrBuf = ''
  if (child.stderr) {
    child.stderr.setEncoding?.('utf-8')
    child.stderr.on('data', (d) => {
      const s = d.toString()
      stderrBuf += s
      if (onStderr) onStderr(s)
    })
  }

  const finish = (code) => {
    splitter.flush()
    const exitCode = code ?? 0
    state.status = exitCode === 0 ? 'exited' : 'failed'
    state.exitCode = exitCode
    if (onExit) onExit(exitCode, stderrBuf)
  }

  child.on('exit', finish)
  child.on('error', () => finish(1))

  return { child, state, kill: () => child.kill?.() }
}
