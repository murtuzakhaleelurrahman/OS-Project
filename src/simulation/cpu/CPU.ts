import { EventSystem } from '../events/EventSystem'
import { ProcessManager } from '../process/ProcessManager'
import { ProcessState, type Process } from '../process/Process'
import { RoundRobinScheduler } from './Schedulers'
import type { Scheduler, SchedulerAlgorithm } from './Scheduler'

export interface ExecutionSegment {
  readonly pid: string | 'IDLE'
  readonly startTick: number
  readonly endTick: number
}

export interface ProcessMetrics {
  readonly pid: string
  readonly completionTime?: number
  readonly firstStartTime?: number
  readonly turnaroundTime?: number
  readonly waitingTime?: number
  readonly responseTime?: number
}

export interface CpuSnapshot {
  readonly algorithm: SchedulerAlgorithm
  readonly timeQuantum?: number
  readonly runningProcess: Process | undefined
  readonly busy: boolean
  readonly busyTicks: number
  readonly idleTicks: number
  readonly contextSwitches: number
  readonly utilization: number
  readonly throughput: number
  readonly executionSegments: readonly ExecutionSegment[]
  readonly metrics: readonly ProcessMetrics[]
}

export interface CpuOptions {
  readonly processManager: ProcessManager
  readonly events: EventSystem
  readonly getCurrentTick: () => number
}

export class CPU {
  private readonly processManager: ProcessManager
  private readonly events: EventSystem
  private readonly getCurrentTick: () => number
  private scheduler: Scheduler
  private runningPid: string | undefined
  private previousPid: string | undefined
  private busyTicks = 0
  private idleTicks = 0
  private contextSwitches = 0
  private readonly segments: ExecutionSegment[] = []

  constructor(options: CpuOptions, scheduler: Scheduler) {
    this.processManager = options.processManager
    this.events = options.events
    this.getCurrentTick = options.getCurrentTick
    this.scheduler = scheduler
  }

  get algorithm(): SchedulerAlgorithm { return this.scheduler.algorithm }
  get timeQuantum(): number | undefined { return this.scheduler instanceof RoundRobinScheduler ? this.scheduler.timeQuantum : undefined }

  setScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler
    this.runningPid = undefined
    if (scheduler instanceof RoundRobinScheduler) scheduler.reset()
  }

  onTick(tick: number): void {
    this.processManager.admitArrivals(tick)
    if (this.runningPid === undefined) this.dispatch(tick)
    if (this.runningPid === undefined) {
      this.idleTicks += 1
      this.appendSegment({ pid: 'IDLE', startTick: tick - 1, endTick: tick })
      this.events.emit({ tick, type: 'CPU_IDLE', message: 'CPU is idle' })
      return
    }

    const pid = this.runningPid
    const before = this.processManager.getProcess(pid)
    if (before === undefined) return
    const after = this.processManager.executeProcessTick(pid, tick - 1)
    this.busyTicks += 1
    this.appendSegment({ pid, startTick: tick - 1, endTick: tick })

    if (after.remainingTime === 0) {
      this.processManager.terminateProcess(pid)
      this.processManager.recordCompletion(pid, tick)
      this.events.emit({ tick, type: 'PROCESS_COMPLETED', processId: pid, message: `${pid} completed` })
      this.runningPid = undefined
      return
    }

    if (this.scheduler instanceof RoundRobinScheduler) {
      this.scheduler.recordTick()
      if (this.scheduler.quantumUsed >= this.scheduler.timeQuantum) {
        this.processManager.transitionProcess(pid, ProcessState.READY)
        this.events.emit({ tick, type: 'QUANTUM_EXPIRED', processId: pid, message: `${pid} quantum expired` })
        this.events.emit({ tick, type: 'PROCESS_PREEMPTED', processId: pid, message: `${pid} returned to READY` })
        this.scheduler.onProcessPreempted(after)
        this.runningPid = undefined
      }
    }
  }

  getSnapshot(): CpuSnapshot {
    const tick = this.getCurrentTick()
    const processes = this.processManager.getAllProcesses()
    const elapsedTicks = Math.max(0, tick)
    const completed = processes.filter((process) => process.state === ProcessState.TERMINATED).length
    return {
      algorithm: this.scheduler.algorithm,
      timeQuantum: this.timeQuantum,
      runningProcess: this.runningPid === undefined ? undefined : this.processManager.getProcess(this.runningPid),
      busy: this.runningPid !== undefined,
      busyTicks: this.busyTicks,
      idleTicks: this.idleTicks,
      contextSwitches: this.contextSwitches,
      utilization: elapsedTicks === 0 ? 0 : (this.busyTicks / elapsedTicks) * 100,
      throughput: elapsedTicks === 0 ? 0 : completed / elapsedTicks,
      executionSegments: this.coalesceSegments(),
      metrics: processes.map((process) => ({
        pid: process.pid,
        completionTime: process.completionTime,
        firstStartTime: process.firstStartTime,
        turnaroundTime: process.completionTime === undefined ? undefined : process.completionTime - process.arrivalTime,
        waitingTime: process.completionTime === undefined ? undefined : process.completionTime - process.arrivalTime - process.burstTime,
        responseTime: process.firstStartTime === undefined ? undefined : process.firstStartTime - process.arrivalTime,
      })),
    }
  }

  reset(): void {
    this.runningPid = undefined
    this.previousPid = undefined
    this.busyTicks = 0
    this.idleTicks = 0
    this.contextSwitches = 0
    this.segments.length = 0
    if (this.scheduler instanceof RoundRobinScheduler) this.scheduler.reset()
  }

  private dispatch(tick: number): void {
    const process = this.scheduler.selectNextProcess(this.processManager.getReadyQueue(), tick)
    if (process === undefined) return
    if (this.previousPid !== undefined && this.previousPid !== process.pid) {
      this.contextSwitches += 1
      this.events.emit({ tick, type: 'CONTEXT_SWITCH', processId: process.pid, message: `Context switch: ${this.previousPid} -> ${process.pid}` })
    }
    this.processManager.transitionProcess(process.pid, ProcessState.RUNNING)
    this.scheduler.onProcessDispatched?.(process)
    this.runningPid = process.pid
    this.previousPid = process.pid
    this.events.emit({ tick, type: 'PROCESS_SELECTED', processId: process.pid, message: `Scheduler selected ${process.pid} using ${this.scheduler.algorithm}` })
    this.events.emit({ tick, type: 'PROCESS_STARTED', processId: process.pid, message: `CPU started ${process.pid}` })
    this.events.emit({ tick, type: 'CPU_BECAME_BUSY', processId: process.pid, message: `CPU became busy with ${process.pid}` })
  }

  private appendSegment(segment: ExecutionSegment): void {
    const last = this.segments[this.segments.length - 1]
    if (last !== undefined && last.pid === segment.pid && last.endTick === segment.startTick) {
      this.segments[this.segments.length - 1] = { ...last, endTick: segment.endTick }
    } else this.segments.push(segment)
  }

  private coalesceSegments(): readonly ExecutionSegment[] {
    return this.segments.map((segment) => ({ ...segment }))
  }
}
