import { EventQueue, Phase } from './EventQueue'
import { parseScenario, type Scenario, type ScenarioProcess } from './Scenario'

export type RuntimeState = 'NEW' | 'READY' | 'RUNNING' | 'BLOCKED' | 'TERMINATED'
export interface RuntimeProcess extends ScenarioProcess {
  state: RuntimeState
  burstIndex: number
  remaining: number
  readySince: number
  readySequence: number
  waiting: number
  blocked: number
  firstStart?: number
  completion?: number
}
export interface TraceEntry { readonly sequence: number; readonly time: number; readonly phase: number; readonly type: string; readonly pid?: string; readonly message: string }
export interface Segment { readonly pid: string; readonly start: number; readonly end: number }
interface Action { kind: 'ARRIVAL' | 'CPU_COMPLETE' | 'QUANTUM' | 'DISPATCH'; pid?: string; token?: number }
export interface IntegratedSnapshot {
  readonly time: number
  readonly playing: boolean
  readonly status: 'ready' | 'paused' | 'complete' | 'limit'
  readonly processes: readonly RuntimeProcess[]
  readonly ready: readonly string[]
  readonly running?: string
  readonly segments: readonly Segment[]
  readonly trace: readonly TraceEntry[]
  readonly processedEvents: number
  readonly retainedEvents: number
  readonly nextEventTime?: number
  readonly busyTicks: number
  readonly idleTicks: number
  readonly contextSwitches: number
  readonly utilization: number | null
  readonly throughput: number | null
}

/** Independent integrated model. Laboratories never mutate this run. */
export class IntegratedEngine {
  readonly scenario: Scenario
  private readonly queue = new EventQueue<Action>()
  private processes: RuntimeProcess[] = []
  private time = 0
  private runner: string | undefined
  private segmentStart = 0
  private segments: Segment[] = []
  private trace: TraceEntry[] = []
  private processed = 0
  private readySequence = 0
  private cpuToken = 0
  private busy = 0
  private switches = 0
  private previousPid: string | undefined
  private previousEnd = -1
  private dispatchAt: number | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly listeners = new Set<() => void>()
  private cached: IntegratedSnapshot | undefined

  constructor(scenario: unknown) {
    this.scenario = parseScenario(scenario)
    if (this.scenario.processes.some((process) => process.bursts.length !== 1)) throw new Error('CPU/I/O scripts are introduced in Phase 2; use CPU-only bursts for now')
    this.initialize()
  }
  private initialize(): void {
    this.processes = this.scenario.processes.map((process) => ({ ...structuredClone(process), state: 'NEW', burstIndex: 0, remaining: process.bursts[0].kind === 'cpu' ? process.bursts[0].duration : 0, readySince: 0, readySequence: 0, waiting: 0, blocked: 0 }))
    for (const process of this.processes) this.queue.schedule(process.arrival, Phase.ARRIVAL, { kind: 'ARRIVAL', pid: process.id })
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly getSnapshot = (): IntegratedSnapshot => {
    if (!this.cached) {
      const segments = this.segments.map((segment) => ({ ...segment }))
      if (this.runner && this.time > this.segmentStart) segments.push({ pid: this.runner, start: this.segmentStart, end: this.time })
      if (!this.runner && this.time > (segments.at(-1)?.end ?? 0)) segments.push({ pid: 'IDLE', start: segments.at(-1)?.end ?? 0, end: this.time })
      this.cached = {
        time: this.time, playing: this.timer !== undefined,
        status: this.processes.every((process) => process.state === 'TERMINATED') ? 'complete' : this.processed >= this.scenario.eventLimit ? 'limit' : this.processed === 0 ? 'ready' : 'paused',
        processes: structuredClone(this.processes), ready: this.readyProcesses().map((process) => process.id), running: this.runner,
        segments, trace: [...this.trace], processedEvents: this.processed, retainedEvents: this.trace.length, nextEventTime: this.queue.nextTime,
        busyTicks: this.busy, idleTicks: this.time - this.busy, contextSwitches: this.switches,
        utilization: this.time === 0 ? null : this.busy / this.time * 100,
        throughput: this.time === 0 ? null : this.processes.filter((process) => process.state === 'TERMINATED').length / this.time,
      }
    }
    return this.cached
  }
  next(): boolean {
    if (this.processed >= this.scenario.eventLimit) { this.pause(); return false }
    const event = this.queue.pop()
    if (!event) { this.pause(); return false }
    const elapsed = event.time - this.time
    for (const process of this.processes) {
      if (process.state === 'READY') process.waiting += elapsed
      if (process.state === 'BLOCKED') process.blocked += elapsed
      if (process.state === 'RUNNING') { process.remaining -= elapsed; this.busy += elapsed }
    }
    this.time = event.time
    this.processed++
    const action = event.payload
    const process = this.processes.find((candidate) => candidate.id === action.pid)
    let message = ''
    if (action.kind === 'ARRIVAL' && process) {
      this.makeReady(process)
      message = `${process.id} arrived at ${this.time}; entered the ready queue.`
      this.requestDispatch()
    } else if ((action.kind === 'CPU_COMPLETE' || action.kind === 'QUANTUM') && process && action.token === this.cpuToken && this.runner === process.id) {
      this.segments.push({ pid: process.id, start: this.segmentStart, end: this.time })
      this.runner = undefined
      this.previousPid = process.id
      this.previousEnd = this.time
      if (action.kind === 'CPU_COMPLETE') {
        process.state = 'TERMINATED'
        process.completion = this.time
        message = `${process.id} completed its CPU burst and terminated.`
      } else {
        this.makeReady(process)
        message = `${process.id} used quantum ${this.scenario.cpu.quantum}; returned to the tail of the ready queue.`
      }
      this.requestDispatch()
    } else if (action.kind === 'DISPATCH') {
      this.dispatchAt = undefined
      if (!this.runner) {
        const selected = this.select()
        if (selected) {
          const lastEnd = this.segments.at(-1)?.end ?? 0
          if (this.time > lastEnd) this.segments.push({ pid: 'IDLE', start: lastEnd, end: this.time })
          if (this.previousEnd === this.time && this.previousPid && this.previousPid !== selected.id) this.switches++
          selected.state = 'RUNNING'
          selected.firstStart ??= this.time
          this.runner = selected.id
          this.segmentStart = this.time
          const duration = this.scenario.cpu.algorithm === 'ROUND_ROBIN' ? Math.min(this.scenario.cpu.quantum, selected.remaining) : selected.remaining
          const kind = duration === selected.remaining ? 'CPU_COMPLETE' : 'QUANTUM'
          this.queue.schedule(this.time + duration, kind === 'CPU_COMPLETE' ? Phase.COMPLETION : Phase.QUANTUM, { kind, pid: selected.id, token: ++this.cpuToken })
          message = `${this.scenario.cpu.algorithm} selected ${selected.id}; ${duration} CPU ticks scheduled from ${this.time}.`
        } else message = 'No READY process; CPU remains idle until the next eligible event.'
      } else message = `${this.runner} keeps the CPU under the non-preemptive dispatch rule.`
    }
    this.trace.push({ sequence: this.processed, time: this.time, phase: event.phase, type: action.kind, pid: action.pid ?? (action.kind === 'DISPATCH' ? this.runner : undefined), message: message || 'Stale service event ignored.' })
    if (this.trace.length > 1000) this.trace.shift()
    if (!this.queue.size || this.processed >= this.scenario.eventLimit) this.stopTimer()
    this.notify()
    return true
  }
  runAll(): void { while (this.next()) { /* all controls use the same event handler */ } }
  play(intervalMs = 400): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error('Playback interval must be positive')
    if (this.timer || !this.queue.size || this.processed >= this.scenario.eventLimit) return
    this.timer = setInterval(() => { this.next() }, intervalMs)
    this.notify()
  }
  pause(): void { this.stopTimer(); this.notify() }
  reset(): void {
    this.stopTimer(); this.queue.clear(); this.cpuToken++
    this.time = 0; this.runner = undefined; this.segments = []; this.trace = []; this.processed = 0; this.readySequence = 0
    this.busy = 0; this.switches = 0; this.segmentStart = 0; this.previousPid = undefined; this.previousEnd = -1; this.dispatchAt = undefined
    this.initialize(); this.notify()
  }
  dispose(): void { this.stopTimer(); this.listeners.clear() }
  private readyProcesses(): RuntimeProcess[] { return this.processes.filter((process) => process.state === 'READY').sort((a, b) => a.readySince - b.readySince || (this.scenario.cpu.algorithm === 'ROUND_ROBIN' ? a.readySequence - b.readySequence : a.id.localeCompare(b.id, undefined, { numeric: true }))) }
  private select(): RuntimeProcess | undefined {
    const ready = this.readyProcesses()
    if (this.scenario.cpu.algorithm === 'SJF') ready.sort((a, b) => a.remaining - b.remaining || a.readySince - b.readySince || a.id.localeCompare(b.id, undefined, { numeric: true }))
    if (this.scenario.cpu.algorithm === 'PRIORITY') ready.sort((a, b) => a.priority - b.priority || a.readySince - b.readySince || a.id.localeCompare(b.id, undefined, { numeric: true }))
    return ready[0]
  }
  private makeReady(process: RuntimeProcess): void { process.state = 'READY'; process.readySince = this.time; process.readySequence = this.readySequence++ }
  private requestDispatch(): void {
    if (this.dispatchAt === this.time) return
    this.dispatchAt = this.time
    this.queue.schedule(this.time, Phase.DISPATCH, { kind: 'DISPATCH' })
  }
  private stopTimer(): void { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined }
  private notify(): void { this.cached = undefined; this.listeners.forEach((listener) => listener()) }
}
