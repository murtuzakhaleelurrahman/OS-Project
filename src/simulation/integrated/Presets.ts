import { cpuPreset, diskPreset, ioPreset, type Scenario } from './Scenario'

export type PresetId = 'io' | 'cpu' | 'disk' | 'custom'
const presets = { io: ioPreset, cpu: cpuPreset, disk: diskPreset } as const

/** Match the workload and device costs; policies are independent experiment settings. */
export function identifyPreset(scenario: Scenario): PresetId {
  for (const [id, preset] of Object.entries(presets)) {
    const sameProcesses = JSON.stringify(scenario.processes) === JSON.stringify(preset.processes)
    const sameDisk = (['cylinders', 'initialHead', 'baseService', 'seekCost'] as const)
      .every((key) => scenario.disk[key] === preset.disk[key])
    if (sameProcesses && sameDisk) return id as PresetId
  }
  return 'custom'
}
