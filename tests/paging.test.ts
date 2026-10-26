import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'
import { MemoryMode } from '../src/simulation/memory/Memory'
import { validatePagingConfiguration } from '../src/simulation/memory/PageManager'
import { FifoReplacement, LruReplacement, OptimalReplacement, PageReplacementAlgorithm } from '../src/simulation/memory/PageReplacement'

function createPagedEngine() {
  const engine = new SimulationEngine()
  engine.memoryManager.setMode(MemoryMode.PAGED)
  const process = engine.processManager.createProcess({ name: 'P1', burstTime: 2, priority: 1, memoryRequirement: 130 })
  return { engine, process }
}

describe('paging foundation', () => {
  it('validates page configuration and creates half-open frames', () => {
    expect(() => validatePagingConfiguration(1024, 0)).toThrow()
    expect(() => validatePagingConfiguration(1024, 63)).toThrow()
    const { engine } = createPagedEngine()
    const snapshot = engine.getSnapshot().paging
    expect(snapshot.configuration).toEqual({ totalMemory: 1024, pageSize: 64, totalFrames: 16 })
    expect(snapshot.frames[0]).toMatchObject({ frameNumber: 0, startAddress: 0, endAddress: 64, occupied: false })
    expect(snapshot.frames.at(-1)).toMatchObject({ frameNumber: 15, startAddress: 960, endAddress: 1024 })
  })

  it.each([
    [64, 1, 0],
    [65, 2, 63],
    [128, 2, 0],
    [130, 3, 62],
  ])('calculates pages and internal fragmentation for %s bytes', (memoryRequirement, expectedPages, expectedFragmentation) => {
    const engine = new SimulationEngine()
    engine.memoryManager.setMode(MemoryMode.PAGED)
    const process = engine.processManager.createProcess({ name: 'P1', burstTime: 1, priority: 1, memoryRequirement })
    const table = engine.memoryManager.pagingManager.allocateProcessPages(process.pid)
    expect(table.pages).toHaveLength(expectedPages)
    expect(engine.getSnapshot().paging.totalInternalFragmentation).toBe(expectedFragmentation)
  })

  it('allocates first free frames with process-specific page numbering', () => {
    const { engine, process } = createPagedEngine()
    const table = engine.memoryManager.pagingManager.allocateProcessPages(process.pid)
    expect(table.pages).toEqual([
      { pageNumber: 0, ownerPid: 'P1', frameNumber: 0, present: true },
      { pageNumber: 1, ownerPid: 'P1', frameNumber: 1, present: true },
      { pageNumber: 2, ownerPid: 'P1', frameNumber: 2, present: true },
    ])
    expect(engine.getSnapshot().paging).toMatchObject({ usedFrames: 3, freeFrames: 13, totalAllocatedPages: 3 })
  })

  it('fails atomically for duplicates, insufficient frames, and contiguous mode', () => {
    const { engine, process } = createPagedEngine()
    engine.memoryManager.pagingManager.allocateProcessPages(process.pid)
    const before = engine.getSnapshot().paging
    expect(() => engine.memoryManager.pagingManager.allocateProcessPages(process.pid)).toThrow('already has allocated pages')
    expect(engine.getSnapshot().paging.frames).toEqual(before.frames)
    const contiguous = new SimulationEngine()
    const other = contiguous.processManager.createProcess({ name: 'P2', burstTime: 1, priority: 1, memoryRequirement: 64 })
    expect(() => contiguous.memoryManager.pagingManager.allocateProcessPages(other.pid)).toThrow('Contiguous mode')
  })

  it('translates addresses and detects invalid or unmapped pages', () => {
    const { engine, process } = createPagedEngine()
    engine.memoryManager.pagingManager.allocateProcessPages(process.pid)
    expect(engine.memoryManager.pagingManager.translate(process.pid, 128)).toMatchObject({ success: true, pageNumber: 2, offset: 0, frameNumber: 2, physicalAddress: 128 })
    expect(engine.memoryManager.pagingManager.translate(process.pid, 129)).toMatchObject({ success: true, pageNumber: 2, offset: 1 })
    expect(engine.memoryManager.pagingManager.translate(process.pid, 130).error).toBe('Invalid logical address')
    engine.memoryManager.pagingManager.unmapPage(process.pid, 1)
    expect(engine.memoryManager.pagingManager.translate(process.pid, 65)).toMatchObject({ success: false, pageFault: true, pageNumber: 1, offset: 1 })
  })

  it('deallocates frames, resets paging, and replays deterministically', () => {
    const run = () => {
      const { engine, process } = createPagedEngine()
      engine.memoryManager.pagingManager.allocateProcessPages(process.pid)
      engine.memoryManager.pagingManager.deallocateProcessPages(process.pid)
      return engine.getSnapshot().paging
    }
    expect(run()).toEqual(run())
    const { engine, process } = createPagedEngine()
    engine.memoryManager.pagingManager.allocateProcessPages(process.pid)
    engine.memoryManager.pagingManager.deallocateProcessPages(process.pid)
    expect(engine.getSnapshot().paging).toMatchObject({ usedFrames: 0, freeFrames: 16, totalAllocatedPages: 0, totalInternalFragmentation: 0 })
    engine.memoryManager.pagingManager.reset()
    expect(engine.getSnapshot().paging.pageTables).toEqual([])
  })
})

describe('page replacement', () => {
  const fullFrames = Array.from({ length: 3 }, (_, frameNumber) => ({ frameNumber, pageNumber: frameNumber + 1, loadedAt: frameNumber, lastUsedAt: frameNumber }))

  it('selects FIFO victims by residency order and ignores hits', () => {
    const strategy = new FifoReplacement()
    expect(strategy.selectVictim({ frames: fullFrames, currentIndex: 3, futureReferences: [1, 2, 3, 1, 4] }).pageNumber).toBe(1)
  })

  it('selects the LRU victim by last reference time', () => {
    const frames = fullFrames.map((frame) => frame.pageNumber === 1 ? { ...frame, lastUsedAt: 3 } : frame)
    expect(new LruReplacement().selectVictim({ frames, currentIndex: 4, futureReferences: [1, 2, 3, 1, 4] }).pageNumber).toBe(2)
  })

  it('selects never-used-again pages with deterministic frame tie-breaking for Optimal', () => {
    expect(new OptimalReplacement().selectVictim({ frames: fullFrames, currentIndex: 3, futureReferences: [1, 2, 3, 4] }).pageNumber).toBe(1)
  })

  it('counts hits, faults, replacements, and keeps algorithm runs deterministic', () => {
    const run = (algorithm: PageReplacementAlgorithm) => {
      const engine = new SimulationEngine()
      engine.memoryManager.setMode(MemoryMode.PAGED)
      const manager = engine.memoryManager.pagingManager
      manager.setReplacementAlgorithm(algorithm)
      manager.setReferenceString([...Array(16).keys(), 0, 16])
      manager.runAllReferences()
      return manager.getSnapshot()
    }
    const fifo = run(PageReplacementAlgorithm.FIFO)
    const lru = run(PageReplacementAlgorithm.LRU)
    const optimal = run(PageReplacementAlgorithm.OPTIMAL)
    expect(fifo).toMatchObject({ totalReferences: 18, pageHits: 1, pageFaults: 17, pageReplacements: 1, replacementAlgorithm: 'FIFO' })
    expect(fifo.replacementHistory.at(-1)).toMatchObject({ requestedPage: 16, victimPage: 0, victimFrame: 0 })
    expect(lru.replacementHistory.at(-1)).toMatchObject({ requestedPage: 16, victimPage: 1, victimFrame: 1 })
    expect(optimal.replacementHistory.at(-1)).toMatchObject({ requestedPage: 16, victimPage: 0, victimFrame: 0 })
    expect(run(PageReplacementAlgorithm.LRU).replacementHistory).toEqual(lru.replacementHistory)
  })

  it('rejects malformed references and keeps empty ratios at zero', () => {
    const engine = new SimulationEngine()
    const manager = engine.memoryManager.pagingManager
    expect(() => manager.setReferenceString([1, -1])).toThrow('non-negative')
    expect(manager.getSnapshot()).toMatchObject({ totalReferences: 0, hitRatio: 0, faultRatio: 0, replacementRatio: 0 })
  })
})
