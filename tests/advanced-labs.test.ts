import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { chainPreset, deadlockPreset, detectDeadlock, validateLocks } from '../src/simulation/resources/Deadlock'
import { Philosophers } from '../src/simulation/synchronization/Philosophers'
import { serialEmat, TlbLaboratory, tlbConfiguration, tlbSpaces } from '../src/simulation/memory/TlbLaboratory'

describe('single-instance wait-for detection', () => {
  it('distinguishes actual cycle members from processes waiting behind a cycle', () => {
    expect(detectDeadlock(deadlockPreset)).toMatchObject({ hasDeadlock: true, deadlocked: ['P1', 'P2'], dependent: ['P3'], components: [['P1', 'P2']] })
    expect(detectDeadlock(chainPreset)).toMatchObject({ hasDeadlock: false, deadlocked: [], dependent: [] })
  })
  it('handles free resources, empty graphs and non-recursive self-deadlock', () => {
    expect(detectDeadlock({ processes: [], resources: [], requests: [] }).hasDeadlock).toBe(false)
    expect(detectDeadlock({ ...deadlockPreset, resources: deadlockPreset.resources.map((resource) => ({ ...resource, owner: null })) }).edges).toEqual([])
    expect(detectDeadlock({ processes: ['P'], resources: [{ id: 'R', instances: 1, owner: 'P' }], requests: [{ pid: 'P', resource: 'R' }] }).deadlocked).toEqual(['P'])
  })
  it('finds disjoint cycles and overlapping cycles within one strongly connected group', () => {
    const state = { processes: ['A', 'B', 'C', 'D', 'E'], resources: ['A', 'B', 'C', 'D', 'E'].map((owner) => ({ id: `R${owner}`, instances: 1, owner })), requests: [
      { pid: 'A', resource: 'RB' }, { pid: 'B', resource: 'RA' }, { pid: 'C', resource: 'RD' }, { pid: 'D', resource: 'RC' }, { pid: 'E', resource: 'RC' },
    ] }
    expect(detectDeadlock(state)).toMatchObject({ deadlocked: ['A', 'B', 'C', 'D'], dependent: ['E'] })
    state.requests.push({ pid: 'B', resource: 'RC' }, { pid: 'D', resource: 'RA' })
    expect(detectDeadlock(state).components).toEqual([['A', 'B', 'C', 'D']])
  })
  it('returns defensive, deterministic results and does not change the input', () => {
    const before = structuredClone(deadlockPreset)
    const result = detectDeadlock(deadlockPreset)
    result.state.resources[0].owner = null
    expect(deadlockPreset).toEqual(before)
    expect(detectDeadlock(deadlockPreset)).toEqual(detectDeadlock(deadlockPreset))
  })
  it('rejects multi-instance, duplicate, malformed and unknown references', () => {
    for (const value of [null, [], {}, { ...deadlockPreset, processes: ['P1', 'P1'] }, { ...deadlockPreset, processes: ['invalid id'] },
      { ...deadlockPreset, resources: [{ id: 'R1', instances: 2, owner: 'P1' }] }, { ...deadlockPreset, resources: [null] },
      { ...deadlockPreset, resources: [{ id: '', instances: 1, owner: null }] }, { ...deadlockPreset, resources: [{ id: 'R1', instances: 1, owner: 'missing' }] },
      { ...deadlockPreset, resources: [...deadlockPreset.resources, deadlockPreset.resources[0]] }, { ...deadlockPreset, requests: [{ pid: 'P1', resource: 'missing' }] },
      { ...deadlockPreset, requests: [...deadlockPreset.requests, deadlockPreset.requests[0]] }, { ...deadlockPreset, requests: null },
      { ...deadlockPreset, resources: null }, { ...deadlockPreset, processes: Array.from({ length: 33 }, (_, i) => `P${i}`) },
    ]) expect(() => validateLocks(value)).toThrow()
  })
  it('matches an independent transitive-closure oracle on generated graphs', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: -1, max: 7 }), { minLength: 1, maxLength: 8 }), (targets) => {
      const n = targets.length
      const state = { processes: targets.map((_, i) => `P${i}`), resources: targets.map((_, i) => ({ id: `R${i}`, instances: 1, owner: `P${i}` })), requests: targets.flatMap((target, i) => target < 0 ? [] : [{ pid: `P${i}`, resource: `R${target % n}` }]) }
      const reach = targets.map((target) => Array.from({ length: n }, (_, j) => target >= 0 && target % n === j))
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) reach[i][j] ||= reach[i][k] && reach[k][j]
      const result = detectDeadlock(state)
      expect(result.deadlocked).toEqual(state.processes.filter((_, i) => reach[i][i]))
      expect(result.dependent).toEqual(state.processes.filter((_, i) => !reach[i][i] && reach[i].some((yes, j) => yes && reach[j][j])))
    }), { numRuns: 100, seed: 20261029 })
  })
})

describe('dining philosophers', () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10]) for (const policy of ['NAIVE', 'ORDERED'] as const) {
    it(`${policy} with ${count} philosophers conserves fork ownership at every step`, () => {
      const lab = new Philosophers(policy, count)
      do {
        const snapshot = lab.snapshot()
        snapshot.actors.forEach((actor, index) => {
          const pair = [index, (index + 1) % count]
          if (policy === 'ORDERED') pair.sort((a, b) => a - b)
          const expected = actor.stage === 1 || actor.stage === 4 ? [pair[0]] : actor.stage === 2 || actor.stage === 3 ? pair : []
          expect(snapshot.owners.flatMap((owner, fork) => owner === actor.id ? [fork] : []).sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b))
          expect(actor.meals).toBe(actor.stage >= 3 ? 1 : 0)
        })
        if (policy === 'ORDERED') expect(snapshot.detection.hasDeadlock).toBe(false)
      } while (lab.next())
      const result = lab.snapshot()
      expect(result.status).toBe(policy === 'NAIVE' ? 'deadlocked' : 'complete')
      expect(result.actors.reduce((sum, actor) => sum + actor.meals, 0)).toBe(policy === 'NAIVE' ? 0 : count)
      if (policy === 'NAIVE') { expect(result.step).toBe(count * 2); expect(result.detection.deadlocked).toHaveLength(count) }
      else expect(result.owners.every((owner) => owner === null)).toBe(true)
      expect(lab.next()).toBe(false)
      const again = new Philosophers(policy, count); again.runAll(); expect(again.snapshot()).toEqual(result)
    })
  }
  it('validates settings and returns independent snapshots', () => {
    expect(() => new Philosophers('unknown' as 'NAIVE')).toThrow()
    for (const count of [1, 11, 2.5, NaN]) expect(() => new Philosophers('ORDERED', count)).toThrow()
    const lab = new Philosophers(); lab.next(); const snapshot = lab.snapshot(); snapshot.owners[0] = null
    expect(lab.snapshot().owners[0]).toBe('P0')
  })
})

describe('tagged TLB and serial EMAT', () => {
  it('computes the 140 ns textbook oracle and boundary hit ratios', () => {
    expect(serialEmat(0.8, 20, 100)).toBeCloseTo(140)
    expect(serialEmat(0, 20, 100)).toBe(220)
    expect(serialEmat(1, 20, 100)).toBe(120)
    for (const ratio of [-0.1, 1.1, NaN, Infinity]) expect(() => serialEmat(ratio, 20, 100)).toThrow()
    expect(() => serialEmat(0.5, -1, 100)).toThrow(); expect(() => serialEmat(0.5, 1, 0)).toThrow()
  })
  it('translates 2500 to 5572 and charges a miss then a hit', () => {
    const lab = new TlbLaboratory()
    expect(lab.snapshot().observedEmat).toBeNull()
    expect(lab.access('P1', 2500)).toMatchObject({ outcome: 'MISS', page: 2, offset: 452, physical: 5572, costNs: 220 })
    expect(lab.access('P1', 2500)).toMatchObject({ outcome: 'HIT', physical: 5572, costNs: 120 })
    expect(lab.snapshot()).toMatchObject({ hits: 1, misses: 1, faults: 0, observedEmat: 170, formulaEmat: 170 })
  })
  it('isolates equal virtual pages by ASID and does not flush unrelated processes', () => {
    const lab = new TlbLaboratory()
    expect(lab.access('P1', 0).physical).toBe(0)
    expect(lab.access('P2', 0)).toMatchObject({ outcome: 'MISS', physical: 1024 })
    expect(lab.access('P1', 0).outcome).toBe('HIT')
    lab.free('P1')
    expect(lab.snapshot().entries.map((entry) => entry.pid)).toEqual(['P2'])
    expect(lab.access('P2', 0).outcome).toBe('HIT')
    expect(() => lab.access('P1', 0)).toThrow()
  })
  it.each(['FIFO', 'LRU'] as const)('%s chooses the correct victim', (policy) => {
    const lab = new TlbLaboratory({ ...tlbConfiguration, policy })
    for (const address of [0, 1024, 0, 2048]) lab.access('P1', address)
    expect(lab.snapshot().entries.map((entry) => entry.page).sort()).toEqual(policy === 'FIFO' ? [1, 2] : [0, 2])
  })
  it('remap, unmap and reuse invalidate cached translations', () => {
    const lab = new TlbLaboratory()
    lab.access('P1', 2500); lab.map('P1', 2, 4)
    expect(lab.access('P1', 2500)).toMatchObject({ outcome: 'MISS', physical: 4548 })
    lab.unmap('P1', 2)
    const fault = lab.access('P1', 2500)
    expect(fault).toMatchObject({ outcome: 'FAULT', costNs: 120 })
    expect(fault.physical).toBeUndefined()
    expect(lab.snapshot().entries).toEqual([])
    lab.map('P2', 2, 4)
    expect(lab.access('P2', 2500)).toMatchObject({ outcome: 'MISS', physical: 4548 })
  })
  it('separates faults from resident misses and excludes them from measured EMAT', () => {
    const lab = new TlbLaboratory()
    lab.access('P2', 2500)
    expect(lab.snapshot()).toMatchObject({ attempts: 1, misses: 1, faults: 1, observedEmat: null, formulaEmat: null })
    lab.access('P1', 0); lab.access('P1', 0)
    expect(lab.snapshot()).toMatchObject({ attempts: 3, misses: 2, hits: 1, faults: 1, successful: 2, observedEmat: 170, formulaEmat: 170 })
  })
  it('flush preserves counters; reset restores mappings, counters and cache', () => {
    const lab = new TlbLaboratory(); lab.access('P1', 0); lab.flush()
    expect(lab.snapshot()).toMatchObject({ attempts: 1, entries: [] })
    expect(lab.access('P1', 0).outcome).toBe('MISS')
    lab.unmap('P1', 0); lab.free('P2'); lab.reset()
    expect(lab.snapshot()).toEqual(new TlbLaboratory().snapshot())
    const snapshot = lab.snapshot(); snapshot.spaces[0].pages[0] = 7
    expect(lab.snapshot().spaces[0].pages[0]).toBe(0)
  })
  it('rejects invalid operations atomically', () => {
    const lab = new TlbLaboratory(); lab.access('P1', 2500)
    const before = lab.snapshot()
    for (const command of [() => lab.map('P1', 2, 2), () => lab.map('P1', 2, 8), () => lab.map('P1', 3, 4), () => lab.unmap('P1', -1), () => lab.free('missing'),
      () => lab.access('P1', -1), () => lab.access('P1', 3072), () => lab.access('P1', 0.5)]) { expect(command).toThrow(); expect(lab.snapshot()).toEqual(before) }
    lab.map('P1', 2, 5); expect(lab.snapshot().entries).toEqual([])
  })
  it('validates bounds, policies and unique frame ownership', () => {
    for (const patch of [{ capacity: 0 }, { frames: 0 }, { pageSize: 0 }, { lookupNs: -1 }, { memoryNs: 0 }, { policy: 'OPTIMAL' }]) expect(() => new TlbLaboratory({ ...tlbConfiguration, ...patch } as typeof tlbConfiguration)).toThrow()
    for (const spaces of [[{ pid: 'P', pages: [0, 0] }], [{ pid: 'P', pages: [8] }], [{ pid: 'P', pages: [] }], [{ pid: '', pages: [0] }], [tlbSpaces[0], tlbSpaces[0]], Array.from({ length: 17 }, (_, i) => ({ pid: `P${i}`, pages: [null] }))]) expect(() => new TlbLaboratory(tlbConfiguration, spaces)).toThrow()
    expect(new TlbLaboratory(tlbConfiguration, []).snapshot().spaces).toEqual([])
  })
  it('generated accesses and invalidations preserve EMAT and cache coherence', () => {
    fc.assert(fc.property(fc.array(fc.record({ kind: fc.constantFrom('access', 'unmap', 'map', 'flush'), page: fc.integer({ min: 0, max: 2 }) }), { maxLength: 80 }), (operations) => {
      const lab = new TlbLaboratory()
      for (const op of operations) {
        if (op.kind === 'access') lab.access('P1', op.page * 1024)
        else if (op.kind === 'unmap') lab.unmap('P1', op.page)
        else if (op.kind === 'map') lab.map('P1', op.page, [0, 2, 5][op.page])
        else lab.flush()
        const snapshot = lab.snapshot()
        expect(snapshot.attempts).toBe(snapshot.hits + snapshot.misses)
        expect(snapshot.entries.length).toBeLessThanOrEqual(2)
        for (const entry of snapshot.entries) expect(snapshot.spaces.find((space) => space.pid === entry.pid)!.pages[entry.page]).toBe(entry.frame)
        if (snapshot.successful) expect(snapshot.observedEmat).toBeCloseTo(snapshot.formulaEmat!)
      }
    }), { numRuns: 100, seed: 20261030 })
  })
  it('caps trace retention without losing cumulative accounting', () => {
    const lab = new TlbLaboratory()
    for (let i = 0; i < 205; i++) lab.access('P1', 0)
    expect(lab.snapshot()).toMatchObject({ attempts: 205, hits: 204, misses: 1 })
    expect(lab.snapshot().trace).toHaveLength(200)
  })
})
