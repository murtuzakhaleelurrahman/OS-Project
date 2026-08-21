import { EventSystem } from '../events/EventSystem'
import { MemoryMode, validateMemoryConfiguration, type MemoryConfiguration, type MemoryRegion, type MemorySnapshot } from './Memory'

export interface MemoryManagerOptions {
  readonly events: EventSystem
  readonly getCurrentTick: () => number
  readonly configuration?: MemoryConfiguration
  readonly initialMode?: MemoryMode
  readonly onChange?: () => void
}

export class MemoryManager {
  private readonly events: EventSystem
  private readonly getCurrentTick: () => number
  private readonly configuration: MemoryConfiguration
  private readonly initialMode: MemoryMode
  private mode: MemoryMode
  private regions: MemoryRegion[]
  private readonly onChange?: () => void

  constructor(options: MemoryManagerOptions) {
    this.events = options.events
    this.getCurrentTick = options.getCurrentTick
    this.configuration = { totalMemorySize: options.configuration?.totalMemorySize ?? 1024 }
    validateMemoryConfiguration(this.configuration)
    this.initialMode = options.initialMode ?? MemoryMode.CONTIGUOUS
    this.mode = this.initialMode
    this.regions = [this.createInitialRegion()]
    this.onChange = options.onChange
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_INITIALIZED', message: `Memory initialized: ${this.configuration.totalMemorySize} units` })
  }

  getConfiguration(): MemoryConfiguration { return { ...this.configuration } }
  getMode(): MemoryMode { return this.mode }

  setMode(mode: MemoryMode): void {
    if (mode === this.mode) return
    const previousMode = this.mode
    this.mode = mode
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_MODE_CHANGED', message: `Memory mode changed: ${previousMode} -> ${mode}` })
    this.changed()
  }

  getTotalMemory(): number { return this.configuration.totalMemorySize }
  getUsedMemory(): number { return this.regions.filter((region) => region.allocated).reduce((total, region) => total + region.size, 0) }
  getFreeMemory(): number { return this.getTotalMemory() - this.getUsedMemory() }

  getMemorySnapshot(): MemorySnapshot {
    return {
      configuration: this.getConfiguration(),
      mode: this.mode,
      totalMemory: this.getTotalMemory(),
      usedMemory: this.getUsedMemory(),
      freeMemory: this.getFreeMemory(),
      regions: this.regions.map((region) => ({ ...region })),
    }
  }

  reset(): void {
    this.mode = this.initialMode
    this.regions = [this.createInitialRegion()]
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_RESET', message: 'Memory reset' })
    this.changed()
  }

  private createInitialRegion(): MemoryRegion {
    return { startAddress: 0, endAddress: this.configuration.totalMemorySize, size: this.configuration.totalMemorySize, allocated: false }
  }

  private changed(): void { this.onChange?.() }
}