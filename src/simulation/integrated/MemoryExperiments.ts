import { IntegratedEngine } from './IntegratedEngine'
import { thrashingPreset } from './Scenario'

export interface ThrashingRow {
  frames: number
  faults: number
  hits: number
  elapsed: number
  usefulTicks: number
  utilization: number
}

/** Identical sixty-reference workload, changing only the number of physical frames. */
export function compareFrameCounts(): ThrashingRow[] {
  return [1, 2, 3, 4, 6].map((frames) => {
    const engine = new IntegratedEngine({
      ...thrashingPreset, memory: { ...thrashingPreset.memory, frames },
    })
    engine.runAll()
    const result = engine.getSnapshot()
    engine.dispose()
    if (result.status !== 'complete') throw new Error('Thrashing benchmark exceeded its event limit')
    return {
      frames, faults: result.memory!.faults, hits: result.memory!.hits,
      elapsed: result.time, usefulTicks: result.busyTicks, utilization: result.utilization!,
    }
  })
}
