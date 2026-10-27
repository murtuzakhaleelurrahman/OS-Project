import { describe, expect, it } from 'vitest'
import { EventSystem } from '../src/simulation/events/EventSystem'
import { DiskManager } from '../src/simulation/disk/DiskManager'
import { CircularLookDiskStrategy, CircularScanDiskStrategy, FcfsDiskStrategy, LookDiskStrategy, ScanDiskStrategy, SstfDiskStrategy, type DiskConfiguration, type DiskRequest } from '../src/simulation/disk/DiskScheduling'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'

const configuration: DiskConfiguration = { cylinders: 200, initialHead: 50 }
const requests = (cylinders: number[]): DiskRequest[] => cylinders.map((cylinder, index) => ({ requestId: `R${index + 1}`, cylinder, arrivalTick: index, status: 'PENDING' }))
const context = (_algorithmLabel: string, direction: 'UP' | 'DOWN' = 'UP', head = 50) => ({ configuration, head, direction, requests: requests([10, 40, 70, 120]) })

describe('disk scheduling strategies', () => {
  it('selects FCFS and deterministic SSTF ties', () => {
    expect(new FcfsDiskStrategy().schedule(context('FCFS'))?.requestId).toBe('R1')
    expect(new SstfDiskStrategy().schedule({ ...context('SSTF'), requests: requests([40, 60]) })?.requestId).toBe('R1')
  })
  it('handles SCAN boundaries in both directions', () => {
    expect(new ScanDiskStrategy().schedule(context('SCAN'))?.requestId).toBe('R3')
    expect(new ScanDiskStrategy().schedule(context('SCAN', 'DOWN'))?.requestId).toBe('R2')
    expect(new ScanDiskStrategy().schedule({ ...context('SCAN'), requests: requests([10]) })).toMatchObject({ movement: [199] })
  })
  it('wraps C-SCAN and jumps with C-LOOK', () => {
    expect(new CircularScanDiskStrategy().schedule({ ...context('C-SCAN'), requests: requests([10]) })).toMatchObject({ movement: [199, 0, 10] })
    expect(new CircularScanDiskStrategy().schedule({ ...context('C-SCAN', 'DOWN'), requests: requests([120]) })).toMatchObject({ movement: [0, 199, 120] })
    expect(new CircularLookDiskStrategy().schedule({ ...context('C-LOOK'), requests: requests([10]) })).toMatchObject({ movement: [10, 10] })
    expect(new LookDiskStrategy().schedule({ ...context('LOOK'), requests: requests([10]) })?.movement).toEqual([10])
  })
})

describe('DiskManager', () => {
  it('validates atomically, assigns IDs and arrival ticks, and keeps completed requests', () => {
    const events = new EventSystem(); let tick = 3
    const manager = new DiskManager({ events, getCurrentTick: () => tick, configuration })
    expect(() => manager.requestDiskAccess(200)).toThrow()
    expect(manager.getSnapshot().metrics.total).toBe(0)
    const first = manager.requestDiskAccess(70); tick = 4; const second = manager.addBulkRequests([10, 120])
    expect([first.requestId, ...second.map((request) => request.requestId)]).toEqual(['R1', 'R2', 'R3'])
    expect([first.arrivalTick, second[0].arrivalTick]).toEqual([3, 4])
    manager.runAll()
    expect(manager.getSnapshot().completedRequests).toHaveLength(3)
    expect(manager.getSnapshot().metrics.totalMovement).toBeGreaterThan(0)
  })
  it('services one request per logical tick, resets active state, and emits disk events', () => {
    const events = new EventSystem(); let tick = 0
    const manager = new DiskManager({ events, getCurrentTick: () => tick, configuration })
    manager.addBulkRequests([50, 60]); expect(manager.step()?.cylinder).toBe(50); expect(manager.getSnapshot().metrics.serviced).toBe(1)
    manager.setAlgorithm('SSTF'); expect(manager.getSnapshot().head).toBe(50); expect(manager.getSnapshot().metrics.serviced).toBe(0)
    expect(events.getAll().map((event) => event.type)).toContain('DISK_ALGORITHM_CHANGED')
    manager.reset(); expect(manager.getSnapshot()).toMatchObject({ head: 50, requests: expect.arrayContaining([expect.objectContaining({ status: 'PENDING' })]) })
  })
  it('integrates with the existing engine tick stream and replays deterministically', () => {
    const run = () => { const engine = new SimulationEngine(); engine.diskManager.addBulkRequests([80, 20]); engine.step(); engine.step(); return engine.getSnapshot().disk }
    expect(run()).toEqual(run())
    const engine = new SimulationEngine(); engine.diskManager.requestDiskAccess(90); engine.step(); expect(engine.getSnapshot().disk.metrics.serviced).toBe(1)
  })
})
