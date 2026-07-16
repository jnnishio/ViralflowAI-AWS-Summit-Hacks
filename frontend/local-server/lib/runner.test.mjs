// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { makeLineSplitter, spawnPipeline } from './runner.mjs'

describe('makeLineSplitter', () => {
  it('emits complete lines across chunk boundaries and flushes the remainder', () => {
    const lines = []
    const s = makeLineSplitter((l) => lines.push(l))
    s.push('hel')
    s.push('lo\nwor')
    s.push('ld\n')
    s.push('tail-no-newline')
    expect(lines).toEqual(['hello', 'world'])
    s.flush()
    expect(lines).toEqual(['hello', 'world', 'tail-no-newline'])
  })

  it('strips trailing \\r (CRLF)', () => {
    const lines = []
    const s = makeLineSplitter((l) => lines.push(l))
    s.push('a\r\nb\r\n')
    expect(lines).toEqual(['a', 'b'])
  })
})

/** Build a fake child process we can drive from a test. */
function makeFakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('spawnPipeline: process tracking + state transitions', () => {
  it('passes python + argv + cwd/env to the spawn impl', () => {
    const child = makeFakeChild()
    const spawnImpl = vi.fn().mockReturnValue(child)
    spawnPipeline({
      args: ['-m', 'pipeline.run'],
      cwd: '/repo',
      env: { AWS_REGION: 'us-east-1' },
      spawnImpl,
    })
    expect(spawnImpl).toHaveBeenCalledWith('python3', ['-m', 'pipeline.run'], {
      cwd: '/repo',
      env: { AWS_REGION: 'us-east-1' },
    })
  })

  it('starts running, forwards stdout lines, and transitions to exited on code 0', () => {
    const child = makeFakeChild()
    const lines = []
    const onExit = vi.fn()
    const handle = spawnPipeline({
      args: [],
      cwd: '/repo',
      onStdoutLine: (l) => lines.push(l),
      onExit,
      spawnImpl: () => child,
    })
    expect(handle.state.status).toBe('running')
    expect(handle.state.pid).toBe(4242)

    child.stdout.emit('data', '[00:00:01] chat: go\n[00:00:02] DONE\n')
    expect(lines).toEqual(['[00:00:01] chat: go', '[00:00:02] DONE'])

    child.emit('exit', 0)
    expect(handle.state.status).toBe('exited')
    expect(handle.state.exitCode).toBe(0)
    expect(onExit).toHaveBeenCalledWith(0, '')
  })

  it('transitions to failed with captured stderr on a non-zero exit', () => {
    const child = makeFakeChild()
    const onExit = vi.fn()
    const handle = spawnPipeline({ args: [], cwd: '/repo', onExit, spawnImpl: () => child })
    child.stderr.emit('data', 'Traceback: boom\n')
    child.emit('exit', 1)
    expect(handle.state.status).toBe('failed')
    expect(handle.state.exitCode).toBe(1)
    expect(onExit).toHaveBeenCalledWith(1, 'Traceback: boom\n')
  })

  it('treats a spawn error as a failure', () => {
    const child = makeFakeChild()
    const onExit = vi.fn()
    const handle = spawnPipeline({ args: [], cwd: '/repo', onExit, spawnImpl: () => child })
    child.emit('error', new Error('ENOENT python3'))
    expect(handle.state.status).toBe('failed')
    expect(onExit).toHaveBeenCalled()
  })
})
