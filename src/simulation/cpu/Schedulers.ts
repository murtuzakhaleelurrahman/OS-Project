import type { Process } from '../process/Process'
import { SchedulerAlgorithm, type Scheduler } from './Scheduler'
import { compareCpuCandidates, type IntegratedCpuPolicy } from '../shared/CpuPolicy'

function compareLegacy(left: Process, right: Process, policy: IntegratedCpuPolicy): number {
  const candidate = (process: Process) => ({
    id: process.pid, readySince: process.arrivalTime, order: 0,
    work: process.burstTime, priority: process.priority, level: 0,
  })
  return compareCpuCandidates(candidate(left), candidate(right), policy)
}

export class FcfsScheduler implements Scheduler {
  readonly algorithm = SchedulerAlgorithm.FCFS
  selectNextProcess(processes: readonly Process[]): Process | undefined {
    return [...processes].sort((left, right) => compareLegacy(left, right, 'FCFS'))[0]
  }
}

export class SjfScheduler implements Scheduler {
  readonly algorithm = SchedulerAlgorithm.SJF
  selectNextProcess(processes: readonly Process[]): Process | undefined {
    return [...processes].sort((left, right) => compareLegacy(left, right, 'SJF'))[0]
  }
}

export class PriorityScheduler implements Scheduler {
  readonly algorithm = SchedulerAlgorithm.PRIORITY
  selectNextProcess(processes: readonly Process[]): Process | undefined {
    return [...processes].sort((left, right) => compareLegacy(left, right, 'PRIORITY'))[0]
  }
}

export class RoundRobinScheduler implements Scheduler {
  readonly algorithm = SchedulerAlgorithm.ROUND_ROBIN
  private readonly queue: string[] = []
  private quantum = 0
  private usedQuantum = 0

  constructor(quantum = 2) { this.setQuantum(quantum) }
  setQuantum(quantum: number): void {
    if (!Number.isInteger(quantum) || quantum <= 0) throw new Error('Round Robin quantum must be a positive integer')
    this.quantum = quantum
    this.usedQuantum = 0
  }
  get timeQuantum(): number { return this.quantum }
  get quantumUsed(): number { return this.usedQuantum }
  selectNextProcess(processes: readonly Process[]): Process | undefined {
    const available = new Map(processes.map((process) => [process.pid, process]))
    for (const process of processes) if (!this.queue.includes(process.pid)) this.queue.push(process.pid)
    while (this.queue.length > 0 && !available.has(this.queue[0])) this.queue.shift()
    const pid = this.queue[0]
    return pid === undefined ? undefined : available.get(pid)
  }
  onProcessDispatched(process: Process): void {
    this.usedQuantum = 0
    const index = this.queue.indexOf(process.pid)
    if (index >= 0) this.queue.splice(index, 1)
    this.queue.unshift(process.pid)
  }
  onProcessPreempted(process: Process): void {
    if (this.queue[0] === process.pid) this.queue.push(this.queue.shift() as string)
    this.usedQuantum = 0
  }
  recordTick(): void { this.usedQuantum += 1 }
  reset(): void { this.queue.length = 0; this.usedQuantum = 0 }
}

export function createScheduler(algorithm: SchedulerAlgorithm, quantum = 2): Scheduler {
  if (algorithm === SchedulerAlgorithm.SJF) return new SjfScheduler()
  if (algorithm === SchedulerAlgorithm.PRIORITY) return new PriorityScheduler()
  if (algorithm === SchedulerAlgorithm.ROUND_ROBIN) return new RoundRobinScheduler(quantum)
  return new FcfsScheduler()
}
