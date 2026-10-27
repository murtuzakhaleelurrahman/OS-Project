import { describe, expect, it } from 'vitest'
import { IntegratedEngine } from '../src/simulation/integrated/IntegratedEngine'
import { comparePolicies, importScenario, metricsCsv, resultBundle, traceCsv } from '../src/simulation/integrated/Experiments'
import { cpuPreset, diskPreset, ioPreset } from '../src/simulation/integrated/Scenario'

describe('reproducible experiments and exports', () => {
  it('compares all policy pairs from the identical untouched workload', () => {
    const input = structuredClone(diskPreset)
    const results = comparePolicies(input)
    expect(results).toHaveLength(48)
    expect(input).toEqual(diskPreset)
    expect(results.every((row) => row.status === 'complete')).toBe(true)
    expect(results.find((row) => row.cpu === 'FCFS' && row.disk === 'SSTF')!.diskMovement).toBeLessThan(results.find((row) => row.cpu === 'FCFS' && row.disk === 'FCFS')!.diskMovement)
    expect(comparePolicies(input)).toEqual(results)
  })
  it('exports and imports scenarios and result bundles for an identical replay', () => {
    const original = new IntegratedEngine(ioPreset); original.runAll()
    const bundle = resultBundle(ioPreset, original.getSnapshot())
    const replay = new IntegratedEngine(importScenario(JSON.stringify(bundle))); replay.runAll()
    expect(replay.getSnapshot()).toEqual(original.getSnapshot())
    expect(importScenario(JSON.stringify(ioPreset))).toEqual(ioPreset)
    expect(bundle.assumptions.contextSwitchCost).toBe(0)
  })
  it('exports trace and metrics with policy parameters, units, assumptions and safe CSV fields', () => {
    const scenario = { ...cpuPreset, name: '=formula, "quoted"' }
    const engine = new IntegratedEngine(scenario); engine.runAll()
    const trace = traceCsv(scenario, engine.getSnapshot())
    const metrics = metricsCsv(scenario, engine.getSnapshot())
    expect(trace).toContain('phase_order')
    expect(trace).toContain('cpu_ties')
    expect(trace).toContain(`'=formula, ""quoted""`)
    expect(metrics).toContain('throughput_processes_per_tick')
    expect(metrics.split('\r\n')).toHaveLength(5)
  })
  it('labels incomplete comparisons and rejects oversized imports', () => {
    expect(comparePolicies({ ...cpuPreset, eventLimit: 1 }).every((row) => row.status === 'limit' && row.averageWaiting === null)).toBe(true)
    expect(() => importScenario(' '.repeat(1_000_001))).toThrow('1 MB')
  })
})
