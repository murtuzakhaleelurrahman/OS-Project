import { IntegratedEngine } from './IntegratedEngine'
import { cpuPreset, parseScenario, thrashingPreset, type Scenario } from './Scenario'
import { integratedCpuPolicies } from '../shared/CpuPolicy'
import { importScenario } from './Experiments'
import { integer } from '../shared/validation'

/** Replay counts queue events, not trace entries or elapsed ticks. No timer is started. */
export function replayToEvent(scenario: unknown, eventIndex: number): IntegratedEngine {
  const parsed = parseScenario(scenario)
  integer(eventIndex, 'Event index', 0, parsed.eventLimit)
  const engine = new IntegratedEngine(parsed)
  for (let index = 0; index < eventIndex && engine.next(); index++) { /* deterministic prefix */ }
  return engine
}

export interface StudyOptions { seed: number; samples: number; processes: number }
export function validateStudy(options: StudyOptions): StudyOptions {
  return {
    seed: integer(options.seed, 'Seed', 0, 0xffffffff),
    samples: integer(options.samples, 'Workloads', 1, 100),
    processes: integer(options.processes, 'Processes', 1, 12),
  }
}

/** Mulberry32: unsigned 32-bit arithmetic makes the seed portable across browsers. */
function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function generateWorkloads(base: unknown, options: StudyOptions): Scenario[] {
  const scenario = parseScenario(base)
  const settings = validateStudy(options)
  const random = randomSource(settings.seed)
  const pick = (max: number) => Math.floor(random() * max)
  return Array.from({ length: settings.samples }, (_, sample) => parseScenario({
    ...scenario, memory: undefined, name: `Seed ${settings.seed} / workload ${sample + 1}`,
    processes: Array.from({ length: settings.processes }, (_, index) => ({
      id: `P${index + 1}`, arrival: pick(16), priority: pick(8),
      bursts: [
        { kind: 'cpu', duration: 1 + pick(10) },
        { kind: 'io', cylinder: pick(scenario.disk.cylinders) },
        { kind: 'cpu', duration: 1 + pick(10) },
      ],
    })),
  }))
}

export interface StudyRow {
  cpu: Scenario['cpu']['algorithm']; completed: number; limited: number
  averageWaiting: number | null; averageTurnaround: number | null; throughput: number | null
}

/** One step runs all CPU policies on the same generated workload. UI may yield between steps. */
export class SeededStudy {
  readonly workloads: readonly Scenario[]
  private done = 0
  private totals = integratedCpuPolicies.map((cpu) => ({ cpu, completed: 0, limited: 0, waiting: 0, turnaround: 0, throughput: 0 }))
  constructor(base: unknown, options: StudyOptions) { this.workloads = generateWorkloads(base, options) }
  step(): boolean {
    const scenario = this.workloads[this.done]
    if (!scenario) return false
    for (const row of this.totals) {
      const engine = new IntegratedEngine({ ...scenario, cpu: { ...scenario.cpu, algorithm: row.cpu } })
      engine.runAll()
      const result = engine.getSnapshot()
      if (result.status === 'complete') {
        row.completed++
        row.waiting += result.processes.reduce((sum, process) => sum + process.waiting, 0) / result.processes.length
        row.turnaround += result.processes.reduce((sum, process) => sum + process.completion! - process.arrival, 0) / result.processes.length
        row.throughput += result.throughput ?? 0
      } else row.limited++
      engine.dispose()
    }
    this.done++
    return true
  }
  snapshot(): { processed: number; total: number; rows: StudyRow[] } {
    return { processed: this.done, total: this.workloads.length, rows: this.totals.map((row) => ({
      cpu: row.cpu, completed: row.completed, limited: row.limited,
      // A policy with incomplete workloads must not win by silently dropping difficult samples.
      averageWaiting: row.limited || !row.completed ? null : row.waiting / row.completed,
      averageTurnaround: row.limited || !row.completed ? null : row.turnaround / row.completed,
      throughput: row.limited || !row.completed ? null : row.throughput / row.completed,
    })) }
  }
}

export const lessons = [
  { id: 'gantt', title: 'Predict the FCFS order', question: 'P1 arrives at 0 and needs 5 ticks; P2 arrives at 1 and needs 3; P3 arrives at 2 and needs 1. Enter their CPU order, e.g. P3 P2 P1.', scenario: cpuPreset },
  { id: 'faults', title: 'Predict page faults', question: 'One process references 0,1,2 twenty times (60 references). It starts with one empty frame and LRU replacement. How many page faults occur?', scenario: { ...thrashingPreset, memory: { ...thrashingPreset.memory!, frames: 1 }, processes: thrashingPreset.processes.map((process) => ({ ...process, frameQuota: 1 })) } },
] as const

export function checkPrediction(id: string, answer: string): { correct: boolean; actual: string; explanation: string } {
  const lesson = lessons.find((candidate) => candidate.id === id)
  if (!lesson) throw new Error('Unknown lesson')
  const normalized = id === 'gantt' ? answer.trim().toUpperCase().split(/[\s,→>-]+/).filter(Boolean).join(' ') : answer.trim()
  if (id === 'gantt' ? !/^P[123] P[123] P[123]$/.test(normalized) || new Set(normalized.split(' ')).size !== 3 : !/^\d+$/.test(normalized)) {
    throw new Error(id === 'gantt' ? 'Enter P1, P2 and P3 once each in your predicted order.' : 'Enter a non-negative whole number.')
  }
  const engine = new IntegratedEngine(lesson.scenario)
  engine.runAll()
  const result = engine.getSnapshot()
  const actual = id === 'gantt' ? result.segments.filter((segment) => !['IDLE', 'SWITCH'].includes(segment.pid)).map((segment) => segment.pid).join(' ') : String(result.memory!.faults)
  engine.dispose()
  return {
    correct: id === 'gantt' ? normalized === actual : Number(normalized) === Number(actual), actual,
    explanation: id === 'gantt' ? 'FCFS keeps P1 until it finishes at t=5, then serves P2 (5–8) and P3 (8–9).' : 'Every reference differs from the sole resident page. Each of the 60 references needs a page-in; retries do not count twice.',
  }
}

export const savedScenarioKey = 'mini-os.scenario.v1'
export const maximumShareLength = 16000
export function scenarioFragment(scenario: unknown): string {
  const fragment = '#scenario=' + encodeURIComponent(JSON.stringify(parseScenario(scenario)))
  if (fragment.length > maximumShareLength) throw new Error('This workload is too large for a share link. Use Export workload JSON instead.')
  return fragment
}
export function scenarioFromFragment(fragment: string): Scenario | undefined {
  if (!fragment.startsWith('#scenario=')) return undefined
  if (fragment.length > maximumShareLength) throw new Error('Share link exceeds the 16000-character limit')
  try { return importScenario(decodeURIComponent(fragment.slice('#scenario='.length))) }
  catch { throw new Error('Invalid shared scenario. Check the link or import a workload JSON file.') }
}
