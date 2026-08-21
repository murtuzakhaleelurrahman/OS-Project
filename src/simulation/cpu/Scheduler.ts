import type { Process } from '../process/Process'

export const SchedulerAlgorithm = {
  FCFS: 'FCFS',
  SJF: 'SJF',
  PRIORITY: 'PRIORITY',
  ROUND_ROBIN: 'ROUND_ROBIN',
} as const
export type SchedulerAlgorithm = (typeof SchedulerAlgorithm)[keyof typeof SchedulerAlgorithm]

export interface Scheduler {
  readonly algorithm: SchedulerAlgorithm
  selectNextProcess(processes: readonly Process[], currentTick: number): Process | undefined
  onProcessEnqueued?(process: Process): void
  onProcessDispatched?(process: Process): void
  onProcessPreempted?(process: Process): void
}

export function compareArrivalAndPid(left: Process, right: Process): number {
  return left.arrivalTime - right.arrivalTime || left.pid.localeCompare(right.pid, undefined, { numeric: true })
}