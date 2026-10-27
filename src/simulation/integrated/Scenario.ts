import { integer } from '../shared/validation'
import { integratedCpuPolicies, type IntegratedCpuPolicy } from '../shared/CpuPolicy'
import { integratedDiskPolicies, type DiskDirection, type IntegratedDiskPolicy } from './DiskPolicy'

export interface CpuBurst {
  readonly kind: 'cpu'
  readonly duration: number
  readonly references?: readonly number[]
}
export interface IoBurst { readonly kind: 'io'; readonly cylinder: number }
export interface ScenarioProcess {
  readonly id: string
  readonly arrival: number
  readonly priority: number
  readonly bursts: readonly (CpuBurst | IoBurst)[]
  readonly memoryPages?: number
  readonly frameQuota?: number
}
export interface MemoryConfiguration {
  readonly mode: 'fixed' | 'demand'
  readonly frames: number
  readonly pageSize: number
  readonly replacement: 'FIFO' | 'LRU'
  readonly pageInTicks: number
  readonly pageInCylinder: number
}
export interface Scenario {
  readonly schemaVersion: 1
  readonly name: string
  readonly cpu: {
    readonly algorithm: IntegratedCpuPolicy
    readonly quantum: number
    readonly contextSwitchCost?: number
    readonly agingInterval?: number
    readonly mlfqQuanta?: readonly number[]
    readonly boostInterval?: number
  }
  readonly disk: { readonly algorithm: IntegratedDiskPolicy; readonly cylinders: number; readonly initialHead: number; readonly baseService: number; readonly seekCost: number; readonly initialDirection?: DiskDirection }
  readonly memory?: MemoryConfiguration
  readonly processes: readonly ScenarioProcess[]
  readonly eventLimit: number
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
  if (!integratedCpuPolicies.includes(cpu.algorithm as IntegratedCpuPolicy)) throw new Error('Unknown CPU algorithm')
  const disk = object(input.disk, 'Disk configuration')
  if (!integratedDiskPolicies.includes(disk.algorithm as IntegratedDiskPolicy)) throw new Error('Unknown integrated disk algorithm')
  if (disk.initialDirection !== undefined && disk.initialDirection !== 'UP' && disk.initialDirection !== 'DOWN') throw new Error('Disk direction must be UP or DOWN')
  let mlfqQuanta: number[] | undefined
  if (cpu.mlfqQuanta !== undefined) {
    if (!Array.isArray(cpu.mlfqQuanta) || cpu.mlfqQuanta.length < 2 || cpu.mlfqQuanta.length > 8) throw new Error('MLFQ needs 2–8 positive queue quanta')
    mlfqQuanta = cpu.mlfqQuanta.map((quantum) => integer(quantum, 'MLFQ queue quantum', 1, 10000))
    if (mlfqQuanta.some((quantum, index) => index > 0 && quantum < mlfqQuanta![index - 1])) throw new Error('MLFQ quanta must be non-decreasing')
  }
  const cylinders = integer(disk.cylinders, 'Cylinder count', 2)
  let memory: MemoryConfiguration | undefined
  if (input.memory !== undefined) {
    const configuration = object(input.memory, 'Memory configuration')
    if (configuration.mode !== 'fixed' && configuration.mode !== 'demand') throw new Error('Memory mode must be fixed or demand')
    if (configuration.replacement !== 'FIFO' && configuration.replacement !== 'LRU') throw new Error('Integrated replacement must be FIFO or LRU')
    memory = {
      mode: configuration.mode,
      frames: integer(configuration.frames, 'Physical frame count', 1, 256),
      pageSize: integer(configuration.pageSize, 'Page size', 1, 65536),
      replacement: configuration.replacement,
      pageInTicks: integer(configuration.pageInTicks, 'Page-in ticks', 0, 10000),
      pageInCylinder: integer(configuration.pageInCylinder, 'Page-in cylinder', 0, cylinders - 1),
    }
  }
  if (!Array.isArray(input.processes) || input.processes.length > 100) throw new Error('Processes must be an array with at most 100 entries')
  const seen = new Set<string>()
  const processes = input.processes.map((raw, index): ScenarioProcess => {
    const process = object(raw, `Process ${index + 1}`)
    if (typeof process.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(process.id) || seen.has(process.id)) throw new Error('Process IDs must be unique and use letters, digits, underscores or hyphens')
    seen.add(process.id)
    if (!Array.isArray(process.bursts) || process.bursts.length === 0 || process.bursts.length > 101 || process.bursts.length % 2 === 0) throw new Error(`${process.id}: bursts must alternate CPU/I/O and start and end with CPU`)
    const memoryPages = process.memoryPages === undefined ? undefined : integer(process.memoryPages, 'Virtual page count', 1, 1024)
    const frameQuota = process.frameQuota === undefined ? undefined : integer(process.frameQuota, 'Process frame quota', 1, memory?.frames ?? 256)
    const bursts = process.bursts.map((rawBurst, position): CpuBurst | IoBurst => {
      const burst = object(rawBurst, 'Burst')
      if (position % 2 === 0 && burst.kind === 'cpu') {
        const duration = integer(burst.duration, 'CPU duration', 1)
        if (burst.references === undefined) return { kind: 'cpu', duration }
        if (!memory) throw new Error('CPU page references require integrated memory configuration')
        if (!Array.isArray(burst.references) || burst.references.length !== duration || duration > 10000) throw new Error('Provide one page reference per productive CPU tick, up to 10000 references')
        return { kind: 'cpu', duration, references: burst.references.map((page) => integer(page, 'Virtual page', 0, (memoryPages ?? 1024) - 1)) }
      }
      if (position % 2 === 1 && burst.kind === 'io') return { kind: 'io', cylinder: integer(burst.cylinder, 'I/O cylinder', 0, cylinders - 1) }
      throw new Error(`${process.id}: bursts must alternate CPU/I/O`)
    })
    const requiredPages = memoryPages ?? bursts.reduce((maximum, burst) => burst.kind === 'cpu'
      ? (burst.references ?? [0]).reduce((value, page) => Math.max(value, page + 1), maximum) : maximum, 1)
    if (memory && memory.mode === 'fixed' && requiredPages > memory.frames) throw new Error('Process cannot fit in configured fixed memory')
    if (frameQuota !== undefined && frameQuota > requiredPages) throw new Error('Frame quota cannot exceed the virtual page count')
    if (memory?.mode === 'fixed' && frameQuota !== undefined && frameQuota !== requiredPages) throw new Error('Fixed allocation reserves all process pages')
    return {
      id: process.id, arrival: integer(process.arrival, 'Arrival'), priority: integer(process.priority, 'Priority'), bursts,
      ...(memoryPages === undefined ? {} : { memoryPages }), ...(frameQuota === undefined ? {} : { frameQuota }),
    }
  })
  return {
    schemaVersion: 1, name: input.name.trim(),
    cpu: {
      algorithm: cpu.algorithm as IntegratedCpuPolicy, quantum: integer(cpu.quantum, 'Quantum', 1),
      ...(cpu.contextSwitchCost === undefined ? {} : { contextSwitchCost: integer(cpu.contextSwitchCost, 'Context-switch cost', 0, 1000) }),
      ...(cpu.agingInterval === undefined ? {} : { agingInterval: integer(cpu.agingInterval, 'Aging interval', 1, 10000) }),
      ...(mlfqQuanta === undefined ? {} : { mlfqQuanta }),
      ...(cpu.boostInterval === undefined ? {} : { boostInterval: integer(cpu.boostInterval, 'MLFQ boost interval', 1, 100000) }),
    },
    disk: {
      algorithm: disk.algorithm as IntegratedDiskPolicy, cylinders, initialHead: integer(disk.initialHead, 'Initial disk head', 0, cylinders - 1),
      baseService: integer(disk.baseService, 'Base service'), seekCost: integer(disk.seekCost, 'Seek cost'),
      ...(disk.initialDirection === undefined ? {} : { initialDirection: disk.initialDirection as DiskDirection }),
    },
    ...(memory ? { memory } : {}),
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
export const ioPreset: Scenario = {
  ...cpuPreset, name: 'CPU + disk overlap',
  processes: [
    { id: 'P1', arrival: 0, priority: 1, bursts: [{ kind: 'cpu', duration: 2 }, { kind: 'io', cylinder: 10 }, { kind: 'cpu', duration: 1 }] },
    { id: 'P2', arrival: 0, priority: 1, bursts: [{ kind: 'cpu', duration: 4 }] },
  ],
}
export const diskPreset: Scenario = {
  ...ioPreset, name: 'Disk queue comparison',
  processes: [50, 5, 55, 45].map((cylinder, index) => ({ id: `P${index + 1}`, arrival: 0, priority: index + 1, bursts: [{ kind: 'cpu', duration: 1 }, { kind: 'io', cylinder }, { kind: 'cpu', duration: 1 }] })),
}
export const thrashingPreset: Scenario = {
  ...ioPreset, name: 'Demand paging / thrashing',
  disk: { ...ioPreset.disk, baseService: 0, seekCost: 0 },
  memory: { mode: 'demand', frames: 3, pageSize: 1024, replacement: 'LRU', pageInTicks: 5, pageInCylinder: 0 },
  processes: [{ id: 'P1', arrival: 0, priority: 1, memoryPages: 3, bursts: [{ kind: 'cpu', duration: 60, references: Array.from({ length: 60 }, (_, index) => index % 3) }] }],
}
export const admissionPreset: Scenario = {
  ...ioPreset, name: 'Memory admission and cleanup',
  memory: { mode: 'fixed', frames: 4, pageSize: 1024, replacement: 'FIFO', pageInTicks: 5, pageInCylinder: 0 },
  processes: [
    { id: 'P1', arrival: 0, priority: 1, memoryPages: 3, bursts: [{ kind: 'cpu', duration: 4 }] },
    { id: 'P2', arrival: 0, priority: 1, memoryPages: 2, bursts: [{ kind: 'cpu', duration: 2 }] },
  ],
}

export const preemptionPreset: Scenario = {
  ...cpuPreset, name: 'SRTF arrival preemption', cpu: { algorithm: 'SRTF', quantum: 2 },
  processes: [
    { id: 'P1', arrival: 0, priority: 5, bursts: [{ kind: 'cpu', duration: 8 }] },
    { id: 'P2', arrival: 2, priority: 1, bursts: [{ kind: 'cpu', duration: 2 }] },
  ],
}
export const agingPreset: Scenario = {
  ...cpuPreset, name: 'Priority aging prevents starvation', cpu: { algorithm: 'AGING', quantum: 2, agingInterval: 2 },
  processes: [
    { id: 'P1', arrival: 0, priority: 1, bursts: [{ kind: 'cpu', duration: 20 }] },
    { id: 'P2', arrival: 0, priority: 3, bursts: [{ kind: 'cpu', duration: 1 }] },
  ],
}
export const mlfqPreset: Scenario = {
  ...cpuPreset, name: 'MLFQ interactive arrival', cpu: { algorithm: 'MLFQ', quantum: 2, mlfqQuanta: [1, 2, 4], boostInterval: 20 },
  processes: [
    { id: 'P1', arrival: 0, priority: 0, bursts: [{ kind: 'cpu', duration: 10 }] },
    { id: 'P2', arrival: 2, priority: 0, bursts: [{ kind: 'cpu', duration: 1 }] },
  ],
}
export const sweepPreset: Scenario = {
  ...diskPreset, name: 'Disk sweep and wrap paths',
  disk: { ...diskPreset.disk, algorithm: 'SCAN', initialHead: 50, initialDirection: 'UP' },
  processes: [80, 10, 20, 120].map((cylinder, index) => ({
    id: `P${index + 1}`, arrival: 0, priority: index,
    bursts: [{ kind: 'cpu', duration: 1 }, { kind: 'io', cylinder }, { kind: 'cpu', duration: 1 }],
  })),
}
