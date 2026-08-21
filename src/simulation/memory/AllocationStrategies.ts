import { AllocationStrategyType, type MemoryRegion } from './Memory'
import type { AllocationStrategy } from './AllocationStrategy'

export class FirstFitStrategy implements AllocationStrategy {
  readonly type = AllocationStrategyType.FIRST_FIT
  selectRegion(freeRegions: readonly MemoryRegion[], requestedSize: number): MemoryRegion | undefined {
    return freeRegions.find((region) => region.size >= requestedSize)
  }
}

export class BestFitStrategy implements AllocationStrategy {
  readonly type = AllocationStrategyType.BEST_FIT
  selectRegion(freeRegions: readonly MemoryRegion[], requestedSize: number): MemoryRegion | undefined {
    return [...freeRegions]
      .filter((region) => region.size >= requestedSize)
      .sort((left, right) => left.size - right.size || left.startAddress - right.startAddress)[0]
  }
}

export class WorstFitStrategy implements AllocationStrategy {
  readonly type = AllocationStrategyType.WORST_FIT
  selectRegion(freeRegions: readonly MemoryRegion[], requestedSize: number): MemoryRegion | undefined {
    return [...freeRegions]
      .filter((region) => region.size >= requestedSize)
      .sort((left, right) => right.size - left.size || left.startAddress - right.startAddress)[0]
  }
}

export function createAllocationStrategy(type: AllocationStrategyType): AllocationStrategy {
  if (type === AllocationStrategyType.BEST_FIT) return new BestFitStrategy()
  if (type === AllocationStrategyType.WORST_FIT) return new WorstFitStrategy()
  return new FirstFitStrategy()
}