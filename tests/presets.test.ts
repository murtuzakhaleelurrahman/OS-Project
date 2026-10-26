import { describe, expect, it } from 'vitest'
import { identifyPreset } from '../src/simulation/integrated/Presets'
import { cpuPreset, diskPreset, ioPreset, parseScenario } from '../src/simulation/integrated/Scenario'

describe('preset workload identification', () => {
  it('recognizes each built-in workload after schema normalization', () => {
    expect(identifyPreset(parseScenario(ioPreset))).toBe('io')
    expect(identifyPreset(parseScenario(cpuPreset))).toBe('cpu')
    expect(identifyPreset(parseScenario(diskPreset))).toBe('disk')
  })
  it('labels an edited workload as custom even when its name is unchanged', () => {
    const custom = { ...ioPreset, processes: [{ ...ioPreset.processes[0], bursts: [{ kind: 'cpu' as const, duration: 9 }] }, ioPreset.processes[1]] }
    expect(identifyPreset(custom)).toBe('custom')
    expect(identifyPreset({ ...ioPreset, disk: { ...ioPreset.disk, seekCost: 5 } })).toBe('custom')
  })
  it('keeps workload identity when only policies, quantum or display name change', () => {
    expect(identifyPreset({ ...ioPreset, name: 'renamed', cpu: { algorithm: 'SJF', quantum: 3 }, disk: { ...ioPreset.disk, algorithm: 'SSTF' } })).toBe('io')
  })
})
