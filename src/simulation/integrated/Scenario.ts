import type { SchedulerAlgorithm } from '../cpu/Scheduler'

export interface CpuBurst { readonly kind: 'cpu'; readonly duration: number }
export interface IoBurst { readonly kind: 'io'; readonly cylinder: number }
export interface ScenarioProcess {
  readonly id: string
  readonly arrival: number
  readonly priority: number
  readonly bursts: readonly (CpuBurst | IoBurst)[]
}
export interface Scenario {
  readonly schemaVersion: 1
  readonly name: string
  readonly cpu: { readonly algorithm: SchedulerAlgorithm; readonly quantum: number }
  readonly disk: { readonly algorithm: 'FCFS' | 'SSTF'; readonly cylinders: number; readonly initialHead: number; readonly baseService: number; readonly seekCost: number }
  readonly processes: readonly ScenarioProcess[]
  readonly eventLimit: number
}

export function integer(value: unknown, label: string, minimum = 0, maximum = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}
export function parseScenario(value: unknown): Scenario {
  const input = object(value, 'Scenario')
  if (input.schemaVersion !== 1) throw new Error('Unsupported scenario schemaVersion; expected 1')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error('Scenario name must contain 1–120 characters')
  const cpu = object(input.cpu, 'CPU configuration')
  if (!['FCFS', 'SJF', 'PRIORITY', 'ROUND_ROBIN'].includes(String(cpu.algorithm))) throw new Error('Unknown CPU algorithm')
  const disk = object(input.disk, 'Disk configuration')
  if (disk.algorithm !== 'FCFS' && disk.algorithm !== 'SSTF') throw new Error('Disk algorithm must be FCFS or SSTF')
  const cylinders = integer(disk.cylinders, 'Cylinder count', 2)
  if (!Array.isArray(input.processes) || input.processes.length > 100) throw new Error('Processes must be an array with at most 100 entries')
  const seen = new Set<string>()
  const processes = input.processes.map((raw, index): ScenarioProcess => {
    const process = object(raw, `Process ${index + 1}`)
    if (typeof process.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(process.id) || seen.has(process.id)) throw new Error('Process IDs must be unique and use letters, digits, underscores or hyphens')
    seen.add(process.id)
    if (!Array.isArray(process.bursts) || process.bursts.length === 0 || process.bursts.length > 101 || process.bursts.length % 2 === 0) throw new Error(`${process.id}: bursts must alternate CPU/I/O and start and end with CPU`)
    const bursts = process.bursts.map((rawBurst, position): CpuBurst | IoBurst => {
      const burst = object(rawBurst, 'Burst')
      if (position % 2 === 0 && burst.kind === 'cpu') return { kind: 'cpu', duration: integer(burst.duration, 'CPU duration', 1) }
      if (position % 2 === 1 && burst.kind === 'io') return { kind: 'io', cylinder: integer(burst.cylinder, 'I/O cylinder', 0, cylinders - 1) }
      throw new Error(`${process.id}: bursts must alternate CPU/I/O`)
    })
    return { id: process.id, arrival: integer(process.arrival, 'Arrival'), priority: integer(process.priority, 'Priority'), bursts }
  })
  return {
    schemaVersion: 1, name: input.name.trim(),
    cpu: { algorithm: cpu.algorithm as SchedulerAlgorithm, quantum: integer(cpu.quantum, 'Quantum', 1) },
    disk: { algorithm: disk.algorithm, cylinders, initialHead: integer(disk.initialHead, 'Initial disk head', 0, cylinders - 1), baseService: integer(disk.baseService, 'Base service'), seekCost: integer(disk.seekCost, 'Seek cost') },
    processes, eventLimit: integer(input.eventLimit ?? 20_000, 'Event limit', 1, 100_000),
  }
}

export const cpuPreset: Scenario = {
  schemaVersion: 1, name: 'CPU scheduling oracle', cpu: { algorithm: 'FCFS', quantum: 2 },
  disk: { algorithm: 'FCFS', cylinders: 200, initialHead: 0, baseService: 1, seekCost: 1 },
  processes: [
    { id: 'P1', arrival: 0, priority: 2, bursts: [{ kind: 'cpu', duration: 5 }] },
    { id: 'P2', arrival: 1, priority: 1, bursts: [{ kind: 'cpu', duration: 3 }] },
    { id: 'P3', arrival: 2, priority: 3, bursts: [{ kind: 'cpu', duration: 1 }] },
  ], eventLimit: 20_000,
}
