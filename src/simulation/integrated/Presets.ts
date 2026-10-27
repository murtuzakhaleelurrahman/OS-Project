import { admissionPreset, cpuPreset, diskPreset, ioPreset, parseScenario, thrashingPreset, type Scenario } from './Scenario'

export type PresetId = 'io' | 'cpu' | 'disk' | 'thrashing' | 'admission' | 'custom'
const presets = { io: ioPreset, cpu: cpuPreset, disk: diskPreset, thrashing: thrashingPreset, admission: admissionPreset } as const
export const presetCatalog = Object.entries(presets).map(([id, scenario]) => ({ id, scenario }))

/** Match the workload and device costs; policies are independent experiment settings. */
export function identifyPreset(scenario: Scenario): PresetId {
  const normalized = parseScenario(scenario)
  for (const [id, preset] of Object.entries(presets)) {
    const sameProcesses = JSON.stringify(normalized.processes) === JSON.stringify(parseScenario(preset).processes)
    const sameDisk = (['cylinders', 'initialHead', 'baseService', 'seekCost'] as const)
      .every((key) => scenario.disk[key] === preset.disk[key])
    const sameMemory = JSON.stringify(scenario.memory) === JSON.stringify(preset.memory)
    if (sameProcesses && sameDisk && sameMemory) return id as PresetId
  }
  return 'custom'
}
