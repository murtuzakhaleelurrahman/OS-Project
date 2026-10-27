import { describe, expect, it, vi } from 'vitest'
import { IntegratedEngine } from '../src/simulation/integrated/IntegratedEngine'
import { cpuPreset, parseScenario, thrashingPreset } from '../src/simulation/integrated/Scenario'
import { chooseDiskRequest, integratedDiskPolicies } from '../src/simulation/integrated/DiskPolicy'
import { integratedCpuPolicies } from '../src/simulation/shared/CpuPolicy'

const process = (id: string, arrival: number, duration: number, priority = 0) => ({ id, arrival, priority, bursts: [{ kind: 'cpu' as const, duration }] })
const run = (scenario: unknown) => { const engine = new IntegratedEngine(scenario); engine.runAll(); return engine.getSnapshot() }

describe('expanded CPU policies', () => {
  it('SRTF preempts on a shorter arrival and cancels its old completion', () => {
    const result = run({ ...cpuPreset, cpu: { algorithm: 'SRTF', quantum: 2 }, processes: [process('P1', 0, 8), process('P2', 2, 2)] })
    expect(result.segments).toEqual([{ pid: 'P1', start: 0, end: 2 }, { pid: 'P2', start: 2, end: 4 }, { pid: 'P1', start: 4, end: 10 }])
    expect(result.trace.some((entry) => entry.message.includes('Stale'))).toBe(false)
    expect(result.trace.some((entry) => entry.time === 8)).toBe(false)
  })
  it('preemptive Priority uses lower numbers and does not preempt on equal priority', () => {
    const result = run({ ...cpuPreset, cpu: { algorithm: 'PREEMPTIVE_PRIORITY', quantum: 2 }, processes: [process('P1', 0, 6, 5), process('P2', 1, 2, 1), process('P3', 2, 1, 1)] })
    expect(result.segments.map((segment) => segment.pid)).toEqual(['P1', 'P2', 'P3', 'P1'])
    expect(result.processes[1].completion).toBe(3)
  })
  it('SRTF keeps the runner when remaining times tie', () => {
    const result = run({ ...cpuPreset, cpu: { algorithm: 'SRTF', quantum: 2 }, processes: [process('P1', 0, 4), process('P2', 2, 2)] })
    expect(result.segments).toEqual([{ pid: 'P1', start: 0, end: 4 }, { pid: 'P2', start: 4, end: 6 }])
  })
  it('aging acts at the exact ready-wait boundary and excludes stale review events', () => {
    const result = run({ ...cpuPreset, cpu: { algorithm: 'AGING', quantum: 2, agingInterval: 2 }, processes: [process('P1', 0, 20, 1), process('P2', 0, 1, 3)] })
    expect(result.processes[1].firstStart).toBe(6)
    expect(result.time).toBe(21)
    expect(result.status).toBe('complete')
  })
  it('MLFQ demotes after consumed budgets and preserves a budget across higher-level preemption', () => {
    const result = run({ ...cpuPreset, cpu: { algorithm: 'MLFQ', quantum: 2, mlfqQuanta: [1, 2, 4], boostInterval: 100 }, processes: [process('P1', 0, 10), process('P2', 2, 1)] })
    expect(result.segments.slice(0, 4)).toEqual([
      { pid: 'P1', start: 0, end: 1 }, { pid: 'P1', start: 1, end: 2 },
      { pid: 'P2', start: 2, end: 3 }, { pid: 'P1', start: 3, end: 4 },
    ])
    expect(result.busyTicks).toBe(11)
  })
  it('MLFQ boosts competing queues and deterministic reset reproduces the trace', () => {
    const scenario = { ...cpuPreset, cpu: { algorithm: 'MLFQ', quantum: 2, mlfqQuanta: [1, 2, 4], boostInterval: 3 }, processes: [process('P1', 0, 8), process('P2', 0, 8)] }
    const engine = new IntegratedEngine(scenario); engine.runAll()
    const first = engine.getSnapshot()
    expect(first.trace.some((entry) => entry.message.startsWith('MLFQ priority boost'))).toBe(true)
    engine.reset(); engine.runAll()
    expect(engine.getSnapshot()).toEqual(first)
    expect(first.time).toBe(16)
  })
  it('page-reference counting remains exact during same-time preemption', () => {
    const scenario = { ...thrashingPreset, cpu: { algorithm: 'PREEMPTIVE_PRIORITY', quantum: 2 }, memory: { ...thrashingPreset.memory, frames: 2, pageInTicks: 1 }, processes: [
      { ...process('P1', 0, 4, 5), memoryPages: 1, frameQuota: 1, bursts: [{ kind: 'cpu', duration: 4, references: [0, 0, 0, 0] }] },
      { ...process('P2', 2, 2, 0), memoryPages: 1, frameQuota: 1, bursts: [{ kind: 'cpu', duration: 2, references: [0, 0] }] },
    ] }
    const result = run(scenario)
    expect(result.memory).toMatchObject({ references: 6, faults: 2, hits: 4 })
    expect(result.busyTicks).toBe(6)
    for (const item of result.processes) {
      const first = item.bursts[0]
      expect(first.kind).toBe('cpu')
      if (first.kind === 'cpu') expect(item.completion! - item.arrival).toBe(first.duration + item.waiting + item.blocked + item.jobWait)
    }
  })
  it('timer playback matches step execution with preemption and switch overhead', () => {
    vi.useFakeTimers()
    try {
      const scenario = { ...cpuPreset, cpu: { algorithm: 'SRTF', quantum: 2, contextSwitchCost: 1 } }
      const manual = run(scenario)
      const timed = new IntegratedEngine(scenario); timed.play(1); vi.runAllTimers()
      expect(timed.getSnapshot()).toEqual(manual)
      timed.dispose()
    } finally { vi.useRealTimers() }
  })
  it('reconsiders a better arrival after a committed context switch completes', () => {
    const result = run({ ...cpuPreset, cpu: { algorithm: 'SRTF', quantum: 2, contextSwitchCost: 2 }, processes: [process('P1', 0, 1), process('P2', 0, 10), process('P3', 2, 1)] })
    expect(result.processes[2]).toMatchObject({ firstStart: 5, completion: 6 })
    expect(result.busyTicks).toBe(12)
    expect(result.time).toBe(18)
    expect(result.segments.some((segment) => segment.pid === 'P2' && segment.start === 3)).toBe(false)
  })
})

describe('integrated disk sweep paths', () => {
  const pending = [10, 20].map((cylinder, index) => ({ id: index + 1, cylinder }))
  it.each([
    ['SCAN', [199, 20], 328, 'DOWN'],
    ['C-SCAN', [199, 0, 10], 358, 'UP'],
    ['LOOK', [20], 30, 'DOWN'],
    ['C-LOOK', [10], 40, 'UP'],
  ] as const)('%s charges its full UP sweep path', (policy, path, distance, direction) => {
    expect(chooseDiskRequest(pending, 50, 'UP', policy, 200)).toMatchObject({ path, distance, direction })
  })
  it('charges circular wrap in the DOWN direction and breaks duplicate-cylinder ties by enqueue order', () => {
    expect(chooseDiskRequest([{ id: 1, cylinder: 120 }], 50, 'DOWN', 'C-SCAN', 200)).toMatchObject({ path: [0, 199, 120], distance: 328 })
    expect(chooseDiskRequest([{ id: 2, cylinder: 60 }, { id: 1, cylinder: 60 }], 50, 'UP', 'LOOK', 200)?.request.id).toBe(1)
  })
  it('uses path distance for integrated service duration', () => {
    const result = run({ ...cpuPreset, disk: { ...cpuPreset.disk, algorithm: 'SCAN', initialHead: 50, initialDirection: 'UP' }, processes: [{ id: 'P1', arrival: 0, priority: 0, bursts: [{ kind: 'cpu', duration: 1 }, { kind: 'io', cylinder: 20 }, { kind: 'cpu', duration: 1 }] }] })
    expect(result.disk.requests[0]).toMatchObject({ path: [199, 20], movement: 328, service: 329, start: 1, completion: 330 })
    expect(result.time).toBe(331)
  })
})

describe('expanded policies with integrated paging', () => {
  it('conserves process and CPU time across every policy pair', () => {
    for (const algorithm of integratedCpuPolicies) for (const diskAlgorithm of integratedDiskPolicies) {
      const result = run({ ...thrashingPreset, cpu: { algorithm, quantum: 1, agingInterval: 2, boostInterval: 5, contextSwitchCost: 1 }, disk: { ...thrashingPreset.disk, algorithm: diskAlgorithm }, memory: { ...thrashingPreset.memory, frames: 2 }, processes: ['P1', 'P2'].map((id, index) => ({ ...process(id, index, 3, index), memoryPages: 2, frameQuota: 1, bursts: [{ kind: 'cpu', duration: 3, references: [0, 1, 0] }] })) })
      expect(result.status, `${algorithm}/${diskAlgorithm}`).toBe('complete')
      expect(result.busyTicks).toBe(6)
      expect(result.memory?.references).toBe(6)
      expect(result.busyTicks + result.idleTicks + result.overheadTicks).toBe(result.time)
      for (const item of result.processes) expect(item.completion! - item.arrival).toBe(3 + item.waiting + item.blocked + item.jobWait)
    }
  })
  it('validates policy configuration before running', () => {
    expect(() => parseScenario({ ...cpuPreset, cpu: { ...cpuPreset.cpu, mlfqQuanta: [2, 1] } })).toThrow()
    expect(() => parseScenario({ ...cpuPreset, cpu: { ...cpuPreset.cpu, agingInterval: 0 } })).toThrow()
    expect(() => parseScenario({ ...cpuPreset, disk: { ...cpuPreset.disk, initialDirection: 'SIDEWAYS' } })).toThrow()
  })
})
