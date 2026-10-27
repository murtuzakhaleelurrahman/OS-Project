import { describe, expect, it } from 'vitest'
import { IntegratedEngine } from '../src/simulation/integrated/IntegratedEngine'
import { agingPreset, cpuPreset, ioPreset, mlfqPreset, parseScenario, preemptionPreset, sweepPreset, thrashingPreset } from '../src/simulation/integrated/Scenario'
import { checkPrediction, generateWorkloads, maximumShareLength, replayToEvent, scenarioFragment, scenarioFromFragment, SeededStudy, validateStudy } from '../src/simulation/integrated/LearningExperiments'
import { integratedCpuPolicies } from '../src/simulation/shared/CpuPolicy'

describe('event-index replay', () => {
  it.each([ioPreset, thrashingPreset, preemptionPreset, agingPreset, mlfqPreset, sweepPreset])('matches every original event prefix: $name', (scenario) => {
    const original = new IntegratedEngine(scenario)
    do {
      const expected = original.getSnapshot()
      const replay = replayToEvent(scenario, expected.processedEvents)
      expect(replay.getSnapshot()).toEqual(expected)
      replay.dispose()
    } while (original.next())
    original.dispose()
  })
  it('can rewind a completed run and continue along the identical future', () => {
    const original = new IntegratedEngine(thrashingPreset)
    original.runAll()
    const replay = replayToEvent(thrashingPreset, 20)
    replay.runAll()
    expect(replay.getSnapshot()).toEqual(original.getSnapshot())
  })
  it('replays past trace retention and preserves switch-overhead accounting', () => {
    const scenario = { ...thrashingPreset, memory: { ...thrashingPreset.memory!, frames: 1 }, cpu: { algorithm: 'ROUND_ROBIN', quantum: 1, contextSwitchCost: 2 },
      processes: [0, 1].map((index) => ({ id: `P${index}`, arrival: 0, priority: 0, memoryPages: 3, frameQuota: 1, bursts: [{ kind: 'cpu', duration: 300, references: Array.from({ length: 300 }, (_, tick) => tick % 3) }] })),
    }
    // Two local quotas require two frames, with one page resident per process.
    scenario.memory.frames = 2
    const original = new IntegratedEngine(scenario)
    for (let index = 0; index < 1200; index++) expect(original.next()).toBe(true)
    expect(original.getSnapshot().retainedEvents).toBe(1000)
    expect(original.getSnapshot().overheadTicks).toBeGreaterThan(0)
    expect(replayToEvent(scenario, 1200).getSnapshot()).toEqual(original.getSnapshot())
  })
  it('rejects invalid indices and clamps at queue exhaustion / event limits', () => {
    for (const index of [-1, 0.1, NaN, Infinity, cpuPreset.eventLimit + 1]) expect(() => replayToEvent(cpuPreset, index)).toThrow()
    const limited = replayToEvent({ ...cpuPreset, eventLimit: 2 }, 2).getSnapshot()
    expect(limited.processedEvents).toBe(2)
    expect(limited.status).toBe('limit')
    expect(replayToEvent(cpuPreset, 1000).getSnapshot().status).toBe('complete')
  })
})

describe('reproducible workload studies', () => {
  const settings = { seed: 2026, samples: 3, processes: 4 }
  it('reproduces inputs and outcomes, preserves the base, and supports seed zero / uint32 maximum', () => {
    const original = structuredClone(thrashingPreset)
    const workloads = generateWorkloads(thrashingPreset, settings)
    expect(workloads).toEqual(generateWorkloads(thrashingPreset, settings))
    expect(workloads).not.toEqual(generateWorkloads(thrashingPreset, { ...settings, seed: 2027 }))
    expect(thrashingPreset).toEqual(original)
    expect(workloads.every((scenario) => scenario.memory === undefined)).toBe(true)
    for (const seed of [0, 0xffffffff]) expect(generateWorkloads(cpuPreset, { ...settings, seed })).toHaveLength(3)
    const a = new SeededStudy(cpuPreset, settings)
    const b = new SeededStudy(cpuPreset, settings)
    while (a.step()) { b.step(); expect(a.snapshot()).toEqual(b.snapshot()) }
    expect(a.snapshot().rows.every((row) => row.completed === 3 && row.limited === 0)).toBe(true)
  })
  it('has a stable seed oracle and validates generated scenarios', () => {
    const workloads = generateWorkloads(cpuPreset, { seed: 0, samples: 1, processes: 1 })
    expect(workloads[0].processes[0]).toEqual({ id: 'P1', arrival: 4, priority: 0, bursts: [
      { kind: 'cpu', duration: 3 }, { kind: 'io', cylinder: 29 }, { kind: 'cpu', duration: 5 },
    ] })
    for (const workload of generateWorkloads(cpuPreset, { seed: 42, samples: 100, processes: 12 })) expect(parseScenario(workload)).toEqual(workload)
  })
  it('compares every CPU policy on the same workload and computes equal-weight means', () => {
    const study = new SeededStudy(ioPreset, settings)
    while (study.step()) { /* all samples */ }
    const result = study.snapshot()
    expect(result.processed).toBe(3)
    expect(study.step()).toBe(false)
    expect(result.rows.map((row) => row.cpu)).toEqual([...integratedCpuPolicies])
    for (const row of result.rows) {
      let waiting = 0, turnaround = 0, throughput = 0
      for (const workload of study.workloads) {
        const engine = new IntegratedEngine({ ...workload, cpu: { ...workload.cpu, algorithm: row.cpu } })
        engine.runAll()
        const snapshot = engine.getSnapshot()
        waiting += snapshot.processes.reduce((sum, process) => sum + process.waiting, 0) / settings.processes
        turnaround += snapshot.processes.reduce((sum, process) => sum + process.completion! - process.arrival, 0) / settings.processes
        throughput += snapshot.throughput!
        engine.dispose()
      }
      expect(row.averageWaiting).toBeCloseTo(waiting / 3)
      expect(row.averageTurnaround).toBeCloseTo(turnaround / 3)
      expect(row.throughput).toBeCloseTo(throughput / 3)
    }
  })
  it('reports event-limited workloads instead of averaging them away', () => {
    const study = new SeededStudy({ ...cpuPreset, eventLimit: 1 }, settings)
    study.step()
    expect(study.snapshot().rows.every((row) => row.limited === 1 && row.completed === 0 && row.averageWaiting === null && row.averageTurnaround === null && row.throughput === null)).toBe(true)
  })
  it('rejects invalid study bounds', () => {
    for (const patch of [{ seed: -1 }, { seed: 2 ** 32 }, { samples: 0 }, { samples: 101 }, { processes: 13 }, { processes: 1.2 }, { samples: NaN }]) expect(() => validateStudy({ ...settings, ...patch })).toThrow()
  })
})

describe('predict-first exercises', () => {
  it('checks the textbook Gantt order and explains an incorrect prediction', () => {
    expect(checkPrediction('gantt', 'p1 → p2 → p3')).toMatchObject({ correct: true, actual: 'P1 P2 P3' })
    expect(checkPrediction('gantt', 'P3 P2 P1')).toMatchObject({ correct: false, actual: 'P1 P2 P3' })
  })
  it('counts one-frame thrashing faults without counting retries', () => {
    expect(checkPrediction('faults', '60')).toMatchObject({ correct: true, actual: '60' })
    expect(checkPrediction('faults', '3').correct).toBe(false)
  })
  it('requires a valid guess before revealing results', () => {
    for (const answer of ['', 'P1 P1 P2', 'P1 P2', 'something']) expect(() => checkPrediction('gantt', answer)).toThrow()
    for (const answer of ['', '-1', '2.5', 'NaN']) expect(() => checkPrediction('faults', answer)).toThrow()
    expect(() => checkPrediction('unknown', '60')).toThrow()
  })
})

describe('validated scenario sharing', () => {
  it('round-trips Unicode and all settings, preserving the input', () => {
    const scenario = parseScenario({ ...thrashingPreset, name: '实验 / CPU & I/O #1 😀', cpu: { algorithm: 'MLFQ', quantum: 2, contextSwitchCost: 3, mlfqQuanta: [2, 4, 8], boostInterval: 12 } })
    const before = structuredClone(scenario)
    expect(scenarioFromFragment(scenarioFragment(scenario))).toEqual(scenario)
    expect(scenario).toEqual(before)
    expect(scenarioFromFragment('#other-section')).toBeUndefined()
  })
  it('rejects malformed encoding, JSON, unsupported versions and oversized links', () => {
    for (const fragment of ['#scenario=%XX', '#scenario=null', '#scenario=%7B', '#scenario=' + encodeURIComponent(JSON.stringify({ ...cpuPreset, schemaVersion: 2 })), '#scenario=' + 'x'.repeat(maximumShareLength)]) expect(() => scenarioFromFragment(fragment)).toThrow()
    const large = { ...thrashingPreset, processes: Array.from({ length: 50 }, (_, index) => ({ ...thrashingPreset.processes[0], id: `P${index}` })) }
    expect(() => scenarioFragment(large)).toThrow('too large')
  })
})
