import { EventSystem } from '../events/EventSystem'
import {
  isValidProcessTransition,
  ProcessState,
  type Process,
  type ProcessConfiguration,
} from './Process'

type MutableProcess = { -readonly [Key in keyof Process]: Process[Key] }

export interface ProcessManagerOptions {
  readonly events: EventSystem
  readonly getCurrentTick: () => number
  readonly onChange?: () => void
}

export class ProcessManager {
  private readonly processes = new Map<string, MutableProcess>()
  private readonly events: EventSystem
  private readonly getCurrentTick: () => number
  private readonly onChange?: () => void
  private nextPid = 1

  constructor(options: ProcessManagerOptions) {
    this.events = options.events
    this.getCurrentTick = options.getCurrentTick
    this.onChange = options.onChange
  }

  createProcess(configuration: ProcessConfiguration): Process {
    this.validateConfiguration(configuration)
    const pid = `P${this.nextPid++}`
    const process: MutableProcess = {
      pid,
      name: configuration.name.trim(),
      state: ProcessState.NEW,
      arrivalTime: configuration.arrivalTime ?? this.getCurrentTick(),
      burstTime: configuration.burstTime,
      remainingTime: configuration.burstTime,
      priority: configuration.priority,
      memoryRequirement: configuration.memoryRequirement,
      programCounter: 0,
    }
    this.processes.set(pid, process)
    this.events.emit({
      tick: this.getCurrentTick(),
      type: 'PROCESS_CREATED',
      processId: pid,
      message: `Process ${pid} created`,
    })
    this.changed()
    return this.copy(process)
  }

  getProcess(pid: string): Process | undefined {
    const process = this.processes.get(pid)
    return process === undefined ? undefined : this.copy(process)
  }

  getAllProcesses(): readonly Process[] {
    return [...this.processes.values()].map((process) => this.copy(process))
  }

  getProcessesByState(state: ProcessState): readonly Process[] {
    return this.getAllProcesses().filter((process) => process.state === state)
  }

  getReadyQueue(): readonly Process[] {
    return this.getProcessesByState(ProcessState.READY)
  }

  getBlockedQueue(): readonly Process[] {
    return this.getProcessesByState(ProcessState.BLOCKED)
  }

  getRunningProcess(): Process | undefined {
    return this.getProcessesByState(ProcessState.RUNNING)[0]
  }

  getTerminatedProcesses(): readonly Process[] {
    return this.getProcessesByState(ProcessState.TERMINATED)
  }

  getActiveProcesses(): readonly Process[] {
    return this.getAllProcesses().filter((process) => process.state !== ProcessState.TERMINATED)
  }

  transitionProcess(pid: string, nextState: ProcessState): Process {
    const process = this.requireProcess(pid)
    if (!isValidProcessTransition(process.state, nextState)) {
      this.events.emit({
        tick: this.getCurrentTick(),
        type: 'PROCESS_OPERATION_REJECTED',
        processId: pid,
        message: `Invalid transition for ${pid}: ${process.state} -> ${nextState}`,
      })
      throw new Error(`Invalid process state transition: ${process.state} -> ${nextState}`)
    }
    const previousState = process.state
    process.state = nextState
    const eventType = nextState === ProcessState.TERMINATED
      ? 'PROCESS_TERMINATED'
      : 'PROCESS_STATE_CHANGED'
    this.events.emit({
      tick: this.getCurrentTick(),
      type: eventType,
      processId: pid,
      message: nextState === ProcessState.TERMINATED
        ? `Process ${pid} terminated`
        : `${pid}: ${previousState} -> ${nextState}`,
    })
    this.changed()
    return this.copy(process)
  }

  terminateProcess(pid: string): Process {
    return this.transitionProcess(pid, ProcessState.TERMINATED)
  }

  admitArrivals(currentTick: number): readonly Process[] {
    const admitted: Process[] = []
    for (const process of this.processes.values()) {
      if (process.state === ProcessState.NEW && process.arrivalTime <= currentTick) {
        this.transitionProcess(process.pid, ProcessState.READY)
        this.events.emit({ tick: currentTick, type: 'PROCESS_ARRIVED', processId: process.pid, message: `${process.pid} arrived and entered READY` })
        admitted.push(this.copy(process))
      }
    }
    return admitted
  }

  executeProcessTick(pid: string, tick: number): Process {
    const process = this.requireProcess(pid)
    if (process.state !== ProcessState.RUNNING) throw new Error(`Process ${pid} is not RUNNING`)
    if (process.remainingTime > 0) process.remainingTime -= 1
    process.programCounter += 1
    if (process.firstStartTime === undefined) process.firstStartTime = tick
    return this.copy(process)
  }

  recordCompletion(pid: string, tick: number): Process {
    const process = this.requireProcess(pid)
    process.completionTime = tick
    return this.copy(process)
  }

  reset(): void {
    this.processes.clear()
    this.nextPid = 1
    this.changed()
  }

  private requireProcess(pid: string): MutableProcess {
    const process = this.processes.get(pid)
    if (process === undefined) throw new Error(`Process not found: ${pid}`)
    return process
  }

  private validateConfiguration(configuration: ProcessConfiguration): void {
    if (configuration.name.trim().length === 0) throw new Error('Process name is required')
    if (!Number.isInteger(configuration.burstTime) || configuration.burstTime <= 0) {
      throw new Error('Burst time must be a positive integer')
    }
    if (!Number.isFinite(configuration.arrivalTime ?? 0) || (configuration.arrivalTime ?? 0) < 0) {
      throw new Error('Arrival time must be a non-negative number')
    }
    if (!Number.isFinite(configuration.priority)) throw new Error('Priority must be a number')
    if (!Number.isFinite(configuration.memoryRequirement) || configuration.memoryRequirement < 0) {
      throw new Error('Memory requirement must be a non-negative number')
    }
  }

  private copy(process: MutableProcess): Process {
    return { ...process }
  }

  private changed(): void {
    this.onChange?.()
  }
}