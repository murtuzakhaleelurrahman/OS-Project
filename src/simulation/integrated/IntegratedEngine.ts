import { EventQueue, Phase } from './EventQueue'
import { IntegratedMemory } from './IntegratedMemory'
import { parseScenario, type Scenario, type ScenarioProcess } from './Scenario'

export type RuntimeState = 'NEW' | 'JOB' | 'READY' | 'RUNNING' | 'BLOCKED' | 'TERMINATED'
export type BlockedReason = 'IO' | 'PAGE_FAULT'
export interface RuntimeProcess extends ScenarioProcess {
  state: RuntimeState
  burstIndex: number
  remaining: number
  readySince: number
  readySequence: number
  waiting: number
  blocked: number
  jobWait: number
  stateSince: number
  blockedReason?: BlockedReason
  admitted?: number
  firstStart?: number
  completion?: number
}
export interface TraceEntry {
  readonly sequence: number
  readonly time: number
  readonly phase: number
  readonly type: string
  readonly pid?: string
  readonly message: string
}
export interface Segment { readonly pid: string; readonly start: number; readonly end: number }
export interface StateSegment extends Segment { readonly state: RuntimeState; readonly reason?: BlockedReason }
type ActionKind = 'ARRIVAL' | 'CPU_COMPLETE' | 'CPU_STEP' | 'PAGE_CHECK' | 'DISK_COMPLETE' | 'QUANTUM' | 'SWITCH_COMPLETE' | 'DISPATCH'
interface Action { kind: ActionKind; pid?: string; token?: number }
export interface IntegratedDiskRequest {
  readonly id: number
  readonly pid: string
  readonly kind: 'IO' | 'PAGE_IN'
  readonly cylinder: number
  readonly enqueued: number
  readonly page?: number
  readonly frame?: number
  start?: number
  completion?: number
  service?: number
  movement?: number
}
export interface IntegratedSnapshot {
  readonly time: number
  readonly playing: boolean
  readonly status: 'ready' | 'paused' | 'complete' | 'limit'
  readonly processes: readonly RuntimeProcess[]
  readonly ready: readonly string[]
  readonly jobQueue: readonly string[]
  readonly running?: string
  readonly switchingTo?: string
  readonly segments: readonly Segment[]
  readonly stateSegments: readonly StateSegment[]
  readonly trace: readonly TraceEntry[]
  readonly processedEvents: number
  readonly retainedEvents: number
  readonly nextEventTime?: number
  readonly busyTicks: number
  readonly overheadTicks: number
  readonly idleTicks: number
  readonly contextSwitches: number
  readonly utilization: number | null
  readonly throughput: number | null
  readonly memory?: ReturnType<IntegratedMemory['snapshot']>
  readonly disk: {
    readonly head: number
    readonly active?: IntegratedDiskRequest
    readonly requests: readonly IntegratedDiskRequest[]
    readonly totalMovement: number
  }
}

/** One event-driven CPU/disk system. Laboratories never mutate this run. */
export class IntegratedEngine {
  readonly scenario: Scenario
  private readonly queue = new EventQueue<Action>()
  private processes: RuntimeProcess[] = []
  private time = 0
  private runner: string | undefined
  private segmentStart = 0
  private segments: Segment[] = []
  private stateSegments: StateSegment[] = []
  private trace: TraceEntry[] = []
  private processed = 0
  private readySequence = 0
  private cpuToken = 0
  private usedQuantum = 0
  private busy = 0
  private overhead = 0
  private switches = 0
  private previousPid: string | undefined
  private previousEnd = -1
  private dispatchAt: number | undefined
  private switchingTo: string | undefined
  private switchStart = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly listeners = new Set<() => void>()
  private cached: IntegratedSnapshot | undefined
  private head = 0
  private diskRequests: IntegratedDiskRequest[] = []
  private activeDisk: IntegratedDiskRequest | undefined
  private memory: IntegratedMemory | undefined
  private jobs: string[] = []

  constructor(scenario: unknown) {
    this.scenario = parseScenario(scenario)
    this.initialize()
  }

  private initialize(): void {
    this.head = this.scenario.disk.initialHead
    this.memory = this.scenario.memory ? new IntegratedMemory(this.scenario.memory) : undefined
    this.processes = this.scenario.processes.map((process) => ({
      ...structuredClone(process), state: 'NEW', burstIndex: 0,
      remaining: process.bursts[0].kind === 'cpu' ? process.bursts[0].duration : 0,
      readySince: 0, readySequence: 0, waiting: 0, blocked: 0, jobWait: 0, stateSince: 0,
    }))
    for (const process of this.processes) {
      this.queue.schedule(process.arrival, Phase.ARRIVAL, { kind: 'ARRIVAL', pid: process.id })
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): IntegratedSnapshot => {
    if (this.cached) return this.cached
    const segments = this.segments.map((segment) => ({ ...segment }))
    if (this.runner && this.time > this.segmentStart) {
      segments.push({ pid: this.runner, start: this.segmentStart, end: this.time })
    } else if (this.switchingTo && this.time > this.switchStart) {
      segments.push({ pid: 'SWITCH', start: this.switchStart, end: this.time })
    } else if (!this.runner && !this.switchingTo && this.time > (segments.at(-1)?.end ?? 0)) {
      segments.push({ pid: 'IDLE', start: segments.at(-1)?.end ?? 0, end: this.time })
    }
    const stateSegments = [...this.stateSegments]
    for (const process of this.processes) {
      if (this.time > process.stateSince) stateSegments.push({
        pid: process.id, state: process.state, reason: process.blockedReason,
        start: process.stateSince, end: this.time,
      })
    }
    this.cached = {
      time: this.time, playing: this.timer !== undefined,
      status: this.processes.every((process) => process.state === 'TERMINATED') ? 'complete'
        : this.processed >= this.scenario.eventLimit ? 'limit' : this.processed === 0 ? 'ready' : 'paused',
      processes: structuredClone(this.processes), ready: this.readyProcesses().map((process) => process.id),
      jobQueue: [...this.jobs], running: this.runner, switchingTo: this.switchingTo,
      segments, stateSegments, trace: [...this.trace], processedEvents: this.processed,
      retainedEvents: this.trace.length, nextEventTime: this.queue.nextTime,
      busyTicks: this.busy, overheadTicks: this.overhead, idleTicks: this.time - this.busy - this.overhead,
      contextSwitches: this.switches,
      utilization: this.time === 0 ? null : this.busy / this.time * 100,
      throughput: this.time === 0 ? null : this.processes.filter((process) => process.state === 'TERMINATED').length / this.time,
      memory: this.memory?.snapshot(),
      disk: {
        head: this.head, active: this.activeDisk ? { ...this.activeDisk } : undefined,
        requests: structuredClone(this.diskRequests),
        totalMovement: this.diskRequests.reduce((total, request) => total + (request.movement ?? 0), 0),
      },
    }
    return this.cached
  }

  next(): boolean {
    if (this.processed >= this.scenario.eventLimit) { this.pause(); return false }
    const event = this.queue.pop()
    if (!event) { this.pause(); return false }
    this.advanceTo(event.time)
    this.processed++
    const action = event.payload
    const process = this.processes.find((candidate) => candidate.id === action.pid)
    let message = 'Stale service event ignored.'

    if (action.kind === 'ARRIVAL' && process) {
      if (this.memory) {
        this.setState(process, 'JOB')
        this.jobs.push(process.id)
        this.admitJobs()
      } else {
        process.admitted = this.time
        this.makeReady(process)
      }
      message = `${process.id} arrived; ${process.state === 'JOB' ? 'waiting in the FIFO job queue for free frames' : 'admitted to READY'}.`
      this.requestDispatch()
    } else if (action.kind === 'DISK_COMPLETE' && process && this.activeDisk?.id === action.token) {
      message = this.completeDisk(process)
    } else if (action.kind === 'SWITCH_COMPLETE' && process && this.switchingTo === process.id) {
      this.segments.push({ pid: 'SWITCH', start: this.switchStart, end: this.time })
      this.switchingTo = undefined
      this.startCpu(process)
      message = `Context switch completed; ${process.id} starts CPU service.`
    } else if (action.kind === 'DISPATCH') {
      this.dispatchAt = undefined
      message = this.dispatchCpu()
      message += this.dispatchDisk()
    } else if (process && this.runner === process.id && action.token === this.cpuToken) {
      if (action.kind === 'PAGE_CHECK') message = this.checkPage(process)
      else if (action.kind === 'CPU_COMPLETE') message = this.finishBurst(process)
      else if (action.kind === 'CPU_STEP') {
        if (process.remaining === 0) message = this.finishBurst(process)
        else if (this.scenario.cpu.algorithm === 'ROUND_ROBIN' && this.usedQuantum >= this.scenario.cpu.quantum) {
          this.scheduleCpu('QUANTUM', this.time, Phase.QUANTUM, process.id)
          message = `${process.id} completed one productive tick; quantum boundary reached.`
        } else {
          this.scheduleCpu('PAGE_CHECK', this.time, Phase.DISPATCH, process.id)
          message = `${process.id} completed one productive tick; next memory reference follows.`
        }
      } else if (action.kind === 'QUANTUM') {
        this.releaseCpu(process)
        this.makeReady(process)
        this.requestDispatch()
        message = `${process.id} used quantum ${this.scenario.cpu.quantum}; returned to the tail of the ready queue.`
      }
    }

    this.trace.push({
      sequence: this.processed, time: this.time, phase: event.phase, type: action.kind,
      pid: action.pid ?? (action.kind === 'DISPATCH' ? this.runner : undefined), message,
    })
    if (this.trace.length > 1000) this.trace.shift()
    if (!this.queue.size || this.processed >= this.scenario.eventLimit) this.stopTimer()
    this.notify()
    return true
  }

  private advanceTo(time: number): void {
    const elapsed = time - this.time
    for (const process of this.processes) {
      if (process.state === 'READY') process.waiting += elapsed
      if (process.state === 'JOB') process.jobWait += elapsed
      if (process.state === 'BLOCKED') process.blocked += elapsed
      if (process.state === 'RUNNING') {
        process.remaining -= elapsed
        this.busy += elapsed
        this.usedQuantum += elapsed
      }
    }
    if (this.switchingTo) this.overhead += elapsed
    this.time = time
  }

  private setState(process: RuntimeProcess, state: RuntimeState, reason?: BlockedReason): void {
    if (this.time > process.stateSince) this.stateSegments.push({
      pid: process.id, state: process.state, reason: process.blockedReason,
      start: process.stateSince, end: this.time,
    })
    process.state = state
    process.stateSince = this.time
    process.blockedReason = reason
  }

  private admitJobs(): string[] {
    const admitted: string[] = []
    while (this.jobs.length) {
      const process = this.processes.find((candidate) => candidate.id === this.jobs[0])!
      if (!this.memory!.admit(process)) break
      this.jobs.shift()
      process.admitted = this.time
      this.makeReady(process)
      admitted.push(process.id)
    }
    return admitted
  }

  private dispatchCpu(): string {
    if (this.switchingTo) return `CPU switching to ${this.switchingTo}.`
    if (this.runner) return `${this.runner} keeps the CPU under the non-preemptive dispatch rule.`
    const selected = this.select()
    if (!selected) return 'No READY process; CPU remains idle until the next eligible event.'
    this.recordIdleGap()
    const directSwitch = this.previousEnd === this.time && this.previousPid !== undefined && this.previousPid !== selected.id
    if (directSwitch) this.switches++
    const cost = this.scenario.cpu.contextSwitchCost ?? 0
    if (directSwitch && cost > 0) {
      this.switchingTo = selected.id
      this.switchStart = this.time
      this.queue.schedule(this.time + cost, Phase.COMPLETION, { kind: 'SWITCH_COMPLETE', pid: selected.id })
      return `Switching from ${this.previousPid} to ${selected.id}; ${cost} overhead ticks. Selected target remains READY until completion.`
    }
    this.startCpu(selected)
    return `${this.scenario.cpu.algorithm} selected ${selected.id}; CPU service starts at ${this.time}.`
  }

  private startCpu(process: RuntimeProcess): void {
    this.setState(process, 'RUNNING')
    process.firstStart ??= this.time
    this.runner = process.id
    this.segmentStart = this.time
    this.usedQuantum = 0
    this.cpuToken++
    if (this.memory?.configuration.mode === 'demand') {
      this.scheduleCpu('PAGE_CHECK', this.time, Phase.DISPATCH, process.id)
    } else {
      const duration = this.scenario.cpu.algorithm === 'ROUND_ROBIN'
        ? Math.min(this.scenario.cpu.quantum, process.remaining) : process.remaining
      const kind = duration === process.remaining ? 'CPU_COMPLETE' : 'QUANTUM'
      this.scheduleCpu(kind, this.time + duration, kind === 'CPU_COMPLETE' ? Phase.COMPLETION : Phase.QUANTUM, process.id)
    }
  }

  private checkPage(process: RuntimeProcess): string {
    const burst = process.bursts[process.burstIndex]
    if (burst.kind !== 'cpu' || !this.memory) throw new Error('Memory access requires a CPU burst and memory')
    const index = burst.duration - process.remaining
    const page = burst.references?.[index] ?? 0
    const access = this.memory.access(process.id, page)
    if (access.hit) {
      this.scheduleCpu('CPU_STEP', this.time + 1, Phase.COMPLETION, process.id)
      return `${process.id} ${access.retry ? 'retried the faulting reference' : 'page hit'}: page ${page} in frame ${access.frame}; one productive tick scheduled.`
    }
    this.releaseCpu(process)
    this.setState(process, 'BLOCKED', 'PAGE_FAULT')
    this.diskRequests.push({
      id: this.diskRequests.length + 1, pid: process.id, kind: 'PAGE_IN',
      cylinder: this.memory.configuration.pageInCylinder, enqueued: this.time, page, frame: access.frame,
    })
    this.requestDispatch()
    return `PAGE_FAULT: ${process.id} page ${page}; ${access.victim === undefined ? 'empty reserved frame' : `evicted page ${access.victim}`} ${access.frame}. Process blocked; shared disk will page in and retry this reference.`
  }

  private releaseCpu(process: RuntimeProcess): void {
    if (this.time > this.segmentStart) this.segments.push({ pid: process.id, start: this.segmentStart, end: this.time })
    this.runner = undefined
    this.previousPid = process.id
    this.previousEnd = this.time
    this.cpuToken++
  }

  private finishBurst(process: RuntimeProcess): string {
    this.releaseCpu(process)
    const io = process.bursts[process.burstIndex + 1]
    let message: string
    if (io?.kind === 'io') {
      process.burstIndex++
      this.setState(process, 'BLOCKED', 'IO')
      this.diskRequests.push({ id: this.diskRequests.length + 1, pid: process.id, kind: 'IO', cylinder: io.cylinder, enqueued: this.time })
      message = `${process.id} finished a CPU burst, requested disk cylinder ${io.cylinder}, and became BLOCKED.`
    } else {
      this.setState(process, 'TERMINATED')
      process.completion = this.time
      message = `${process.id} completed its final CPU burst and terminated.`
      if (this.memory) {
        this.memory.release(process.id)
        const admitted = this.admitJobs()
        message += ` Freed all reserved frames.${admitted.length ? ` Admitted queued jobs: ${admitted.join(', ')}.` : ''}`
      }
    }
    this.requestDispatch()
    return message
  }

  private dispatchDisk(): string {
    if (this.activeDisk) return ''
    const pending = this.diskRequests.filter((request) => request.start === undefined)
    pending.sort((a, b) => (this.scenario.disk.algorithm === 'SSTF'
      ? Math.abs(a.cylinder - this.head) - Math.abs(b.cylinder - this.head) : 0) || a.id - b.id)
    const request = pending[0]
    if (!request) return ''
    request.start = this.time
    request.movement = Math.abs(request.cylinder - this.head)
    const pageIn = request.kind === 'PAGE_IN' ? this.memory!.configuration.pageInTicks : 0
    request.service = Math.max(1, this.scenario.disk.baseService + this.scenario.disk.seekCost * request.movement + pageIn)
    this.activeDisk = request
    this.queue.schedule(this.time + request.service, Phase.COMPLETION, { kind: 'DISK_COMPLETE', pid: request.pid, token: request.id })
    return ` Disk ${this.scenario.disk.algorithm} selected ${request.pid} ${request.kind}: movement ${request.movement}, service ${request.service}, completes at ${this.time + request.service}.`
  }

  private completeDisk(process: RuntimeProcess): string {
    const request = this.activeDisk!
    request.completion = this.time
    this.head = request.cylinder
    this.activeDisk = undefined
    let message: string
    if (request.kind === 'PAGE_IN') {
      this.memory!.complete(process.id, request.frame!, request.page!)
      message = `PAGE_IN completed: ${process.id} page ${request.page} is resident in frame ${request.frame}; returned to READY to retry, without a duplicate reference count.`
    } else {
      process.burstIndex++
      const burst = process.bursts[process.burstIndex]
      if (burst?.kind !== 'cpu') throw new Error('I/O completion must lead to a CPU burst')
      process.remaining = burst.duration
      message = `Disk interrupt: ${process.id} completed I/O at cylinder ${this.head}; returned to READY with CPU burst ${burst.duration}.`
    }
    this.makeReady(process)
    this.requestDispatch()
    return message
  }

  private scheduleCpu(kind: ActionKind, time: number, phase: 0 | 1 | 2 | 3, pid: string): void {
    this.queue.schedule(time, phase, { kind, pid, token: this.cpuToken })
  }

  private recordIdleGap(): void {
    const lastEnd = this.segments.at(-1)?.end ?? 0
    if (this.time > lastEnd) this.segments.push({ pid: 'IDLE', start: lastEnd, end: this.time })
  }

  private readyProcesses(): RuntimeProcess[] {
    return this.processes.filter((process) => process.state === 'READY').sort((a, b) =>
      a.readySince - b.readySince || (this.scenario.cpu.algorithm === 'ROUND_ROBIN'
        ? a.readySequence - b.readySequence : a.id.localeCompare(b.id, undefined, { numeric: true })))
  }

  private select(): RuntimeProcess | undefined {
    const ready = this.readyProcesses()
    const ties = (a: RuntimeProcess, b: RuntimeProcess) => a.readySince - b.readySince || a.id.localeCompare(b.id, undefined, { numeric: true })
    if (this.scenario.cpu.algorithm === 'SJF') ready.sort((a, b) => a.remaining - b.remaining || ties(a, b))
    if (this.scenario.cpu.algorithm === 'PRIORITY') ready.sort((a, b) => a.priority - b.priority || ties(a, b))
    return ready[0]
  }

  private makeReady(process: RuntimeProcess): void {
    this.setState(process, 'READY')
    process.readySince = this.time
    process.readySequence = this.readySequence++
  }

  private requestDispatch(): void {
    if (this.dispatchAt === this.time) return
    this.dispatchAt = this.time
    this.queue.schedule(this.time, Phase.DISPATCH, { kind: 'DISPATCH' })
  }

  runAll(): void { while (this.next()) { /* identical handlers for every playback mode */ } }
  play(intervalMs = 400): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error('Playback interval must be positive')
    if (this.timer || !this.queue.size || this.processed >= this.scenario.eventLimit) return
    this.timer = setInterval(() => { this.next() }, intervalMs)
    this.notify()
  }
  pause(): void { this.stopTimer(); this.notify() }
  reset(): void {
    this.stopTimer()
    this.queue.clear()
    this.cpuToken++
    this.time = 0
    this.runner = undefined
    this.switchingTo = undefined
    this.segments = []
    this.stateSegments = []
    this.trace = []
    this.processed = 0
    this.readySequence = 0
    this.jobs = []
    this.diskRequests = []
    this.activeDisk = undefined
    this.busy = 0
    this.overhead = 0
    this.switches = 0
    this.usedQuantum = 0
    this.segmentStart = 0
    this.previousPid = undefined
    this.previousEnd = -1
    this.dispatchAt = undefined
    this.initialize()
    this.notify()
  }
  dispose(): void { this.stopTimer(); this.listeners.clear() }
  private stopTimer(): void { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined }
  private notify(): void { this.cached = undefined; this.listeners.forEach((listener) => listener()) }
}
