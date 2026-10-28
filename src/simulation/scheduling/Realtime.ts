import { integer } from '../shared/validation'
import { appendSegment, identifier, record, rows, type ScheduleSegment } from './Inputs'

export interface PeriodicTask { id: string; execution: number; period: number; deadline: number; offset: number }
export interface RealtimeScenario { name: string; policy: 'EDF' | 'RM'; horizon: number; tasks: PeriodicTask[] }
export interface PeriodicJob { id: string; task: string; release: number; deadline: number; period: number; execution: number; remaining: number; waiting: number; firstStart?: number; completion?: number; missed: boolean }
export const realtimePreset: RealtimeScenario = { name: 'EDF versus rate monotonic', policy: 'EDF', horizon: 35,
  tasks: [{ id: 'A', execution: 2, period: 5, deadline: 5, offset: 0 }, { id: 'B', execution: 4, period: 7, deadline: 7, offset: 0 }],
}
export const feasibleRealtime: RealtimeScenario = { ...realtimePreset, name: 'Feasible periodic workload', horizon: 20,
  tasks: [{ id: 'A', execution: 1, period: 4, deadline: 4, offset: 0 }, { id: 'B', execution: 2, period: 5, deadline: 5, offset: 0 }],
}
export const overloadedRealtime: RealtimeScenario = { ...realtimePreset, name: 'Overload and unfinished deadlines', horizon: 15,
  tasks: [{ id: 'A', execution: 3, period: 4, deadline: 4, offset: 0 }, { id: 'B', execution: 3, period: 5, deadline: 5, offset: 0 }],
}
export function parseRealtime(input: unknown): RealtimeScenario {
  const value = record(input), seen = new Set<string>()
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Scenario name must contain 1–100 characters')
  if (!['EDF', 'RM'].includes(value.policy as string)) throw new Error('Unknown real-time policy')
  return { name: value.name, policy: value.policy as RealtimeScenario['policy'], horizon: integer(value.horizon, 'Horizon', 1, 500), tasks: rows(value.tasks, 16).map((item) => {
    const task = record(item), period = integer(task.period, 'Task period', 1, 100)
    return { id: identifier(task.id, seen), execution: integer(task.execution, 'Execution budget', 1, 100), period, deadline: integer(task.deadline, 'Relative deadline', 1, period), offset: integer(task.offset, 'Release offset', 0, 2000) }
  }) }
}

export function utilizationBounds(input: unknown) {
  const scenario = parseRealtime(input), n = scenario.tasks.length
  const utilization = scenario.tasks.reduce((sum, task) => sum + task.execution / task.period, 0)
  const applicable = n > 0 && scenario.tasks.every((task) => task.deadline === task.period && task.offset === 0)
  const rmBound = n ? n * (2 ** (1 / n) - 1) : null
  return { utilization, applicable, rmBound, rmSufficient: applicable ? utilization <= rmBound! + 1e-12 : null, edfFeasible: applicable ? utilization <= 1 + 1e-12 : null }
}

export class Realtime {
  readonly scenario: RealtimeScenario
  private time = 0
  private jobs: PeriodicJob[] = []
  private busy = 0
  private idle = 0
  private limited = false
  private segments: ScheduleSegment[] = []
  private trace: { time: number; message: string }[] = []
  private previous: string | undefined
  constructor(input: unknown = realtimePreset) { this.scenario = parseRealtime(input); this.release() }
  private log(message: string): void { this.trace.push({ time: this.time, message }); if (this.trace.length > 500) this.trace.shift() }
  private release(): void {
    if (this.time >= this.scenario.horizon) return
    const due = this.scenario.tasks.filter((task) => this.time >= task.offset && (this.time - task.offset) % task.period === 0)
    if (this.jobs.length + due.length > 4000) { this.limited = true; this.log('Stopped before this release batch: the 4000-job limit was reached.'); return }
    for (const task of due) {
      const id = `${task.id}#${(this.time - task.offset) / task.period + 1}`
      this.jobs.push({ id, task: task.id, release: this.time, deadline: this.time + task.deadline, period: task.period, execution: task.execution, remaining: task.execution, waiting: 0, missed: false })
      this.log(`Release ${id}; absolute deadline ${this.time + task.deadline}.`)
    }
  }
  next(): boolean {
    if (this.limited || this.time >= this.scenario.horizon) return false
    const ready = this.jobs.filter((job) => job.completion === undefined)
    ready.sort((a, b) => this.scenario.policy === 'EDF'
      ? a.deadline - b.deadline || a.release - b.release || a.task.localeCompare(b.task, undefined, { numeric: true }) || a.id.localeCompare(b.id)
      : a.period - b.period || a.task.localeCompare(b.task, undefined, { numeric: true }) || a.release - b.release)
    const runner = ready[0]
    if (runner) {
      runner.firstStart ??= this.time; runner.remaining--; this.busy++
      for (const job of ready) if (job !== runner) job.waiting++
      if (this.previous !== runner.id) this.log(`${this.scenario.policy} dispatches ${runner.id}.`)
      appendSegment(this.segments, runner.id, this.time)
    } else { this.idle++; appendSegment(this.segments, 'IDLE', this.time) }
    this.previous = runner?.id
    this.time++
    // Completing exactly at the deadline is on time; deadlines at H are observed.
    if (runner?.remaining === 0) { runner.completion = this.time; this.log(`${runner.id} completes.`) }
    for (const job of this.jobs) if (job.completion === undefined && !job.missed && job.deadline <= this.time) { job.missed = true; this.log(`${job.id} MISSES deadline ${job.deadline}; remaining ${job.remaining}.`) }
    this.release()
    return true
  }
  runAll(): void { while (this.next()) { /* releases stop at the exclusive horizon; overdue jobs are retained */ } }
  snapshot() {
    return structuredClone({ time: this.time, status: this.limited ? 'limit' : this.time >= this.scenario.horizon ? 'complete' : 'ready', jobs: this.jobs,
      busy: this.busy, idle: this.idle, segments: this.segments, trace: this.trace,
      misses: this.jobs.filter((job) => job.missed).length, completed: this.jobs.filter((job) => job.completion !== undefined).length,
      onTime: this.jobs.filter((job) => job.completion !== undefined && !job.missed).length,
      pendingDeadlines: this.jobs.filter((job) => job.completion === undefined && job.deadline > this.time).length,
      utilization: this.time ? this.busy / this.time * 100 : null })
  }
}
export function compareRealtime(input: unknown) {
  const scenario = parseRealtime(input)
  return (['EDF', 'RM'] as const).map((policy) => {
    const lab = new Realtime({ ...scenario, policy }); lab.runAll(); const result = lab.snapshot()
    return { policy, status: result.status, elapsed: result.time, releases: result.jobs.length, completed: result.completed, onTime: result.onTime, misses: result.misses, pendingDeadlines: result.pendingDeadlines, utilization: result.utilization }
  })
}
