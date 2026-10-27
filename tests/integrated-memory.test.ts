import { describe, expect, it, vi } from 'vitest'
import { IntegratedEngine } from '../src/simulation/integrated/IntegratedEngine'
import { admissionPreset, cpuPreset, parseScenario, thrashingPreset } from '../src/simulation/integrated/Scenario'
import { compareFrameCounts } from '../src/simulation/integrated/MemoryExperiments'
import { metricsCsv, resultBundle } from '../src/simulation/integrated/Experiments'
import { identifyPreset } from '../src/simulation/integrated/Presets'

function completed(scenario: unknown) {
  const engine = new IntegratedEngine(scenario)
  engine.runAll()
  return engine.getSnapshot()
}

describe('integrated memory extensions', () => {
  it('blocks on faults, pages in through the disk, retries without double counting and frees frames', () => {
    const result = completed({ ...thrashingPreset, processes: [{ id: 'P1', arrival: 0, priority: 0, memoryPages: 1, bursts: [{ kind: 'cpu', duration: 3, references: [0, 0, 0] }] }] })
    expect(result.status).toBe('complete')
    expect(result.memory).toMatchObject({ references: 3, faults: 1, hits: 2, replacements: 0, usedFrames: 0 })
    expect(result.disk.requests).toHaveLength(1)
    expect(result.disk.requests[0]).toMatchObject({ kind: 'PAGE_IN', start: 0, service: 5, completion: 5 })
    expect(result.processes[0]).toMatchObject({ completion: 8, blocked: 5, remaining: 0 })
    expect(result.busyTicks).toBe(3)
  })

  it('demonstrates thrashing when the frame count shrinks', () => {
    const adequate = completed(thrashingPreset)
    const small = completed({ ...thrashingPreset, memory: { ...thrashingPreset.memory, frames: 1 } })
    expect(adequate.memory?.faults).toBe(3)
    expect(small.memory?.faults).toBe(60)
    expect(small.busyTicks).toBe(adequate.busyTicks)
    expect(small.utilization).toBeLessThan(adequate.utilization!)
    expect(small.memory?.hits).toBe(0)
  })

  it('compares frame counts from the same workload and records extension parameters in exports', () => {
    const rows = compareFrameCounts()
    expect(rows.map((row) => row.usefulTicks)).toEqual([60, 60, 60, 60, 60])
    expect(rows.map((row) => row.faults)).toEqual([60, 60, 3, 3, 3])
    const result = completed(thrashingPreset)
    expect(resultBundle(thrashingPreset, result).assumptions.memory).toMatchObject({ mode: 'demand', scope: 'local replacement' })
    expect(metricsCsv(thrashingPreset, result)).toContain('page_faults')
    expect(metricsCsv(thrashingPreset, result)).toContain('job_wait')
    expect(identifyPreset(parseScenario(thrashingPreset))).toBe('thrashing')
    expect(identifyPreset(parseScenario(admissionPreset))).toBe('admission')
  })

  it('sends explicit I/O and page-ins through the same non-overlapping disk', () => {
    const scenario = { ...thrashingPreset, processes: [{ id: 'P1', arrival: 0, priority: 0, memoryPages: 1, bursts: [
      { kind: 'cpu', duration: 1, references: [0] }, { kind: 'io', cylinder: 5 }, { kind: 'cpu', duration: 1, references: [0] },
    ] }] }
    const result = completed(scenario)
    expect(result.status).toBe('complete')
    expect(result.disk.requests.map((request) => request.kind)).toEqual(['PAGE_IN', 'IO'])
    expect(result.memory).toMatchObject({ references: 2, faults: 1, hits: 1 })
    expect(result.stateSegments.some((segment) => segment.reason === 'IO')).toBe(true)
    expect(result.stateSegments.some((segment) => segment.reason === 'PAGE_FAULT')).toBe(true)
  })

  it('holds jobs outside READY until termination frees enough frames', () => {
    const result = completed(admissionPreset)
    expect(result.processes[0]).toMatchObject({ admitted: 0, completion: 4 })
    expect(result.processes[1]).toMatchObject({ admitted: 4, jobWait: 4, waiting: 0, completion: 6 })
    expect(result.jobQueue).toEqual([])
    expect(result.memory?.usedFrames).toBe(0)
  })

  it('keeps frame namespaces private and time conserved with two active faulting processes', () => {
    const scenario = { ...thrashingPreset, memory: { ...thrashingPreset.memory, frames: 2 }, processes: ['P1', 'P2'].map((id) => ({ id, arrival: 0, priority: 0, memoryPages: 2, frameQuota: 1, bursts: [{ kind: 'cpu', duration: 4, references: [0, 1, 0, 1] }] })) }
    const engine = new IntegratedEngine(scenario)
    while (engine.next()) {
      const result = engine.getSnapshot()
      expect(result.processes.filter((process) => process.state === 'RUNNING').length).toBeLessThanOrEqual(1)
      expect(result.busyTicks + result.idleTicks + result.overheadTicks).toBe(result.time)
      expect(result.memory!.frames.filter((frame) => frame.owner).length).toBeLessThanOrEqual(2)
    }
    const result = engine.getSnapshot()
    expect(result.memory?.faults).toBe(8)
    for (const process of result.processes) expect(process.completion! - process.arrival).toBe(4 + process.waiting + process.blocked + process.jobWait)
    for (let index = 1; index < result.disk.requests.length; index++) expect(result.disk.requests[index].start!).toBeGreaterThanOrEqual(result.disk.requests[index - 1].completion!)
  })

  it('uses FIFO residency order and LRU access recency independently', () => {
    const scenario = { ...thrashingPreset, processes: [{ id: 'P1', arrival: 0, priority: 0, memoryPages: 5, bursts: [{ kind: 'cpu', duration: 8, references: [1, 2, 3, 1, 4, 1, 2, 0] }] }] }
    expect(completed({ ...scenario, memory: { ...scenario.memory, replacement: 'FIFO' } }).memory?.faults).toBe(7)
    expect(completed({ ...scenario, memory: { ...scenario.memory, replacement: 'LRU' } }).memory?.faults).toBe(6)
  })

  it('accounts for real switch overhead separately and penalizes tiny RR quanta', () => {
    const scenario = { ...cpuPreset, cpu: { algorithm: 'ROUND_ROBIN', quantum: 1, contextSwitchCost: 2 }, processes: ['P1', 'P2'].map((id) => ({ id, arrival: 0, priority: 0, bursts: [{ kind: 'cpu', duration: 4 }] })) }
    const tiny = completed(scenario)
    const large = completed({ ...scenario, cpu: { ...scenario.cpu, quantum: 4 } })
    expect(tiny.overheadTicks).toBe(14)
    expect(tiny.busyTicks).toBe(8)
    expect(tiny.time).toBe(22)
    expect(tiny.utilization).toBeLessThan(large.utilization!)
    expect(tiny.segments.filter((segment) => segment.pid === 'SWITCH')).toHaveLength(7)
  })

  it('resets pending page-ins and context switches without stale effects', () => {
    vi.useFakeTimers()
    try {
      const engine = new IntegratedEngine(thrashingPreset)
      engine.play(1)
      vi.advanceTimersByTime(6)
      engine.reset()
      vi.advanceTimersByTime(100)
      expect(engine.getSnapshot().processedEvents).toBe(0)
      engine.runAll()
      expect(engine.getSnapshot()).toEqual(completed(thrashingPreset))
      engine.dispose()
    } finally { vi.useRealTimers() }
  })

  it('rejects impossible quotas, oversized fixed jobs, malformed references and costs', () => {
    expect(() => parseScenario({ ...admissionPreset, memory: { ...admissionPreset.memory, frames: 2 } })).toThrow('cannot fit')
    expect(() => parseScenario({ ...thrashingPreset, processes: [{ ...thrashingPreset.processes[0], frameQuota: 4 }] })).toThrow()
    expect(() => parseScenario({ ...thrashingPreset, processes: [{ ...thrashingPreset.processes[0], bursts: [{ kind: 'cpu', duration: 2, references: [0] }] }] })).toThrow()
    expect(() => parseScenario({ ...cpuPreset, cpu: { ...cpuPreset.cpu, contextSwitchCost: -1 } })).toThrow()
  })
})
