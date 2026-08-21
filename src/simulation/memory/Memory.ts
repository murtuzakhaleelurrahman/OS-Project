export const MemoryMode = {
  CONTIGUOUS: 'CONTIGUOUS',
  PAGED: 'PAGED',
} as const

export type MemoryMode = (typeof MemoryMode)[keyof typeof MemoryMode]

export const AllocationStrategyType = {
  FIRST_FIT: 'FIRST_FIT',
  BEST_FIT: 'BEST_FIT',
  WORST_FIT: 'WORST_FIT',
} as const

export type AllocationStrategyType = (typeof AllocationStrategyType)[keyof typeof AllocationStrategyType]

export interface MemoryConfiguration {
  readonly totalMemorySize: number
}

export interface MemoryRegion {
  readonly startAddress: number
  readonly endAddress: number
  readonly size: number
  readonly allocated: boolean
  readonly ownerPid?: string
}

export interface MemorySnapshot {
  readonly configuration: MemoryConfiguration
  readonly mode: MemoryMode
  readonly totalMemory: number
  readonly usedMemory: number
  readonly freeMemory: number
  readonly regions: readonly MemoryRegion[]
  readonly allocationStrategy: AllocationStrategyType
  readonly allocationCount: number
  readonly freeRegionCount: number
  readonly largestFreeRegion: number
  readonly externalFragmentation: number
}

export function validateMemoryConfiguration(configuration: MemoryConfiguration): void {
  if (!Number.isInteger(configuration.totalMemorySize) || configuration.totalMemorySize <= 0) {
    throw new Error('Total memory size must be a positive integer')
  }
}