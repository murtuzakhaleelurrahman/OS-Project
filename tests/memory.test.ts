import { describe, expect, it } from 'vitest'
import { EventSystem } from '../src/simulation/events/EventSystem'
import { MemoryManager } from '../src/simulation/memory/MemoryManager'
import { MemoryMode } from '../src/simulation/memory/Memory'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'
import { ProcessState } from '../src/simulation/process/Process'
import { AllocationStrategyType } from '../src/simulation/memory/Memory'
import { BestFitStrategy, FirstFitStrategy, WorstFitStrategy } from '../src/simulation/memory/AllocationStrategies'
import type { MemoryRegion } from '../src/simulation/memory/Memory'

function createMemory(totalMemorySize = 1024) {
  const events = new EventSystem()
  let tick = 0
  const manager = new MemoryManager({ events, getCurrentTick: () => tick, configuration: { totalMemorySize } })
  return { events, manager, setTick: (nextTick: number) => { tick = nextTick } }
}

function assertValidLayout(regions: readonly MemoryRegion[], total: number) {
  expect(regions[0]?.startAddress).toBe(0)
  expect(regions.at(-1)?.endAddress).toBe(total)
  let covered = 0
  regions.forEach((region, index) => {
    expect(region.size).toBe(region.endAddress - region.startAddress)
    expect(region.size).toBeGreaterThan(0)
    expect(region.startAddress).toBe(covered)
    if (region.allocated) expect(region.ownerPid).toEqual(expect.any(String))
    if (!region.allocated) expect(region.ownerPid).toBeUndefined()
    if (index > 0) expect(regions[index - 1].endAddress).toBe(region.startAddress)
    covered = region.endAddress
  })
  expect(covered).toBe(total)
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
      [0, 'MEMORY_INITIALIZED'], [5, 'MEMORY_PAGING_INITIALIZED'], [5, 'MEMORY_MODE_CHANGED'], [5, 'MEMORY_MODE_CHANGED'],
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
    expect(events.getAll()).toContainEqual(expect.objectContaining({ type: 'MEMORY_RESET' }))
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
    expect(engine.getSnapshot().events).toContainEqual(expect.objectContaining({ type: 'MEMORY_RESET' }))
  })

  it('resets memory through the engine while preserving the single process manager', () => {
    const engine = new SimulationEngine()
    engine.memoryManager.setMode(MemoryMode.PAGED)
    engine.reset()

    expect(engine.getSnapshot().memory).toMatchObject({ mode: MemoryMode.CONTIGUOUS, totalMemory: 1024, usedMemory: 0, freeMemory: 1024 })
    expect(engine.getSnapshot().events.map((event) => event.type)).toEqual(['CLOCK_RESET', 'MEMORY_RESET', 'PAGING_RESET'])
  })
})

describe('allocation strategies', () => {
  const regions: MemoryRegion[] = [
    { startAddress: 100, endAddress: 200, size: 100, allocated: false },
    { startAddress: 300, endAddress: 600, size: 300, allocated: false },
    { startAddress: 700, endAddress: 900, size: 200, allocated: false },
  ]

  it('selects the first suitable region with First Fit', () => expect(new FirstFitStrategy().selectRegion(regions, 150)?.startAddress).toBe(300))
  it('selects the smallest suitable region with Best Fit', () => expect(new BestFitStrategy().selectRegion(regions, 150)?.startAddress).toBe(700))
  it('selects the largest suitable region with Worst Fit', () => expect(new WorstFitStrategy().selectRegion(regions, 150)?.startAddress).toBe(300))
  it('breaks equal-size strategy ties by lower address', () => {
    const tied = [regions[2], { startAddress: 950, endAddress: 1150, size: 200, allocated: false }]
    expect(new BestFitStrategy().selectRegion(tied, 150)?.startAddress).toBe(700)
    expect(new WorstFitStrategy().selectRegion(tied, 150)?.startAddress).toBe(700)
  })
})

describe('contiguous allocation', () => {
  it('splits the initial region and supports exact-fit allocation', () => {
    const { manager } = createMemory(1000)
    manager.allocate('P1', 200)
    expect(manager.getMemorySnapshot().regions).toEqual([
      { startAddress: 0, endAddress: 200, size: 200, allocated: true, ownerPid: 'P1' },
      { startAddress: 200, endAddress: 1000, size: 800, allocated: false },
    ])
    manager.allocate('P2', 800)
    expect(manager.getMemorySnapshot().freeMemory).toBe(0)
    expect(manager.getMemorySnapshot().regions).toHaveLength(2)
  })

  it('selects strategies and updates metrics', () => {
    const { manager } = createMemory(1000)
    manager.allocate('P1', 200)
    manager.allocate('P2', 300)
    manager.deallocate('P1')
    manager.setAllocationStrategy(AllocationStrategyType.BEST_FIT)
    manager.allocate('P3', 150)
    const snapshot = manager.getMemorySnapshot()
    expect(snapshot.allocationStrategy).toBe(AllocationStrategyType.BEST_FIT)
    expect(snapshot.allocationCount).toBe(2)
    expect(snapshot.usedMemory).toBe(450)
    expect(snapshot.freeRegionCount).toBe(2)
    expect(snapshot.largestFreeRegion).toBe(500)
    expect(snapshot.externalFragmentation).toBe(50)
    assertValidLayout(snapshot.regions, 1000)
  })

  it('fails when free memory is sufficient but no contiguous region is large enough', () => {
    const { manager } = createMemory(1000)
    manager.allocate('P1', 200)
    manager.allocate('P2', 200)
    manager.allocate('P3', 200)
    manager.deallocate('P1')
    manager.deallocate('P3')
    const before = manager.getMemorySnapshot()
    expect(before.freeMemory).toBe(800)
    expect(before.largestFreeRegion).toBe(600)
    expect(before.externalFragmentation).toBe(200)
    expect(() => manager.allocate('P4', 700)).toThrow('No suitable contiguous region available')
    expect(manager.getMemorySnapshot().regions).toEqual(before.regions)
  })

  it('rejects invalid, duplicate, oversized, and paged allocations atomically', () => {
    const { manager, events } = createMemory(100)
    expect(() => manager.allocate('P1', 0)).toThrow('Invalid memory requirement')
    expect(() => manager.allocate('P1', 101)).toThrow('No suitable contiguous region available')
    manager.allocate('P1', 50)
    expect(() => manager.allocate('P1', 10)).toThrow('Process already has allocated memory')
    manager.deallocate('P1')
    manager.setMode(MemoryMode.PAGED)
    const before = manager.getMemorySnapshot()
    expect(() => manager.allocate('P2', 10)).toThrow('Paged mode')
    expect(manager.getMemorySnapshot().regions).toEqual(before.regions)
    expect(events.getAll().some((event) => event.type === 'MEMORY_ALLOCATION_FAILED')).toBe(true)
  })

  it('deallocates by PID and merges only adjacent free regions', () => {
    const { manager } = createMemory(1000)
    manager.allocate('P1', 200)
    manager.allocate('P2', 200)
    manager.allocate('P3', 200)
    manager.deallocate('P1')
    expect(manager.getMemorySnapshot().regions[0]).toMatchObject({ allocated: false, size: 200 })
    manager.deallocate('P3')
    expect(manager.getMemorySnapshot().freeRegionCount).toBe(2)
    manager.deallocate('P2')
    const snapshot = manager.getMemorySnapshot()
    expect(snapshot.regions).toEqual([{ startAddress: 0, endAddress: 1000, size: 1000, allocated: false }])
    expect(snapshot.usedMemory).toBe(0)
    assertValidLayout(snapshot.regions, 1000)
  })

  it('allocates process memory through the existing process lookup', () => {
    const events = new EventSystem()
    const manager = new (class extends MemoryManager {})({
      events,
      getCurrentTick: () => 0,
      getProcess: (pid) => pid === 'P1' ? { pid, name: 'P1', state: ProcessState.NEW, arrivalTime: 0, burstTime: 1, remainingTime: 1, priority: 1, memoryRequirement: 64, programCounter: 0 } : undefined,
    })
    expect(manager.allocateProcess('P1')).toMatchObject({ ownerPid: 'P1', size: 64 })
  })

  it('replays allocation and deallocation deterministically', () => {
    const run = () => {
      const { manager } = createMemory(500)
      manager.setAllocationStrategy(AllocationStrategyType.WORST_FIT)
      manager.allocate('P1', 100)
      manager.allocate('P2', 150)
      manager.deallocate('P1')
      return manager.getMemorySnapshot()
    }
    expect(run()).toEqual(run())
  })
})