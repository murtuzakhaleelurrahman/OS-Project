import { EventSystem } from '../events/EventSystem'
import { integer } from '../integrated/Scenario'
import { ProcessManager } from '../process/ProcessManager'
import { MemoryManager } from './MemoryManager'
import { MemoryMode, type AllocationStrategyType } from './Memory'
import { PageManager } from './PageManager'

export class MemoryLaboratory {
  readonly events = new EventSystem()
  readonly processes = new ProcessManager({ events: this.events, getCurrentTick: () => 0 })
  readonly memory: MemoryManager
  constructor(total = 1024, pageSize = 64, mode: MemoryMode = MemoryMode.CONTIGUOUS) {
    integer(total, 'Total memory', 1, 65536); integer(pageSize, 'Page size', 1, 65536)
    if (total % pageSize || total / pageSize > 256) throw new Error('Memory must be divisible by page size and contain at most 256 frames')
    this.memory = new MemoryManager({ events: this.events, getCurrentTick: () => 0, getProcess: (pid) => this.processes.getProcess(pid), configuration: { totalMemorySize: total, pageSize }, initialMode: mode })
  }
  create(size: number): string {
    if (this.processes.getAllProcesses().length >= 100) throw new Error('Reset the lab after 100 processes')
    return this.processes.createProcess({ name: 'Memory lab process', memoryRequirement: size, burstTime: 1, priority: 0 }).pid
  }
  allocate(pid: string): void { if (this.memory.getMode() === MemoryMode.PAGED) this.memory.pagingManager.allocateProcessPages(pid); else this.memory.allocateProcess(pid) }
  free(pid: string): void { if (this.memory.getMode() === MemoryMode.PAGED) this.memory.pagingManager.deallocateProcessPages(pid); else this.memory.deallocate(pid) }
  setStrategy(strategy: AllocationStrategyType): void { this.memory.setAllocationStrategy(strategy) }
  getSnapshot() { return { memory: this.memory.getMemorySnapshot(), paging: this.memory.getPagingSnapshot(), processes: this.processes.getAllProcesses(), events: this.events.getAll().slice(-200) } }
}
export function createReplacementLab(frames = 3): PageManager {
  integer(frames, 'Frame count', 1, 32)
  const manager = new PageManager({ events: new EventSystem(), getCurrentTick: () => 0, isPagedMode: () => true, totalMemory: frames * 64, pageSize: 64 })
  manager.setReferenceString([1, 2, 3, 1, 4, 1, 2, 5])
  return manager
}
export function translationPreset(): MemoryLaboratory {
  const lab = new MemoryLaboratory(8192, 1024, MemoryMode.PAGED)
  lab.allocate(lab.create(3072))
  lab.allocate(lab.create(3072))
  return lab
}
