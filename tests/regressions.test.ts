import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'
import { ProcessState } from '../src/simulation/process/Process'
import { MemoryMode } from '../src/simulation/memory/Memory'

const engines: SimulationEngine[] = []
function setup() {
  const engine = new SimulationEngine(10)
  engines.push(engine)
  return engine
}
function add(engine: SimulationEngine, burstTime = 6, arrivalTime = 0) {
  return engine.processManager.createProcess({ name: 'worker', burstTime, arrivalTime, priority: 1, memoryRequirement: 100 })
}
afterEach(() => {
  engines.forEach((engine) => engine.dispose())
  engines.length = 0
  vi.useRealTimers()
})

describe('simulation regressions', () => {
  it('waits for arrival before executing and records nonnegative metrics', () => {
    const engine = setup()
    const process = add(engine, 2, 3)
    engine.fastForward(3)
    expect(engine.processManager.getProcess(process.pid)?.remainingTime).toBe(2)
    engine.fastForward(2)
    expect(engine.getSnapshot().cpu.executionSegments).toEqual([
      { pid: 'IDLE', startTick: 0, endTick: 3 },
      { pid: process.pid, startTick: 3, endTick: 5 },
    ])
    expect(engine.getSnapshot().cpu.metrics[0]).toMatchObject({ firstStartTime: 3, completionTime: 5, responseTime: 0, waitingTime: 0 })
  })

  it('gives a fresh Round Robin quantum after the previous process completes', () => {
    const engine = setup()
    engine.setScheduler('ROUND_ROBIN', 3)
    add(engine, 2); add(engine); add(engine)
    engine.fastForward(8)
    expect(engine.getSnapshot().cpu.executionSegments).toEqual([
      { pid: 'P1', startTick: 0, endTick: 2 },
      { pid: 'P2', startTick: 2, endTick: 5 },
      { pid: 'P3', startTick: 5, endTick: 8 },
    ])
  })

  it('returns the running process to READY when changing schedulers', () => {
    const engine = setup()
    const process = add(engine, 4)
    engine.step()
    engine.setScheduler('ROUND_ROBIN', 2)
    expect(engine.processManager.getProcess(process.pid)).toMatchObject({ state: ProcessState.READY, remainingTime: 3 })
    engine.fastForward(3)
    expect(engine.processManager.getProcess(process.pid)).toMatchObject({ state: ProcessState.TERMINATED, completionTime: 4 })
  })

  it.each([ProcessState.BLOCKED, ProcessState.TERMINATED, ProcessState.READY])('handles manual %s actions while the timer runs', (state) => {
    vi.useFakeTimers()
    const engine = setup()
    const first = add(engine)
    add(engine)
    engine.start()
    vi.advanceTimersByTime(10)
    engine.processManager.transitionProcess(first.pid, state)
    expect(engine.getSnapshot().cpu.busy).toBe(false)
    expect(() => vi.advanceTimersByTime(30)).not.toThrow()
    expect(engine.getSnapshot().cpu.busyTicks).toBe(4)
    if (state !== ProcessState.READY) expect(engine.processManager.getProcess(first.pid)?.remainingTime).toBe(5)
    engine.pause()
  })

  it('rejects a second RUNNING process and keeps the CPU consistent', () => {
    const engine = setup()
    const first = add(engine)
    const second = add(engine)
    engine.step()
    expect(() => engine.processManager.transitionProcess(second.pid, ProcessState.RUNNING)).toThrow()
    expect(engine.processManager.getProcessesByState(ProcessState.RUNNING).map((p) => p.pid)).toEqual([first.pid])
    expect(() => engine.step()).not.toThrow()
  })

  it('executes a process manually set to RUNNING before the first tick', () => {
    const engine = setup()
    const first = add(engine)
    const second = add(engine)
    engine.processManager.admitArrivals(0)
    engine.processManager.transitionProcess(second.pid, ProcessState.RUNNING)
    expect(engine.getSnapshot().cpu.runningProcess?.pid).toBe(second.pid)
    engine.step()
    expect(engine.processManager.getProcess(first.pid)?.remainingTime).toBe(6)
    expect(engine.processManager.getProcess(second.pid)?.remainingTime).toBe(5)
    expect(engine.processManager.getProcessesByState(ProcessState.RUNNING)).toHaveLength(1)
  })

  it.each(['translation', 'translation failure', 'page fault', 'transition rejection', 'allocation failure', 'page allocation failure'])('publishes %s events without another tick', (action) => {
    const engine = setup()
    const process = add(engine)
    if (action.includes('translation') || action === 'page fault' || action === 'page allocation failure') {
      engine.memoryManager.setMode(MemoryMode.PAGED)
      engine.memoryManager.pagingManager.allocateProcessPages(process.pid)
    }
    if (action === 'page fault') engine.memoryManager.pagingManager.unmapPage(process.pid, 0)
    const before = engine.getSnapshot()
    let published = before
    const unsubscribe = engine.subscribe(() => { published = engine.getSnapshot() })
    if (action === 'translation') engine.memoryManager.pagingManager.translate(process.pid, 0)
    if (action === 'translation failure') engine.memoryManager.pagingManager.translate(process.pid, 100)
    if (action === 'page fault') engine.memoryManager.pagingManager.translate(process.pid, 0)
    if (action === 'transition rejection') expect(() => engine.processManager.transitionProcess(process.pid, ProcessState.RUNNING)).toThrow()
    if (action === 'allocation failure') expect(() => engine.memoryManager.allocate(process.pid, 2048)).toThrow()
    if (action === 'page allocation failure') expect(() => engine.memoryManager.pagingManager.allocateProcessPages(process.pid)).toThrow()
    expect(engine.getSnapshot()).not.toBe(before)
    expect(published.events).toEqual(engine.events.getAll())
    expect(published.events.length).toBeGreaterThan(before.events.length)
    unsubscribe()
  })

  it.each([MemoryMode.CONTIGUOUS, MemoryMode.PAGED])('requires positive integer process memory in %s mode', (mode) => {
    const engine = setup()
    engine.memoryManager.setMode(mode)
    for (const memoryRequirement of [0, -1, 10.5, NaN, Infinity]) {
      expect(() => engine.processManager.createProcess({ name: 'invalid', burstTime: 1, priority: 1, memoryRequirement })).toThrow('Memory requirement must be a positive integer')
    }
    expect(engine.getSnapshot().processCount).toBe(0)
    const process = engine.processManager.createProcess({ name: 'valid', burstTime: 1, priority: 1, memoryRequirement: 1 })
    if (mode === MemoryMode.PAGED) expect(engine.memoryManager.pagingManager.allocateProcessPages(process.pid).pages).toHaveLength(1)
    else expect(engine.memoryManager.allocateProcess(process.pid).size).toBe(1)
  })
})


describe('proposal CPU examples and synchronization compatibility', () => {
  it.each([
    ['FCFS', ['P1', 'P2', 'P3'], [0, 4, 6]],
    ['SJF', ['P1', 'P3', 'P2'], [0, 5, 3]],
  ] as const)('matches the proposal %s example', (algorithm, order, waiting) => {
    const engine = setup()
    engine.setScheduler(algorithm)
    add(engine, 5, 0); add(engine, 3, 1); add(engine, 1, 2)
    engine.fastForward(9)
    expect(engine.getSnapshot().cpu.executionSegments.map((segment) => segment.pid)).toEqual(order)
    expect(engine.getSnapshot().cpu.metrics.map((metric) => metric.waitingTime)).toEqual(waiting)
  })

  it('continues CPU execution after a running process blocks on a mutex', () => {
    const engine = setup()
    const first = add(engine)
    const second = add(engine)
    engine.processManager.admitArrivals(0)
    const mutex = engine.synchronizationManager.createMutex('compatibility')
    engine.synchronizationManager.acquireMutex(second.pid, mutex.id)
    engine.step()
    expect(engine.getSnapshot().cpu.runningProcess?.pid).toBe(first.pid)
    expect(engine.synchronizationManager.acquireMutex(first.pid, mutex.id)).toBe(false)
    expect(() => engine.step()).not.toThrow()
    expect(engine.getSnapshot().cpu.runningProcess?.pid).toBe(second.pid)
    engine.synchronizationManager.releaseMutex(second.pid, mutex.id)
    expect(engine.processManager.getProcess(first.pid)?.state).toBe(ProcessState.READY)
    engine.fastForward(10)
    expect(engine.getSnapshot().terminatedProcessCount).toBe(2)
  })
})
