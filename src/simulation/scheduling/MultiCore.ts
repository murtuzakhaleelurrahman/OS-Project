import { integer } from '../shared/validation'
import { compareCpuCandidates } from '../shared/CpuPolicy'
import { appendSegment, identifier, record, rows, type ScheduleSegment } from './Inputs'

export const multiCorePolicies = ['FCFS', 'ROUND_ROBIN', 'SRTF', 'PREEMPTIVE_PRIORITY'] as const
export interface MultiTask { id: string; arrival: number; burst: number; priority: number; initialCore?: number }
export interface MultiScenario {
  name: string; cores: number; policy: typeof multiCorePolicies[number]; quantum: number
  balancing: 'OFF' | 'STEAL'; balanceInterval: number; switchCost: number; migrationCost: number; maxTicks: number; tasks: MultiTask[]
}
interface TaskRuntime extends MultiTask {
  state: 'NEW' | 'READY' | 'DISPATCHING' | 'RUNNING' | 'TERMINATED'; remaining: number; executed: number; waiting: number
  readySince: number; order: number; core?: number; lastCore?: number; migrations: number; firstStart?: number; completion?: number
}
interface Core {
  id: number; ready: string[]; running?: string; target?: string; switchLeft: number; quantumUsed: number
  previous?: string; previousEnd: number; busy: number; idle: number; overhead: number; segments: ScheduleSegment[]
}
export const balancePreset: MultiScenario = {
  name: 'Four jobs, one crowded queue', cores: 2, policy: 'FCFS', quantum: 2, balancing: 'STEAL', balanceInterval: 1,
  switchCost: 0, migrationCost: 0, maxTicks: 200,
  tasks: Array.from({ length: 4 }, (_, index) => ({ id: `P${index + 1}`, arrival: 0, burst: 8, priority: index, initialCore: 0 })),
}
export const migrationPreset: MultiScenario = { ...balancePreset, name: 'Round Robin migration cost', policy: 'ROUND_ROBIN', migrationCost: 2,
  tasks: [{ id: 'P1', arrival: 0, burst: 2, priority: 0, initialCore: 0 }, { id: 'P2', arrival: 0, burst: 8, priority: 0, initialCore: 0 }, { id: 'P3', arrival: 1, burst: 2, priority: 0, initialCore: 1 }],
}

export function parseMultiScenario(input: unknown): MultiScenario {
  const value = record(input), seen = new Set<string>()
  const cores = integer(value.cores, 'Cores', 1, 8)
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Scenario name must contain 1–100 characters')
  if (!multiCorePolicies.includes(value.policy as MultiScenario['policy']) || !['OFF', 'STEAL'].includes(value.balancing as string)) throw new Error('Unknown multicore policy or balancing mode')
  return {
    name: value.name, cores, policy: value.policy as MultiScenario['policy'], balancing: value.balancing as MultiScenario['balancing'],
    quantum: integer(value.quantum, 'Quantum', 1, 100), balanceInterval: integer(value.balanceInterval, 'Balance interval', 1, 50),
    switchCost: integer(value.switchCost, 'Switch cost', 0, 20), migrationCost: integer(value.migrationCost, 'Migration cost', 0, 20), maxTicks: integer(value.maxTicks, 'Tick limit', 1, 2000),
    tasks: rows(value.tasks, 64).map((item) => {
      const task = record(item)
      return { id: identifier(task.id, seen), arrival: integer(task.arrival, 'Arrival', 0, 2000), burst: integer(task.burst, 'CPU burst', 1, 1000), priority: integer(task.priority, 'Priority', 0, 1000),
        ...(task.initialCore === undefined ? {} : { initialCore: integer(task.initialCore, 'Initial core', 0, cores - 1) }) }
    }),
  }
}

export class MultiCore {
  readonly scenario: MultiScenario
  private tasks: TaskRuntime[]
  private cores: Core[]
  private time = 0
  private order = 0
  private transfers = 0
  private trace: { time: number; message: string }[] = []
  constructor(input: unknown = balancePreset) {
    this.scenario = parseMultiScenario(input)
    this.tasks = this.scenario.tasks.map((task) => ({ ...task, state: 'NEW', remaining: task.burst, executed: 0, waiting: 0, readySince: 0, order: 0, migrations: 0 }))
    this.cores = Array.from({ length: this.scenario.cores }, (_, id) => ({ id, ready: [], switchLeft: 0, quantumUsed: 0, previousEnd: -1, busy: 0, idle: 0, overhead: 0, segments: [] }))
    this.boundary()
  }
  private task(id: string): TaskRuntime { return this.tasks.find((task) => task.id === id)! }
  private log(message: string): void { this.trace.push({ time: this.time, message }); if (this.trace.length > 500) this.trace.shift() }
  private ready(task: TaskRuntime, core: Core): void {
    task.state = 'READY'; task.core = core.id; task.readySince = this.time; task.order = this.order++; core.ready.push(task.id)
  }
  private candidate(task: TaskRuntime) { return { id: task.id, readySince: task.readySince, order: task.order, work: task.remaining, priority: task.priority, level: 0 } }
  private select(core: Core): TaskRuntime | undefined {
    return core.ready.map((id) => this.task(id)).sort((a, b) => compareCpuCandidates(this.candidate(a), this.candidate(b), this.scenario.policy))[0]
  }
  private release(core: Core): TaskRuntime {
    const task = this.task(core.running!)
    core.previous = task.id; core.previousEnd = this.time; core.running = undefined
    return task
  }
  private start(core: Core, task: TaskRuntime): void { task.state = 'RUNNING'; task.core = core.id; core.running = task.id; core.target = undefined; core.quantumUsed = 0 }
  private dispatch(core: Core): void {
    if (core.running || core.target) return
    const task = this.select(core)
    if (!task) return
    core.ready = core.ready.filter((id) => id !== task.id)
    const cost = (core.previousEnd === this.time && core.previous !== task.id ? this.scenario.switchCost : 0)
      + (task.lastCore !== undefined && task.lastCore !== core.id ? this.scenario.migrationCost : 0)
    task.core = core.id
    if (cost) { core.target = task.id; core.switchLeft = cost; task.state = 'DISPATCHING' }
    else this.start(core, task)
    this.log(`C${core.id} dispatches ${task.id}${cost ? ` after ${cost} overhead ticks` : ''}.`)
  }
  private load(core: Core): number { return core.ready.reduce((sum, id) => sum + this.task(id).remaining, 0) + (core.running ? this.task(core.running).remaining : core.target ? this.task(core.target).remaining : 0) }
  private boundary(): void {
    // Completion precedes admission, RR expiry and dispatch at the same boundary.
    for (const core of this.cores) {
      if (core.running && this.task(core.running).remaining === 0) {
        const task = this.release(core); task.state = 'TERMINATED'; task.core = undefined; task.completion = this.time; this.log(`${task.id} completes on C${core.id}.`)
      }
      if (core.target && core.switchLeft === 0) this.start(core, this.task(core.target))
    }
    if (this.time >= this.scenario.maxTicks) return
    for (const task of this.tasks.filter((candidate) => candidate.state === 'NEW' && candidate.arrival === this.time)) {
      const core = task.initialCore === undefined ? [...this.cores].sort((a, b) => this.load(a) - this.load(b) || a.id - b.id)[0] : this.cores[task.initialCore]
      this.ready(task, core); this.log(`${task.id} arrives in Q${core.id}.`)
    }
    for (const core of this.cores) {
      if (core.running && this.scenario.policy === 'ROUND_ROBIN' && core.quantumUsed >= this.scenario.quantum) { const task = this.release(core); this.ready(task, core); this.log(`${task.id} exhausts its quantum.`) }
      const better = this.select(core)
      if (core.running && better) {
        const running = this.task(core.running)
        if (this.scenario.policy === 'SRTF' && better.remaining < running.remaining || this.scenario.policy === 'PREEMPTIVE_PRIORITY' && better.priority < running.priority) { this.ready(this.release(core), core); this.log(`${better.id} preempts C${core.id}.`) }
      }
      this.dispatch(core)
    }
    if (this.scenario.balancing === 'STEAL' && this.time % this.scenario.balanceInterval === 0) {
      for (const core of this.cores.filter((candidate) => !candidate.running && !candidate.target)) {
        const donor = this.cores.filter((candidate) => candidate.id !== core.id && candidate.ready.length).sort((a, b) => this.load(b) - this.load(a) || a.id - b.id)[0]
        if (!donor) continue
        const task = donor.ready.map((id) => this.task(id)).sort((a, b) => b.remaining - a.remaining || a.order - b.order || a.id.localeCompare(b.id))[0]
        donor.ready = donor.ready.filter((id) => id !== task.id)
        // Preserve READY age/FIFO order when transferring a waiting task.
        core.ready.push(task.id); task.core = core.id; this.transfers++
        this.log(`Q${donor.id} → Q${core.id}: transfers ${task.id}; running tasks stay on their cores.`)
        this.dispatch(core)
      }
    }
  }
  next(): boolean {
    if (this.tasks.every((task) => task.state === 'TERMINATED') || this.time >= this.scenario.maxTicks) return false
    for (const task of this.tasks) if (task.state === 'READY' || task.state === 'DISPATCHING') task.waiting++
    for (const core of this.cores) {
      if (core.running) {
        const task = this.task(core.running)
        if (task.lastCore !== undefined && task.lastCore !== core.id) task.migrations++
        task.lastCore = core.id; task.firstStart ??= this.time
        task.executed++; task.remaining--; core.busy++; core.quantumUsed++
        appendSegment(core.segments, task.id, this.time)
      } else if (core.target) { core.switchLeft--; core.overhead++; appendSegment(core.segments, 'SWITCH', this.time) }
      else { core.idle++; appendSegment(core.segments, 'IDLE', this.time) }
    }
    this.time++; this.boundary(); return true
  }
  runAll(): void { while (this.next()) { /* one common integer clock for all cores */ } }
  snapshot() {
    const complete = this.tasks.every((task) => task.state === 'TERMINATED')
    return structuredClone({ time: this.time, status: complete ? 'complete' : this.time >= this.scenario.maxTicks ? 'limit' : 'ready', tasks: this.tasks, cores: this.cores, transfers: this.transfers,
      migrations: this.tasks.reduce((sum, task) => sum + task.migrations, 0), trace: this.trace,
      utilization: this.time ? this.cores.reduce((sum, core) => sum + core.busy, 0) / (this.time * this.cores.length) * 100 : null,
      averageWaiting: complete && this.tasks.length ? this.tasks.reduce((sum, task) => sum + task.waiting, 0) / this.tasks.length : null })
  }
}

export function compareBalancing(input: unknown) {
  const scenario = parseMultiScenario(input)
  return (['OFF', 'STEAL'] as const).map((balancing) => {
    const lab = new MultiCore({ ...scenario, balancing }); lab.runAll(); const snapshot = lab.snapshot()
    return { balancing, status: snapshot.status, elapsed: snapshot.time, utilization: snapshot.utilization, averageWaiting: snapshot.averageWaiting, transfers: snapshot.transfers, migrations: snapshot.migrations }
  })
}
