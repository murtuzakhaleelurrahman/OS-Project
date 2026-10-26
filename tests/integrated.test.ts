import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventQueue, Phase } from '../src/simulation/integrated/EventQueue'
import { IntegratedEngine } from '../src/simulation/integrated/IntegratedEngine'
import { cpuPreset, parseScenario } from '../src/simulation/integrated/Scenario'

afterEach(() => { vi.useRealTimers() })
describe('deterministic event queue', () => {
  it('sorts by timestamp, phase, insertion sequence', () => {
    const queue = new EventQueue<string>()
    queue.schedule(5, Phase.DISPATCH, 'dispatch')
    queue.schedule(5, Phase.ARRIVAL, 'arrival1')
    queue.schedule(5, Phase.QUANTUM, 'quantum')
    queue.schedule(5, Phase.COMPLETION, 'completion')
    queue.schedule(5, Phase.ARRIVAL, 'arrival2')
    queue.schedule(1, Phase.DISPATCH, 'first')
    const order = []
    while (queue.size) order.push(queue.pop()?.payload)
    expect(order).toEqual(['first', 'completion', 'arrival1', 'arrival2', 'quantum', 'dispatch'])
  })
  it('rejects backward scheduling and stale cancellation after reset', () => {
    const queue = new EventQueue<string>()
    const old = queue.schedule(2, Phase.ARRIVAL, 'old')
    queue.pop()
    expect(() => queue.schedule(1, Phase.DISPATCH, 'past')).toThrow()
    expect(() => queue.schedule(2, Phase.COMPLETION, 'earlier phase')).toThrow()
    queue.clear()
    queue.schedule(2, Phase.ARRIVAL, 'new')
    queue.cancel(old)
    expect(queue.pop()?.payload).toBe('new')
    expect(() => queue.schedule(0.5, Phase.ARRIVAL, 'fraction')).toThrow()
  })
})
describe('integrated CPU model', () => {
  it.each([
    ['FCFS', ['P1', 'P2', 'P3'], [0, 4, 6]],
    ['SJF', ['P1', 'P3', 'P2'], [0, 5, 3]],
  ] as const)('matches the proposal %s oracle', (algorithm, order, waiting) => {
    const engine = new IntegratedEngine({ ...cpuPreset, cpu: { ...cpuPreset.cpu, algorithm } })
    engine.runAll()
    expect(engine.getSnapshot().segments.map((segment) => segment.pid)).toEqual(order)
    expect(engine.getSnapshot().processes.map((process) => process.waiting)).toEqual(waiting)
    expect(engine.getSnapshot()).toMatchObject({ time: 9, busyTicks: 9, status: 'complete' })
  })
  it('jumps over idle time and does not count dispatches after idle as context switches', () => {
    const engine = new IntegratedEngine({ ...cpuPreset, processes: [{ id: 'P1', arrival: 20, priority: 0, bursts: [{ kind: 'cpu', duration: 2 }] }] })
    engine.next()
    expect(engine.getSnapshot().time).toBe(20)
    engine.runAll()
    expect(engine.getSnapshot()).toMatchObject({ busyTicks: 2, idleTicks: 20, contextSwitches: 0 })
    expect(engine.getSnapshot().segments).toEqual([{ pid: 'IDLE', start: 0, end: 20 }, { pid: 'P1', start: 20, end: 22 }])
  })
  it('admits an arrival at quantum boundary before requeuing the expired process', () => {
    const engine = new IntegratedEngine({ ...cpuPreset, cpu: { algorithm: 'ROUND_ROBIN', quantum: 2 }, processes: [
      { id: 'P1', arrival: 0, priority: 0, bursts: [{ kind: 'cpu', duration: 4 }] },
      { id: 'P2', arrival: 2, priority: 0, bursts: [{ kind: 'cpu', duration: 1 }] },
    ] })
    engine.runAll()
    expect(engine.getSnapshot().segments.map((segment) => segment.pid)).toEqual(['P1', 'P2', 'P1'])
    expect(engine.getSnapshot().trace.filter((entry) => entry.time === 2).map((entry) => entry.type)).toEqual(['ARRIVAL', 'QUANTUM', 'DISPATCH'])
  })
  it('completes at an exact quantum boundary without redundant expiry', () => {
    const engine = new IntegratedEngine({ ...cpuPreset, cpu: { algorithm: 'ROUND_ROBIN', quantum: 5 } })
    engine.runAll()
    expect(engine.getSnapshot().trace.some((entry) => entry.type === 'QUANTUM')).toBe(false)
  })
  it('replays the same ordered trace using timer, step and reset', () => {
    vi.useFakeTimers()
    const manual = new IntegratedEngine(cpuPreset)
    manual.runAll()
    const timed = new IntegratedEngine(cpuPreset)
    timed.play(1)
    vi.runAllTimers()
    expect(timed.getSnapshot()).toEqual(manual.getSnapshot())
    timed.reset(); timed.runAll()
    expect(timed.getSnapshot()).toEqual(manual.getSnapshot())
    timed.dispose()
  })
  it('reset cancels an active timer and pending completions', () => {
    vi.useFakeTimers()
    const engine = new IntegratedEngine(cpuPreset)
    engine.play(1)
    vi.advanceTimersByTime(4)
    engine.reset()
    vi.advanceTimersByTime(100)
    expect(engine.getSnapshot()).toMatchObject({ time: 0, processedEvents: 0, playing: false })
    engine.runAll()
    expect(engine.getSnapshot().time).toBe(9)
    engine.dispose()
  })
  it('uses N/A ratios for empty runs and stops at configured event limits', () => {
    const empty = new IntegratedEngine({ ...cpuPreset, processes: [] })
    empty.runAll()
    expect(empty.getSnapshot()).toMatchObject({ utilization: null, throughput: null, status: 'complete' })
    const limited = new IntegratedEngine({ ...cpuPreset, eventLimit: 1 })
    limited.runAll()
    expect(limited.getSnapshot()).toMatchObject({ status: 'limit', processedEvents: 1 })
  })
  it('rejects malformed scenario input before execution', () => {
    expect(() => parseScenario(null)).toThrow()
    expect(() => parseScenario({ ...cpuPreset, schemaVersion: 2 })).toThrow()
    expect(() => parseScenario({ ...cpuPreset, cpu: { algorithm: 'FCFS', quantum: 0 } })).toThrow()
    expect(() => parseScenario({ ...cpuPreset, processes: [cpuPreset.processes[0], cpuPreset.processes[0]] })).toThrow()
    expect(() => parseScenario({ ...cpuPreset, processes: [{ ...cpuPreset.processes[0], arrival: 0.5 }] })).toThrow()
  })
})
