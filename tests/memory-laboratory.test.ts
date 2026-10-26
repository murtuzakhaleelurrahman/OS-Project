import { describe, expect, it } from 'vitest'
import { AllocationStrategyType, MemoryMode } from '../src/simulation/memory/Memory'
import { createReplacementLab, MemoryLaboratory, translationPreset } from '../src/simulation/memory/MemoryLaboratory'

describe('proposal memory acceptance', () => {
  it.each([['FIFO', 7], ['LRU', 6], ['OPTIMAL', 5]] as const)('matches %s faults with three frames', (algorithm, faults) => {
    const manager = createReplacementLab(3)
    manager.setReplacementAlgorithm(algorithm); manager.runAllReferences()
    const result = manager.getSnapshot()
    expect(result.pageFaults).toBe(faults)
    expect(result.pageHits + result.pageFaults).toBe(8)
    expect(result.pageReplacements).toBe(faults - 3)
  })
  it('matches 2500 → page 2 / offset 452 / physical address 5572', () => {
    const lab = translationPreset()
    expect(lab.memory.pagingManager.translate('P2', 2500)).toMatchObject({ success: true, pageNumber: 2, offset: 452, frameNumber: 5, physicalAddress: 5572 })
    expect(lab.memory.pagingManager.translate('P2', 3072).success).toBe(false)
  })
  it('unmaps and remaps pages while preserving unique occupied frames', () => {
    const lab = translationPreset()
    const manager = lab.memory.pagingManager
    manager.unmapPage('P2', 2)
    expect(manager.translate('P2', 2500).pageFault).toBe(true)
    const before = manager.getSnapshot()
    expect(() => manager.mapPage('P2', 2, 0)).toThrow('occupied')
    expect(manager.getSnapshot()).toEqual(before)
    manager.mapPage('P2', 2, 7)
    expect(manager.translate('P2', 2500).physicalAddress).toBe(7620)
    expect(manager.getSnapshot().usedFrames).toBe(6)
    manager.mapPage('P2', 2, 6)
    expect(manager.getFrames()[7].occupied).toBe(false)
    expect(manager.getSnapshot().usedFrames).toBe(6)
  })
  it.each(Object.values(AllocationStrategyType))('coalesces free space and demonstrates fragmentation with %s', (strategy) => {
    const lab = new MemoryLaboratory(100, 1)
    lab.setStrategy(strategy)
    const ids = [30, 30, 30].map((size) => { const pid = lab.create(size); lab.allocate(pid); return pid })
    lab.free(ids[0]); lab.free(ids[2])
    expect(lab.getSnapshot().memory).toMatchObject({ freeMemory: 70, largestFreeRegion: 40, externalFragmentation: 30 })
    expect(() => lab.allocate(lab.create(50))).toThrow('No suitable')
    lab.free(ids[1])
    expect(lab.getSnapshot().memory.regions).toHaveLength(1)
    expect(lab.getSnapshot().memory.largestFreeRegion).toBe(100)
  })
  it('supports one frame, repeated references, and validated custom memory sizes', () => {
    const manager = createReplacementLab(1)
    manager.setReferenceString([1, 1, 2, 2]); manager.runAllReferences()
    expect(manager.getSnapshot()).toMatchObject({ pageHits: 2, pageFaults: 2, pageReplacements: 1 })
    expect(() => new MemoryLaboratory(100, 64)).toThrow()
    expect(() => new MemoryLaboratory(1000, 1, MemoryMode.PAGED)).toThrow('256')
    expect(() => createReplacementLab(0)).toThrow()
  })
})
