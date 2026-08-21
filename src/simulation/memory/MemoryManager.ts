import { EventSystem } from '../events/EventSystem'
import { AllocationStrategyType, MemoryMode, validateMemoryConfiguration, type MemoryConfiguration, type MemoryRegion, type MemorySnapshot } from './Memory'
import { createAllocationStrategy } from './AllocationStrategies'
import type { AllocationStrategy } from './AllocationStrategy'
import type { Process } from '../process/Process'
import { PageManager, validatePagingConfiguration, type PagingSnapshot } from './PageManager'

export interface MemoryManagerOptions {
  readonly events: EventSystem
  readonly getCurrentTick: () => number
  readonly configuration?: MemoryConfiguration
  readonly initialMode?: MemoryMode
  readonly initialStrategy?: AllocationStrategyType
  readonly getProcess?: (pid: string) => Process | undefined
  readonly onChange?: () => void
}

export class MemoryManager {
  private readonly events: EventSystem
  private readonly getCurrentTick: () => number
  private readonly configuration: MemoryConfiguration
  private readonly initialMode: MemoryMode
  private readonly initialStrategy: AllocationStrategyType
  private strategy: AllocationStrategy
  private readonly getProcess?: (pid: string) => Process | undefined
  readonly pagingManager: PageManager
  private mode: MemoryMode
  private regions: MemoryRegion[]
  private readonly onChange?: () => void

  constructor(options: MemoryManagerOptions) {
    this.events = options.events
    this.getCurrentTick = options.getCurrentTick
    const totalMemorySize = options.configuration?.totalMemorySize ?? 1024
    const configuredPageSize = options.configuration?.pageSize
    const pageSize = configuredPageSize ?? (totalMemorySize % 64 === 0 ? 64 : 1)
    this.configuration = { totalMemorySize, pageSize }
    validateMemoryConfiguration(this.configuration)
    if (configuredPageSize !== undefined) validatePagingConfiguration(totalMemorySize, configuredPageSize)
    this.initialMode = options.initialMode ?? MemoryMode.CONTIGUOUS
    this.initialStrategy = options.initialStrategy ?? AllocationStrategyType.FIRST_FIT
    this.strategy = createAllocationStrategy(this.initialStrategy)
    this.getProcess = options.getProcess
    this.mode = this.initialMode
    this.regions = [this.createInitialRegion()]
    this.onChange = options.onChange
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_INITIALIZED', message: `Memory initialized: ${this.configuration.totalMemorySize} units` })
    this.pagingManager = new PageManager({
      events: this.events,
      getCurrentTick: this.getCurrentTick,
      getProcess: this.getProcess,
      isPagedMode: () => this.mode === MemoryMode.PAGED,
      totalMemory: this.configuration.totalMemorySize,
      pageSize: this.configuration.pageSize ?? 64,
      onChange: this.onChange,
    })
    if (this.initialMode === MemoryMode.PAGED) this.pagingManager.announceInitialized()
  }

  getConfiguration(): MemoryConfiguration { return { ...this.configuration } }
  getMode(): MemoryMode { return this.mode }
  getAllocationStrategy(): AllocationStrategyType { return this.strategy.type }
  getPagingSnapshot(): PagingSnapshot { return this.pagingManager.getSnapshot() }

  setMode(mode: MemoryMode): void {
    if (mode === this.mode) return
    if (mode === MemoryMode.PAGED && this.regions.some((region) => region.allocated)) throw new Error('Cannot switch to Paged mode while contiguous allocations exist')
    if (mode === MemoryMode.CONTIGUOUS && this.pagingManager.getSnapshot().pageTables.length > 0) throw new Error('Cannot switch to Contiguous mode while paging allocations exist')
    const previousMode = this.mode
    this.mode = mode
    if (mode === MemoryMode.PAGED) this.pagingManager.announceInitialized()
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_MODE_CHANGED', message: `Memory mode changed: ${previousMode} -> ${mode}` })
    this.changed()
  }

  setAllocationStrategy(strategyType: AllocationStrategyType): void {
    if (strategyType === this.strategy.type) return
    const previousStrategy = this.strategy.type
    this.strategy = createAllocationStrategy(strategyType)
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_STRATEGY_CHANGED', message: `Allocation strategy changed: ${previousStrategy} -> ${strategyType}` })
    this.changed()
  }

  getTotalMemory(): number { return this.configuration.totalMemorySize }
  getUsedMemory(): number { return this.regions.filter((region) => region.allocated).reduce((total, region) => total + region.size, 0) }
  getFreeMemory(): number { return this.getTotalMemory() - this.getUsedMemory() }

  allocateProcess(pid: string): MemoryRegion {
    const process = this.getProcess?.(pid)
    if (process === undefined) throw new Error(`Process not found: ${pid}`)
    return this.allocate(pid, process.memoryRequirement)
  }

  allocate(pid: string, requestedSize: number): MemoryRegion {
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_ALLOCATION_REQUESTED', processId: pid, message: `Allocation requested: ${pid} (${requestedSize} units)` })
    if (this.mode !== MemoryMode.CONTIGUOUS) return this.failAllocation(pid, 'Cannot allocate memory while Paged mode is active')
    if (!Number.isInteger(requestedSize) || requestedSize <= 0) return this.failAllocation(pid, 'Invalid memory requirement')
    if (this.regions.some((region) => region.ownerPid === pid)) return this.failAllocation(pid, 'Process already has allocated memory')
    const selectedRegion = this.strategy.selectRegion(this.getFreeRegions(), requestedSize)
    if (selectedRegion === undefined) return this.failAllocation(pid, 'No suitable contiguous region available')

    const allocatedRegion: MemoryRegion = { startAddress: selectedRegion.startAddress, endAddress: selectedRegion.startAddress + requestedSize, size: requestedSize, allocated: true, ownerPid: pid }
    const replacement: MemoryRegion[] = [allocatedRegion]
    if (allocatedRegion.endAddress < selectedRegion.endAddress) replacement.push(this.createFreeRegion(allocatedRegion.endAddress, selectedRegion.endAddress))
    this.regions = this.regions.flatMap((region) => region.startAddress === selectedRegion.startAddress ? replacement : [region])
    this.validateLayout()
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_ALLOCATED', processId: pid, message: `${pid} allocated [${allocatedRegion.startAddress},${allocatedRegion.endAddress}) using ${this.strategy.type}` })
    this.changed()
    return { ...allocatedRegion }
  }

  deallocate(pid: string): void {
    const allocationIndex = this.regions.findIndex((region) => region.ownerPid === pid)
    if (allocationIndex < 0) throw new Error(`No allocation found for process ${pid}`)
    const allocation = this.regions[allocationIndex]
    this.regions[allocationIndex] = this.createFreeRegion(allocation.startAddress, allocation.endAddress)
    const beforeMergeCount = this.regions.length
    this.regions = this.mergeFreeRegions(this.regions)
    this.validateLayout()
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_DEALLOCATED', processId: pid, message: `${pid} deallocated` })
    if (this.regions.length < beforeMergeCount) this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_REGIONS_MERGED', processId: pid, message: 'Adjacent free regions merged' })
    this.changed()
  }

  getMemorySnapshot(): MemorySnapshot {
    return {
      configuration: this.getConfiguration(),
      mode: this.mode,
      totalMemory: this.getTotalMemory(),
      usedMemory: this.getUsedMemory(),
      freeMemory: this.getFreeMemory(),
      regions: this.regions.map((region) => ({ ...region })),
      allocationStrategy: this.strategy.type,
      allocationCount: this.regions.filter((region) => region.allocated).length,
      freeRegionCount: this.getFreeRegions().length,
      largestFreeRegion: Math.max(0, ...this.getFreeRegions().map((region) => region.size)),
      externalFragmentation: Math.max(0, this.getFreeMemory() - Math.max(0, ...this.getFreeRegions().map((region) => region.size))),
    }
  }

  reset(): void {
    this.mode = this.initialMode
    this.strategy = createAllocationStrategy(this.initialStrategy)
    this.regions = [this.createInitialRegion()]
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_RESET', message: 'Memory reset' })
    this.pagingManager.reset()
    this.changed()
  }

  private createInitialRegion(): MemoryRegion {
    return { startAddress: 0, endAddress: this.configuration.totalMemorySize, size: this.configuration.totalMemorySize, allocated: false }
  }

  private createFreeRegion(startAddress: number, endAddress: number): MemoryRegion {
    return { startAddress, endAddress, size: endAddress - startAddress, allocated: false }
  }

  private getFreeRegions(): readonly MemoryRegion[] { return this.regions.filter((region) => !region.allocated) }

  private mergeFreeRegions(regions: readonly MemoryRegion[]): MemoryRegion[] {
    const merged: MemoryRegion[] = []
    for (const region of regions) {
      const previous = merged[merged.length - 1]
      if (previous !== undefined && !previous.allocated && !region.allocated && previous.endAddress === region.startAddress) {
        merged[merged.length - 1] = this.createFreeRegion(previous.startAddress, region.endAddress)
      } else merged.push({ ...region })
    }
    return merged
  }

  private failAllocation(pid: string, reason: string): never {
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_ALLOCATION_FAILED', processId: pid, message: `Allocation failed: ${reason}` })
    throw new Error(reason)
  }

  private validateLayout(): void {
    if (this.regions.length === 0 || this.regions[0].startAddress !== 0 || this.regions[this.regions.length - 1].endAddress !== this.getTotalMemory()) throw new Error('Invalid memory layout coverage')
    for (let index = 0; index < this.regions.length; index += 1) {
      const region = this.regions[index]
      if (region.size <= 0 || region.size !== region.endAddress - region.startAddress || region.startAddress < 0 || region.endAddress > this.getTotalMemory()) throw new Error('Invalid memory region')
      if (region.allocated ? region.ownerPid === undefined : region.ownerPid !== undefined) throw new Error('Invalid memory region ownership')
      const next = this.regions[index + 1]
      if (next !== undefined && region.endAddress !== next.startAddress) throw new Error('Memory regions do not fully cover memory')
    }
  }

  private changed(): void { this.onChange?.() }
}