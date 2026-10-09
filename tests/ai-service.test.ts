import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { tmpdir } from 'os'

const workers: EventEmitter[] = []
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  session: {},
  utilityProcess: {
    fork: () => {
      const worker = Object.assign(new EventEmitter(), { stdout: null, stderr: null, pid: 1, kill: vi.fn(), postMessage: vi.fn() })
      workers.push(worker)
      return worker
    }
  }
}))

import { AiService } from '../src/main/ai/service'

describe('AiService worker lifecycle', () => {
  it('keeps the new worker when the old one exits late', () => {
    const service = new AiService(() => 'base' as never, () => 'qwen' as never, () => 'vi', () => 'auto', () => undefined, () => undefined)
    service['spawn']()
    service.stop()
    service['spawn']()
    expect(service.running()).toBe(true)
    workers[0].emit('exit') // the first worker finishes dying after the second was started
    expect(service.running()).toBe(true)
    workers[1].emit('exit')
    expect(service.running()).toBe(false)
  })

  it('an old worker exiting late fails only its own requests', async () => {
    const service = new AiService(() => 'base' as never, () => 'qwen' as never, () => 'vi', () => 'auto', () => undefined, () => undefined)
    const first = service['request']({ type: 'a' })
    first.catch(() => undefined)
    const old = workers.length - 1
    service.stop()
    const second = service['request']({ type: 'b', device: 'dml' })
    const id = [...service['pending'].keys()].at(-1)
    workers[old].emit('exit')
    await expect(first).rejects.toThrow('stopped')
    expect(service['gpuBroken']).not.toBe(true) // the new worker's GPU request is not blamed
    workers[old + 1].emit('message', { type: 'result', id, value: 'ok' })
    await expect(second).resolves.toBe('ok')
  })
})
