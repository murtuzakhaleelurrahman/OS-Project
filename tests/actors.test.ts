import { describe, expect, it } from 'vitest'
import { ActorLab, bufferPreset, lostUpdatePreset, mutexPreset } from '../src/simulation/synchronization/ActorLab'

describe('scripted concurrency laboratory', () => {
  it('reproduces lost update and prevents it with a full-region mutex', () => {
    const race = new ActorLab(lostUpdatePreset); race.runAll()
    const protectedRun = new ActorLab(mutexPreset); protectedRun.runAll()
    expect(race.getSnapshot()).toMatchObject({ status: 'complete', shared: 1 })
    expect(protectedRun.getSnapshot()).toMatchObject({ status: 'complete', shared: 2 })
    expect(protectedRun.getSnapshot().trace.some((entry) => entry.message.includes('ownership transferred'))).toBe(true)
  })
  it('keeps the bounded buffer within capacity and consumes in FIFO order', () => {
    const lab = new ActorLab(bufferPreset)
    while (lab.next()) {
      expect(lab.getSnapshot().buffer.length).toBeLessThanOrEqual(2)
      expect(lab.getSnapshot().buffer.length).toBeGreaterThanOrEqual(0)
      expect(lab.getSnapshot().produced - lab.getSnapshot().consumed.length).toBe(lab.getSnapshot().buffer.length)
    }
    expect(lab.getSnapshot()).toMatchObject({ status: 'complete', consumed: ['item-1', 'item-2', 'item-3'], buffer: [] })
    expect(lab.getSnapshot().semaphores.empty.permits).toBe(2)
    expect(lab.getSnapshot().semaphores.full.permits).toBe(0)
  })
  it('transfers semaphore permits to waiters in FIFO order', () => {
    const lab = new ActorLab({ ...lostUpdatePreset, semaphores: { s: 0 }, schedule: ['A', 'B', 'C', 'C'], actors: [
      { id: 'A', program: [{ op: 'wait', resource: 's' }] },
      { id: 'B', program: [{ op: 'wait', resource: 's' }] },
      { id: 'C', program: [{ op: 'signal', resource: 's' }, { op: 'signal', resource: 's' }] },
    ] })
    lab.runAll()
    expect(lab.getSnapshot().trace.filter((entry) => entry.operation === 'signal').map((entry) => entry.message)).toEqual(['Signalled s; permit transferred to A.', 'Signalled s; permit transferred to B.'])
    expect(lab.getSnapshot().status).toBe('complete')
  })
  it('rejects non-owner unlocks and reports exhausted scripts waiting for resources', () => {
    const bad = new ActorLab({ ...lostUpdatePreset, actors: [{ id: 'A', program: [{ op: 'unlock', resource: 'm' }] }], schedule: [] })
    bad.runAll(); expect(bad.getSnapshot().status).toBe('error')
    const blocked = new ActorLab({ ...lostUpdatePreset, semaphores: { s: 0 }, actors: [{ id: 'A', program: [{ op: 'wait', resource: 's' }] }], schedule: [] })
    blocked.runAll(); expect(blocked.getSnapshot().status).toBe('blocked')
  })
  it('replays deterministically and validates resource references', () => {
    const a = new ActorLab(bufferPreset); const b = new ActorLab(bufferPreset)
    a.runAll(); while (b.next()) { /* step replay */ }
    expect(a.getSnapshot()).toEqual(b.getSnapshot())
    expect(() => new ActorLab({ ...lostUpdatePreset, actors: [{ id: 'A', program: [{ op: 'lock', resource: 'unknown' }] }] })).toThrow()
  })
  it('supports actor IDs that also name JavaScript object properties', () => {
    const lab = new ActorLab({ ...lostUpdatePreset, semaphores: { s: 1 }, schedule: [], actors: [{ id: 'constructor', program: [{ op: 'wait', resource: 's' }, { op: 'signal', resource: 's' }] }] })
    lab.runAll()
    expect(lab.getSnapshot()).toMatchObject({ status: 'complete', semaphores: { s: { permits: 1 } } })
  })
})
