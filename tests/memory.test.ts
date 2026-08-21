import { describe, expect, it } from 'vitest'
import { EventSystem } from '../src/simulation/events/EventSystem'
import { MemoryManager } from '../src/simulation/memory/MemoryManager'
import { MemoryMode } from '../src/simulation/memory/Memory'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'
import { ProcessState } from '../src/simulation/process/Process'

function createMemory(totalMemorySize = 1024) {
  const events = new EventSystem()
  let tick = 0
  const manager = new MemoryManager({ events, getCurrentTick: () => tick, configuration: { totalMemorySize } })
  return { events, manager, setTick: (nextTick: number) => { tick = nextTick } }
}

describe('MemoryManager foundation', () => {
  it('creates a valid initial physical memory region', () => {
    const { manager, events } = createMemory()
    const snapshot = manager.getMemorySnapshot()
    expect(snapshot).toMatchObject({ mode: MemoryMode.CONTIGUOUS, totalMemory: 1024, usedMemory: 0, freeMemory: 1024 })
    expect(snapshot.regions).toEqual([{ startAddress: 0, endAddress: 1024, size: 1024, allocated: false }])
    expect(events.getAll()[0]).toMatchObject({ tick: 0, type: 'MEMORY_INITIALIZED' })
  })

  it.each([0, -1, 1.5])('rejects invalid total memory size %s', (totalMemorySize) => {
    expect(() => createMemory(totalMemorySize).manager).toThrow('Total memory size must be a positive integer')
  })

  it('switches modes and emits logical-tick events', () => {
    const { manager, events, setTick } = createMemory()
    setTick(5)
    manager.setMode(MemoryMode.PAGED)
    manager.setMode(MemoryMode.CONTIGUOUS)
    expect(manager.getMode()).toBe(MemoryMode.CONTIGUOUS)
    expect(events.getAll().map((event) => [event.tick, event.type])).toEqual([
      [0, 'MEMORY_INITIALIZED'], [5, 'MEMORY_MODE_CHANGED'], [5, 'MEMORY_MODE_CHANGED'],
    ])
  })

  it('returns defensive snapshots and resets mode and regions', () => {
    const { manager, events } = createMemory(256)
    manager.setMode(MemoryMode.PAGED)
    const snapshot = manager.getMemorySnapshot()
    snapshot.regions[0].allocated = true
    manager.reset()
    expect(manager.getMemorySnapshot()).toMatchObject({ mode: MemoryMode.CONTIGUOUS, totalMemory: 256, usedMemory: 0, freeMemory: 256 })
    expect(manager.getMemorySnapshot().regions[0].allocated).toBe(false)
    expect(events.getAll().at(-1)).toMatchObject({ type: 'MEMORY_RESET' })
  })

  it('replays the same memory commands deterministically', () => {
    const run = () => {
      const { manager } = createMemory(512)
      manager.setMode(MemoryMode.PAGED)
      manager.setMode(MemoryMode.CONTIGUOUS)
      return manager.getMemorySnapshot()
    }
    expect(run()).toEqual(run())
  })

  it('is coordinated by the existing engine and does not alter processes on reset', () => {
    const engine = new SimulationEngine()
    const process = engine.processManager.createProcess({ name: 'worker', burstTime: 2, priority: 1, memoryRequirement: 8 })
    engine.memoryManager.setMode(MemoryMode.PAGED)

    expect(engine.getSnapshot().memory.mode).toBe(MemoryMode.PAGED)
    engine.memoryManager.reset()
    expect(engine.getSnapshot().memory.mode).toBe(MemoryMode.CONTIGUOUS)
    expect(engine.processManager.getProcess(process.pid)?.state).toBe(ProcessState.NEW)
    expect(engine.getSnapshot().events.at(-1)?.type).toBe('MEMORY_RESET')
  })

  it('resets memory through the engine while preserving the single process manager', () => {
    const engine = new SimulationEngine()
    engine.memoryManager.setMode(MemoryMode.PAGED)
    engine.reset()

    expect(engine.getSnapshot().memory).toMatchObject({ mode: MemoryMode.CONTIGUOUS, totalMemory: 1024, usedMemory: 0, freeMemory: 1024 })
    expect(engine.getSnapshot().events.map((event) => event.type)).toEqual(['CLOCK_RESET', 'MEMORY_RESET'])
  })
})