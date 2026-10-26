import { EventSystem, type SimulationEvent } from '../events/EventSystem'
import { CPU, type CpuSnapshot } from '../cpu/CPU'
import { createScheduler } from '../cpu/Schedulers'
import type { SchedulerAlgorithm } from '../cpu/Scheduler'
import { ProcessManager } from '../process/ProcessManager'
import type { Process } from '../process/Process'
import { MemoryManager } from '../memory/MemoryManager'
import type { MemorySnapshot } from '../memory/Memory'
import type { PagingSnapshot } from '../memory/PageManager'
import { SimulationClock } from './SimulationClock'
import { DiskManager, type DiskSnapshot } from '../disk/DiskManager'
import { SynchronizationManager, type SynchronizationSnapshot } from '../synchronization/SynchronizationManager'

export interface SimulationSnapshot {
  readonly tick: number
  readonly running: boolean
  readonly events: readonly SimulationEvent[]
  readonly processes: readonly Process[]
  readonly processCount: number
  readonly activeProcessCount: number
  readonly readyProcessCount: number
  readonly blockedProcessCount: number
  readonly terminatedProcessCount: number
  readonly runningProcess: Process | undefined
  readonly readyQueue: readonly Process[]
  readonly cpu: CpuSnapshot
  readonly memory: MemorySnapshot
  readonly paging: PagingSnapshot
  readonly disk: DiskSnapshot
  readonly synchronization: SynchronizationSnapshot
}

export interface TickableSimulationModule {
  onTick(tickNumber: number): void
}

export class SimulationEngine {
  readonly events: EventSystem
  readonly clock: SimulationClock
  readonly processManager: ProcessManager
  readonly cpuController: CPU
  readonly memoryManager: MemoryManager
  readonly diskManager: DiskManager
  readonly synchronizationManager: SynchronizationManager
  private readonly listeners = new Set<() => void>()
  private readonly tickableModules = new Set<TickableSimulationModule>()
  private cachedSnapshot: SimulationSnapshot | undefined

  constructor(tickDurationMs = 1000, initialTick = 0) {
    this.events = new EventSystem()
    this.clock = new SimulationClock({
      tickDurationMs,
      initialTick,
      onTick: (tick) => {
        this.events.emit({
          tick,
          type: 'CLOCK_TICKED',
          message: `Logical clock advanced to tick ${tick}`,
        })
        this.tickableModules.forEach((module) => module.onTick(tick))
        this.notify()
      },
    })
    this.processManager = new ProcessManager({
      events: this.events,
      getCurrentTick: () => this.clock.tickNumber,
      onChange: () => this.notify(),
    })
    this.cpuController = new CPU({
      processManager: this.processManager,
      events: this.events,
      getCurrentTick: () => this.clock.tickNumber,
    }, createScheduler('FCFS'))
    this.tickableModules.add(this.cpuController)
    this.memoryManager = new MemoryManager({
      events: this.events,
      getCurrentTick: () => this.clock.tickNumber,
      getProcess: (pid) => this.processManager.getProcess(pid),
      onChange: () => this.notify(),
    })
    this.diskManager = new DiskManager({
      events: this.events,
      getCurrentTick: () => this.clock.tickNumber,
      onChange: () => this.notify(),
    })
    this.tickableModules.add(this.diskManager)
    this.synchronizationManager = new SynchronizationManager({
      processManager: this.processManager,
      events: this.events,
      getCurrentTick: () => this.clock.tickNumber,
      onChange: () => this.notify(),
    })
    this.tickableModules.add(this.synchronizationManager)
  }

  start(): void {
    this.clock.start()
    this.events.emit({
      tick: this.clock.tickNumber,
      type: 'CLOCK_STARTED',
      message: 'Simulation started',
    })
    this.notify()
  }

  pause(): void {
    this.clock.pause()
    this.events.emit({
      tick: this.clock.tickNumber,
      type: 'CLOCK_PAUSED',
      message: 'Simulation paused',
    })
    this.notify()
  }

  step(): void {
    this.clock.step()
  }

  tick(): void {
    this.clock.tick()
  }

  fastForward(ticks: number): void {
    this.clock.fastForward(ticks)
    this.events.emit({
      tick: this.clock.tickNumber,
      type: 'CLOCK_FAST_FORWARDED',
      message: `Fast-forwarded simulation by ${ticks} tick${ticks === 1 ? '' : 's'}`,
    })
    this.notify()
  }

  setScheduler(algorithm: SchedulerAlgorithm, quantum = 2): void {
    this.cpuController.setScheduler(createScheduler(algorithm, quantum))
    this.notify()
  }

  reset(): void {
    this.clock.reset()
    this.cpuController.reset()
    this.processManager.reset()
    this.diskManager.reset()
    this.events.clear()
    this.events.emit({ tick: this.clock.tickNumber, type: 'CLOCK_RESET', message: 'Simulation reset' })
    this.memoryManager.reset()
    this.synchronizationManager.reset(false)
    this.notify()
  }

  getSnapshot(): SimulationSnapshot {
    if (this.cachedSnapshot === undefined) {
      this.cachedSnapshot = {
        tick: this.clock.tickNumber,
        running: this.clock.isRunning,
        events: this.events.getAll(),
        processes: this.processManager.getAllProcesses(),
        processCount: this.processManager.getAllProcesses().length,
        activeProcessCount: this.processManager.getActiveProcesses().length,
        readyProcessCount: this.processManager.getReadyQueue().length,
        blockedProcessCount: this.processManager.getBlockedQueue().length,
        terminatedProcessCount: this.processManager.getTerminatedProcesses().length,
        runningProcess: this.processManager.getRunningProcess(),
        readyQueue: this.processManager.getReadyQueue(),
        cpu: this.cpuController.getSnapshot(),
        memory: this.memoryManager.getMemorySnapshot(),
        paging: this.memoryManager.getPagingSnapshot(),
        disk: this.diskManager.getSnapshot(),
        synchronization: this.synchronizationManager.getSnapshot(),
      }
    }
    return this.cachedSnapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  registerTickable(module: TickableSimulationModule): () => void {
    this.tickableModules.add(module)
    return () => this.tickableModules.delete(module)
  }

  dispose(): void {
    this.clock.pause()
    this.tickableModules.clear()
    this.listeners.clear()
  }

  private notify(): void {
    this.cachedSnapshot = undefined
    this.listeners.forEach((listener) => listener())
  }
}
