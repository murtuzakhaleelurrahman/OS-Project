import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { balancePreset, compareBalancing, migrationPreset, MultiCore, multiCorePolicies, parseMultiScenario } from '../src/simulation/scheduling/MultiCore'
import { compareRealtime, feasibleRealtime, overloadedRealtime, parseRealtime, Realtime, realtimePreset, utilizationBounds } from '../src/simulation/scheduling/Realtime'
import { IntegratedEngine } from '../src/simulation/integrated/IntegratedEngine'
import { cpuPreset } from '../src/simulation/integrated/Scenario'

function assertMulti(lab: MultiCore): void {
  const snapshot = lab.snapshot(), allMembership = snapshot.cores.flatMap((core) => [...core.ready, ...(core.running ? [core.running] : []), ...(core.target ? [core.target] : [])])
  expect(new Set(allMembership).size).toBe(allMembership.length)
  expect(snapshot.cores.reduce((sum, core) => sum + core.busy, 0)).toBe(snapshot.tasks.reduce((sum, task) => sum + task.executed, 0))
  for (const core of snapshot.cores) {
    expect(core.busy + core.idle + core.overhead).toBe(snapshot.time)
    let end = 0
    for (const segment of core.segments) { expect(segment.start).toBe(end); expect(segment.end).toBeGreaterThan(segment.start); end = segment.end }
    expect(end).toBe(snapshot.time)
    expect(core.segments.filter((segment) => segment.label === 'IDLE').reduce((sum, segment) => sum + segment.end - segment.start, 0)).toBe(core.idle)
    expect(core.segments.filter((segment) => segment.label === 'SWITCH').reduce((sum, segment) => sum + segment.end - segment.start, 0)).toBe(core.overhead)
    for (const id of core.ready) expect(snapshot.tasks.find((task) => task.id === id)).toMatchObject({ state: 'READY', core: core.id })
    if (core.running) expect(snapshot.tasks.find((task) => task.id === core.running)).toMatchObject({ state: 'RUNNING', core: core.id })
    if (core.target) expect(snapshot.tasks.find((task) => task.id === core.target)).toMatchObject({ state: 'DISPATCHING', core: core.id })
  }
  for (const task of snapshot.tasks) {
    expect(task.executed + task.remaining).toBe(task.burst)
    expect(task.waiting).toBeGreaterThanOrEqual(0)
    expect(allMembership.filter((id) => id === task.id)).toHaveLength(['NEW', 'TERMINATED'].includes(task.state) ? 0 : 1)
    expect(task.executed + task.waiting).toBe(task.state === 'NEW' ? 0 : (task.completion ?? snapshot.time) - task.arrival)
    const spans = snapshot.cores.flatMap((core) => core.segments.filter((segment) => segment.label === task.id).map((segment) => ({ ...segment, core: core.id }))).sort((a, b) => a.start - b.start)
    expect(spans.reduce((sum, span) => sum + span.end - span.start, 0)).toBe(task.executed)
    expect(spans.filter((span, index) => index > 0 && span.core !== spans[index - 1].core)).toHaveLength(task.migrations)
    for (let index = 1; index < spans.length; index++) expect(spans[index].start).toBeGreaterThanOrEqual(spans[index - 1].end)
  }
}

describe('multicore scheduling', () => {
  it('balances the same four jobs in 16 versus 32 ticks', () => {
    const before = structuredClone(balancePreset)
    expect(compareBalancing(balancePreset)).toMatchObject([
      { balancing: 'OFF', status: 'complete', elapsed: 32, utilization: 50, transfers: 0, migrations: 0 },
      { balancing: 'STEAL', status: 'complete', elapsed: 16, utilization: 100, transfers: 2, migrations: 0 },
    ])
    expect(balancePreset).toEqual(before)
  })
  it('counts migration after actual prior service and charges its overhead', () => {
    const lab = new MultiCore(migrationPreset); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ time: 10, status: 'complete', transfers: 2, migrations: 1 })
    expect(lab.snapshot().cores[0]).toMatchObject({ busy: 8, overhead: 2, idle: 0 })
    expect(lab.snapshot().tasks[1]).toMatchObject({ executed: 8, waiting: 2, completion: 10, migrations: 1 })
    assertMulti(lab)
  })
  it('charges direct switch cost, but not initial, same-task RR or post-idle dispatch', () => {
    const tasks = [{ id: 'A', arrival: 0, burst: 1, priority: 0 }, { id: 'B', arrival: 0, burst: 1, priority: 0 }]
    const lab = new MultiCore({ ...balancePreset, cores: 1, switchCost: 2, tasks }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ time: 4 })
    expect(lab.snapshot().cores[0].segments).toEqual([{ label: 'A', start: 0, end: 1 }, { label: 'SWITCH', start: 1, end: 3 }, { label: 'B', start: 3, end: 4 }])
    expect(lab.snapshot().tasks[1]).toMatchObject({ waiting: 3, firstStart: 3 })
    const idle = new MultiCore({ ...lab.scenario, tasks: [tasks[0], { ...tasks[1], arrival: 3 }] }); idle.runAll(); expect(idle.snapshot().cores[0].overhead).toBe(0)
    const rr = new MultiCore({ ...lab.scenario, policy: 'ROUND_ROBIN', quantum: 1, tasks: [{ ...tasks[0], burst: 3 }] }); rr.runAll(); expect(rr.snapshot().cores[0].overhead).toBe(0)
  })
  it('admits arrivals before RR expiry and lets exact completion win', () => {
    const lab = new MultiCore({ ...balancePreset, cores: 1, policy: 'ROUND_ROBIN', tasks: [{ id: 'A', arrival: 0, burst: 4, priority: 0 }, { id: 'B', arrival: 2, burst: 1, priority: 0 }] }); lab.runAll()
    expect(lab.snapshot().tasks[1].firstStart).toBe(2)
    const exact = new MultiCore({ ...lab.scenario, tasks: [{ id: 'A', arrival: 0, burst: 2, priority: 0 }, { id: 'B', arrival: 2, burst: 1, priority: 0 }] }); exact.runAll()
    expect(exact.snapshot().tasks[0].completion).toBe(2); expect(exact.snapshot().tasks[1].firstStart).toBe(2)
  })
  it('reconsiders better arrivals during switching before doing productive service', () => {
    const lab = new MultiCore({ ...balancePreset, cores: 1, policy: 'SRTF', switchCost: 2, tasks: [{ id: 'A', arrival: 0, burst: 1, priority: 0 }, { id: 'B', arrival: 0, burst: 5, priority: 0 }, { id: 'C', arrival: 2, burst: 1, priority: 0 }] }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ time: 13 })
    expect(lab.snapshot().tasks[1]).toMatchObject({ firstStart: 8, waiting: 8, completion: 13 })
    expect(lab.snapshot().tasks[2].firstStart).toBe(5)
    assertMulti(lab)
  })
  it('caps multicore trace retention without losing work accounting', () => {
    const lab = new MultiCore({ ...balancePreset, cores: 1, policy: 'ROUND_ROBIN', quantum: 1, maxTicks: 1000, tasks: [{ id: 'A', arrival: 0, burst: 600, priority: 0 }] }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ time: 600, status: 'complete' }); expect(lab.snapshot().trace).toHaveLength(500); assertMulti(lab)
  })
  it.each(['SRTF', 'PREEMPTIVE_PRIORITY'] as const)('%s preempts only for a strictly better local candidate', (policy) => {
    const lab = new MultiCore({ ...balancePreset, cores: 1, policy, tasks: [{ id: 'A', arrival: 0, burst: 5, priority: 5 }, { id: 'B', arrival: 1, burst: 2, priority: 0 }] }); lab.runAll()
    expect(lab.snapshot().cores[0].segments).toEqual([{ label: 'A', start: 0, end: 1 }, { label: 'B', start: 1, end: 3 }, { label: 'A', start: 3, end: 7 }])
    const tie = new MultiCore({ ...lab.scenario, tasks: [{ id: 'A', arrival: 0, burst: 4, priority: 0 }, { id: 'B', arrival: 2, burst: 2, priority: 0 }] }); tie.runAll()
    expect(tie.snapshot().tasks[1].firstStart).toBe(4)
  })
  it('uses least remaining load without explicit home queues, respects intervals and bounds prefixes', () => {
    const tasks = [{ id: 'A', arrival: 2, burst: 8, priority: 0, initialCore: 0 }, { id: 'B', arrival: 2, burst: 2, priority: 0, initialCore: 0 }]
    const lab = new MultiCore({ ...balancePreset, balanceInterval: 5, tasks }); lab.runAll()
    expect(lab.snapshot().tasks[1].firstStart).toBe(5)
    const assigned = new MultiCore({ ...balancePreset, balancing: 'OFF', tasks: tasks.map(({ initialCore: _home, ...task }) => { void _home; return { ...task, arrival: 0 } }) })
    expect(assigned.snapshot().tasks.map((task) => task.core)).toEqual([0, 1])
    const limited = new MultiCore({ ...balancePreset, maxTicks: 1 }); limited.runAll(); expect(limited.snapshot().status).toBe('limit'); expect(limited.next()).toBe(false); assertMulti(limited)
    expect(compareBalancing(limited.scenario).every((row) => row.averageWaiting === null)).toBe(true)
    const empty = new MultiCore({ ...balancePreset, tasks: [] }); expect(empty.next()).toBe(false); expect(empty.snapshot().utilization).toBeNull()
  })
  it('validates settings and keeps snapshots and captured input independent', () => {
    for (const patch of [{ cores: 0 }, { cores: 9 }, { quantum: 0 }, { balanceInterval: 0 }, { migrationCost: -1 }, { switchCost: 21 }, { maxTicks: 0 }, { policy: 'MLFQ' }, { balancing: 'UNKNOWN' }, { name: '' }, { tasks: {} }, { tasks: [null] }, { tasks: [{ id: 'A', arrival: 0, burst: 0, priority: 0 }] }, { tasks: [balancePreset.tasks[0], balancePreset.tasks[0]] }, { tasks: [{ ...balancePreset.tasks[0], initialCore: 99 }] }, { tasks: [{ ...balancePreset.tasks[0], id: 'IDLE' }] }]) expect(() => parseMultiScenario({ ...balancePreset, ...patch })).toThrow()
    expect(() => parseMultiScenario(null)).toThrow()
    const scenario = structuredClone(balancePreset), lab = new MultiCore(scenario); scenario.tasks[0].burst = 999
    const snapshot = lab.snapshot(); snapshot.cores[0].ready.length = 0
    expect(lab.scenario.tasks[0].burst).toBe(8); expect(lab.snapshot().cores[0].ready.length).toBeGreaterThan(0)
  })
  for (const policy of multiCorePolicies) it(`${policy}: generated per-tick ownership and time conservation`, () => {
    fc.assert(fc.property(fc.array(fc.record({ arrival: fc.integer({ min: 0, max: 8 }), burst: fc.integer({ min: 1, max: 8 }), priority: fc.integer({ min: 0, max: 3 }) }), { maxLength: 6 }), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 3 }), (tasks, cores, cost) => {
      const scenario = { ...balancePreset, cores, policy, switchCost: cost, migrationCost: cost, tasks: tasks.map((task, index) => ({ ...task, id: `P${index}`, initialCore: 0 })) }
      const lab = new MultiCore(scenario)
      do { assertMulti(lab) } while (lab.next())
      expect(lab.snapshot().status).toBe('complete')
      const again = new MultiCore(scenario); again.runAll(); expect(again.snapshot()).toEqual(lab.snapshot())
      if (cores === 1) {
        const integrated = new IntegratedEngine({ ...cpuPreset, cpu: { algorithm: policy, quantum: scenario.quantum, contextSwitchCost: cost }, processes: scenario.tasks.map((task) => ({ id: task.id, arrival: task.arrival, priority: task.priority, bursts: [{ kind: 'cpu', duration: task.burst }] })) }); integrated.runAll()
        expect(lab.snapshot().time).toBe(integrated.getSnapshot().time)
        for (const task of lab.snapshot().tasks) expect(integrated.getSnapshot().processes.find((process) => process.id === task.id)).toMatchObject({ completion: task.completion, waiting: task.waiting })
      }
    }), { numRuns: 30, seed: 20261101 + multiCorePolicies.indexOf(policy) })
  }, 30_000)
})

describe('periodic EDF and rate-monotonic scheduling', () => {
  it('distinguishes EDF and RM on the high-utilization implicit-deadline oracle', () => {
    const result = compareRealtime(realtimePreset)
    expect(result[0]).toMatchObject({ policy: 'EDF', misses: 0, releases: 12, completed: 12 })
    expect(result[1].misses).toBeGreaterThan(0)
    expect(utilizationBounds(realtimePreset)).toMatchObject({ applicable: true, rmSufficient: false, edfFeasible: true })
    expect(utilizationBounds(realtimePreset).utilization).toBeCloseTo(34 / 35)
  })
  it.each(['EDF', 'RM'] as const)('%s meets all deadlines below the sufficient bound', (policy) => {
    const lab = new Realtime({ ...feasibleRealtime, policy }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ busy: 13, idle: 7, misses: 0, completed: 9, pendingDeadlines: 0 })
    expect(lab.snapshot().jobs).toHaveLength(9)
    expect(utilizationBounds(feasibleRealtime).rmBound).toBeCloseTo(2 * (Math.sqrt(2) - 1))
    expect(utilizationBounds(feasibleRealtime).rmSufficient).toBe(true)
  })
  it('counts completion at the deadline as on-time and excludes releases at the horizon', () => {
    const lab = new Realtime({ ...realtimePreset, horizon: 2, tasks: [{ id: 'A', execution: 2, period: 2, deadline: 2, offset: 0 }] }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ misses: 0, onTime: 1, completed: 1 }); expect(lab.snapshot().jobs).toHaveLength(1)
    expect(lab.snapshot().jobs[0].completion).toBe(2)
  })
  it('uses release age for equal EDF deadlines and fixed task IDs for equal RM periods', () => {
    const tasks = [{ id: 'B', execution: 2, period: 4, deadline: 4, offset: 0 }, { id: 'A', execution: 1, period: 3, deadline: 3, offset: 1 }]
    const edf = new Realtime({ ...realtimePreset, horizon: 3, tasks }); edf.runAll()
    expect(edf.snapshot().segments).toEqual([{ label: 'B#1', start: 0, end: 2 }, { label: 'A#1', start: 2, end: 3 }])
    const rm = new Realtime({ ...edf.scenario, policy: 'RM' }); rm.runAll()
    expect(rm.snapshot().segments).toEqual([{ label: 'B#1', start: 0, end: 1 }, { label: 'A#1', start: 1, end: 2 }, { label: 'B#1', start: 2, end: 3 }])
    for (const policy of ['EDF', 'RM'] as const) {
      const tie = new Realtime({ ...realtimePreset, policy, horizon: 2, tasks: ['P10', 'P2'].map((id) => ({ id, execution: 1, period: 4, deadline: 4, offset: 0 })) }); tie.runAll()
      expect(tie.snapshot().segments[0].label).toBe('P2#1')
    }
  })
  it('retains overlapping overdue jobs and separates future pending deadlines', () => {
    const lab = new Realtime({ ...realtimePreset, horizon: 5, tasks: [{ id: 'A', execution: 3, period: 2, deadline: 2, offset: 0 }] }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ misses: 2, completed: 1, pendingDeadlines: 1 })
    expect(lab.snapshot().jobs.map((job) => job.remaining)).toEqual([0, 1, 3])
    expect(utilizationBounds(overloadedRealtime).edfFeasible).toBe(false)
    expect(compareRealtime(overloadedRealtime).every((row) => row.misses > 0)).toBe(true)
  })
  it('supports offsets/constrained deadlines without misapplying utilization proofs', () => {
    const lab = new Realtime({ ...realtimePreset, horizon: 4, tasks: [{ id: 'A', execution: 2, period: 5, deadline: 1, offset: 1 }] }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ misses: 1, busy: 2, idle: 2 })
    expect(utilizationBounds(lab.scenario)).toMatchObject({ applicable: false, rmSufficient: null, edfFeasible: null })
    const empty = new Realtime({ ...realtimePreset, tasks: [] }); empty.runAll(); expect(empty.snapshot().idle).toBe(35); expect(utilizationBounds(empty.scenario).rmBound).toBeNull()
  })
  it('bounds releases/trace and stops before adding a partial release batch', () => {
    const lab = new Realtime({ ...realtimePreset, horizon: 500, tasks: Array.from({ length: 16 }, (_, index) => ({ id: `P${index}`, execution: 1, period: 1, deadline: 1, offset: 0 })) }); lab.runAll()
    expect(lab.snapshot()).toMatchObject({ time: 250, status: 'limit' }); expect(lab.snapshot().jobs).toHaveLength(4000); expect(lab.snapshot().trace).toHaveLength(500)
    expect(lab.next()).toBe(false)
  })
  it('validates periodic scenarios and isolates snapshots', () => {
    for (const patch of [{ name: '' }, { policy: 'FCFS' }, { horizon: 0 }, { tasks: null }, { tasks: [null] }, { tasks: Array(17).fill(realtimePreset.tasks[0]) }, { tasks: [realtimePreset.tasks[0], realtimePreset.tasks[0]] }, { tasks: [{ ...realtimePreset.tasks[0], deadline: 6 }] }, { tasks: [{ ...realtimePreset.tasks[0], period: 0 }] }, { tasks: [{ ...realtimePreset.tasks[0], execution: 0 }] }, { tasks: [{ ...realtimePreset.tasks[0], offset: -1 }] }]) expect(() => parseRealtime({ ...realtimePreset, ...patch })).toThrow()
    expect(() => parseRealtime([])).toThrow()
    const lab = new Realtime(), snapshot = lab.snapshot(); snapshot.jobs[0].remaining = 999
    expect(lab.snapshot().jobs[0].remaining).toBe(2)
  })
  it.each(['EDF', 'RM'] as const)('%s generated release, work, waiting and deadline conservation', (policy) => {
    const tasks = fc.array(fc.record({ execution: fc.integer({ min: 1, max: 5 }), period: fc.integer({ min: 1, max: 8 }), deadline: fc.integer({ min: 1, max: 8 }), offset: fc.integer({ min: 0, max: 5 }) }), { maxLength: 5 })
    fc.assert(fc.property(tasks, fc.integer({ min: 1, max: 30 }), (raw, horizon) => {
      const scenario = { ...realtimePreset, policy, horizon, tasks: raw.map((task, index) => ({ ...task, id: `P${index}`, deadline: Math.min(task.period, task.deadline) })) }
      const lab = new Realtime(scenario)
      do {
        const snapshot = lab.snapshot()
        expect(snapshot.busy + snapshot.idle).toBe(snapshot.time)
        expect(new Set(snapshot.jobs.map((job) => job.id)).size).toBe(snapshot.jobs.length)
        expect(snapshot.jobs.reduce((sum, job) => sum + job.execution - job.remaining, 0)).toBe(snapshot.busy)
        for (const job of snapshot.jobs) {
          expect(job.execution - job.remaining + job.waiting).toBe((job.completion ?? snapshot.time) - job.release)
          expect(job.missed).toBe(job.deadline <= snapshot.time && (job.completion === undefined || job.completion > job.deadline))
          expect(job.remaining).toBeGreaterThanOrEqual(0)
          const work = snapshot.segments.filter((segment) => segment.label === job.id).reduce((sum, segment) => sum + segment.end - segment.start, 0)
          expect(work).toBe(job.execution - job.remaining)
        }
      } while (lab.next())
      const result = lab.snapshot()
      const releases = scenario.tasks.reduce((sum, task) => sum + (task.offset >= horizon ? 0 : Math.floor((horizon - 1 - task.offset) / task.period) + 1), 0)
      expect(result.jobs).toHaveLength(releases)
      const again = new Realtime(scenario); again.runAll(); expect(again.snapshot()).toEqual(result)
      for (let tick = 0; tick < horizon; tick++) {
        const runner = result.segments.find((segment) => segment.start <= tick && segment.end > tick)!.label
        const ready = result.jobs.filter((job) => job.release <= tick && (job.completion === undefined || job.completion > tick))
        if (!ready.length) expect(runner).toBe('IDLE')
        else {
          const job = ready.find((candidate) => candidate.id === runner)!
          expect(job).toBeDefined()
          const rank = (candidate: typeof job) => policy === 'EDF' ? candidate.deadline : candidate.period
          expect(rank(job)).toBe(Math.min(...ready.map(rank)))
        }
      }
    }), { numRuns: 60, seed: policy === 'EDF' ? 20261105 : 20261106 })
  })
})
