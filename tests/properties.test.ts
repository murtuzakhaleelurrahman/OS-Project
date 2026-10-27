import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { IntegratedEngine, type IntegratedSnapshot } from '../src/simulation/integrated/IntegratedEngine'
import { cpuPreset, parseScenario, type Scenario } from '../src/simulation/integrated/Scenario'
import { integratedCpuPolicies } from '../src/simulation/shared/CpuPolicy'
import { integratedDiskPolicies } from '../src/simulation/integrated/DiskPolicy'
import { replayToEvent, scenarioFragment, scenarioFromFragment } from '../src/simulation/integrated/LearningExperiments'

const script = fc.record({
  arrival: fc.integer({ min: 0, max: 7 }), priority: fc.integer({ min: 0, max: 5 }),
  pages: fc.integer({ min: 1, max: 3 }), quota: fc.integer({ min: 1, max: 3 }),
  first: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 5 }),
  second: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 5 }),
  cylinder: fc.integer({ min: 0, max: 19 }),
})
const workload = fc.record({
  mode: fc.constantFrom('none', 'fixed', 'demand'), frames: fc.integer({ min: 1, max: 6 }),
  replacement: fc.constantFrom('FIFO', 'LRU'), pageInTicks: fc.integer({ min: 0, max: 3 }),
  quantum: fc.integer({ min: 1, max: 4 }), cost: fc.integer({ min: 0, max: 3 }),
  seek: fc.integer({ min: 0, max: 2 }), base: fc.integer({ min: 0, max: 2 }),
  direction: fc.constantFrom('UP', 'DOWN'),
  actors: fc.array(script, { minLength: 1, maxLength: 4 }),
}).map((value) => parseScenario({
  ...cpuPreset, name: 'Property workload',
  cpu: { algorithm: 'FCFS', quantum: value.quantum, contextSwitchCost: value.cost, agingInterval: 2, mlfqQuanta: [1, 2, 4], boostInterval: 7 },
  disk: { algorithm: 'FCFS', cylinders: 20, initialHead: 10, baseService: value.base, seekCost: value.seek, initialDirection: value.direction },
  memory: value.mode === 'none' ? undefined : { mode: value.mode, frames: value.frames, pageSize: 64, replacement: value.replacement, pageInTicks: value.pageInTicks, pageInCylinder: 5 },
  processes: value.actors.map((actor, index) => {
    const pages = Math.min(actor.pages, value.frames)
    const burst = (references: number[]) => ({ kind: 'cpu', duration: references.length, ...(value.mode === 'none' ? {} : { references: references.map((page) => page % pages) }) })
    return { id: `P${index + 1}`, arrival: actor.arrival, priority: actor.priority,
      ...(value.mode === 'none' ? {} : { memoryPages: pages, frameQuota: value.mode === 'fixed' ? pages : Math.min(actor.quota, pages) }),
      bursts: [burst(actor.first), { kind: 'io', cylinder: actor.cylinder }, burst(actor.second)],
    }
  }),
}))

function assertSnapshot(snapshot: IntegratedSnapshot, scenario: Scenario): void {
  const runners = snapshot.processes.filter((process) => process.state === 'RUNNING')
  expect(runners.length).toBeLessThanOrEqual(1)
  expect(snapshot.running).toBe(runners[0]?.id)
  expect(new Set(snapshot.ready).size).toBe(snapshot.ready.length)
  expect(snapshot.ready.every((id) => snapshot.processes.find((process) => process.id === id)?.state === 'READY')).toBe(true)
  expect(snapshot.busyTicks + snapshot.idleTicks + snapshot.overheadTicks).toBe(snapshot.time)
  for (const process of snapshot.processes) {
    expect(Math.min(process.waiting, process.blocked, process.jobWait, process.remaining)).toBeGreaterThanOrEqual(0)
    if (process.completion !== undefined) {
      const productive = process.bursts.reduce((sum, burst) => sum + (burst.kind === 'cpu' ? burst.duration : 0), 0)
      expect(process.completion - process.arrival).toBe(productive + process.waiting + process.blocked + process.jobWait)
    }
  }
  let cursor = 0
  for (const segment of snapshot.segments) {
    expect(segment.start).toBe(cursor)
    expect(segment.end).toBeGreaterThan(segment.start)
    cursor = segment.end
  }
  expect(cursor).toBe(snapshot.time)
  const scheduled = snapshot.disk.requests.filter((request) => request.start !== undefined).sort((a, b) => a.start! - b.start! || a.id - b.id)
  for (let index = 0; index < scheduled.length; index++) {
    const request = scheduled[index]
    if (index) expect(request.start!).toBeGreaterThanOrEqual(scheduled[index - 1].completion!)
    const path = [index ? scheduled[index - 1].cylinder : scenario.disk.initialHead, ...request.path!]
    const movement = path.slice(1).reduce((sum, cylinder, step) => sum + Math.abs(cylinder - path[step]), 0)
    expect(request.movement).toBe(movement)
    expect(request.service).toBe(Math.max(1, scenario.disk.baseService + scenario.disk.seekCost * movement + (request.kind === 'PAGE_IN' ? scenario.memory!.pageInTicks : 0)))
  }
  if (snapshot.memory) {
    expect(snapshot.memory.references).toBe(snapshot.memory.hits + snapshot.memory.faults)
    expect(snapshot.memory.usedFrames).toBe(snapshot.memory.frames.filter((frame) => frame.owner !== undefined).length)
    expect(snapshot.memory.frames.every((frame) => !frame.owner || snapshot.processes.some((process) => process.id === frame.owner && !['TERMINATED', 'NEW', 'JOB'].includes(process.state)))).toBe(true)
  }
}

describe('generated integrated invariants', () => {
  for (const [cpuIndex, cpu] of integratedCpuPolicies.entries()) for (const [diskIndex, disk] of integratedDiskPolicies.entries()) {
    it(`${cpu} / ${disk}: preserves state, time, memory and disk conservation`, () => {
      fc.assert(fc.property(workload, (input) => {
        const scenario = parseScenario({ ...input, cpu: { ...input.cpu, algorithm: cpu }, disk: { ...input.disk, algorithm: disk } })
        const engine = new IntegratedEngine(scenario)
        do { assertSnapshot(engine.getSnapshot(), scenario) } while (engine.next())
        const result = engine.getSnapshot()
        expect(result.status).toBe('complete')
        expect(result.memory?.usedFrames ?? 0).toBe(0)
        if (scenario.memory?.mode === 'demand') expect(result.memory!.references).toBe(result.busyTicks)
        engine.reset(); engine.runAll()
        expect(engine.getSnapshot()).toEqual(result)
        engine.dispose()
      }), { numRuns: 20, seed: 20261027 + cpuIndex * 6 + diskIndex })
    }, 30_000)
  }
  it('generated sharing and replay round-trips retain an identical future', () => {
    fc.assert(fc.property(workload, fc.integer({ min: 0, max: 100 }), (scenario, index) => {
      expect(scenarioFromFragment(scenarioFragment(scenario))).toEqual(scenario)
      const original = new IntegratedEngine(scenario)
      original.runAll()
      const replay = replayToEvent(scenario, index)
      replay.runAll()
      expect(replay.getSnapshot()).toEqual(original.getSnapshot())
      original.dispose(); replay.dispose()
    }), { numRuns: 60, seed: 20261028 })
  })
})
