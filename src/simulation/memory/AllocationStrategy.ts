import type { MemoryRegion } from './Memory'

export interface AllocationStrategy {
  readonly type: import('./Memory').AllocationStrategyType
  selectRegion(freeRegions: readonly MemoryRegion[], requestedSize: number): MemoryRegion | undefined
}