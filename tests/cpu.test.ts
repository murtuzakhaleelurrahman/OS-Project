import { describe, expect, it } from 'vitest'
import { CPU } from '../src/simulation/cpu/CPU'
import { FcfsScheduler, PriorityScheduler, RoundRobinScheduler, SjfScheduler } from '../src/simulation/cpu/Schedulers'
import { EventSystem } from '../src/simulation/events/EventSystem'
import { ProcessManager } from '../src/simulation/process/ProcessManager'
import { ProcessState } from '../src/simulation/process/Process'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'

function processes() {
  const events = new EventSystem()
  let tick = 0
  const manager = new ProcessManager({ events, getCurrentTick: () => tick })
  const p1 = manager.createProcess({ name: 'P1', arrivalTime: 0, burstTime: 5, priority: 2, memoryRequirement: 10 })
  const p2 = manager.createProcess({ name: 'P2', arrivalTime: 0, burstTime: 2, priority: 1, memoryRequirement: 10 })
  manager.admitArrivals(0)
  return { events, manager, p1, p2, setTick: (value: number) => { tick = value } }
}

describe('scheduler strategies', () => {
  it('selects FCFS by arrival and PID', () => {
    const { manager, p1, p2 } = processes()
    expect(new FcfsScheduler().selectNextProcess(manager.getReadyQueue(), 0)?.pid).toBe(p1.pid)
    expect(p2.pid).toBe('P2')
  })

  it('selects SJF by burst, then arrival and PID', () => {
    const { manager, p2 } = processes()
    expect(new SjfScheduler().selectNextProcess(manager.getReadyQueue(), 0)?.pid).toBe(p2.pid)
  })

  it('selects lower numeric priority first', () => {
    const { manager, p2 } = processes()
    expect(new PriorityScheduler().selectNextProcess(manager.getReadyQueue(), 0)?.pid).toBe(p2.pid)
  })

  it('rotates Round Robin FIFO queue and rejects invalid quantum', () => {
    const { manager, p1, p2 } = processes()
    const scheduler = new RoundRobinScheduler(1)
    expect(scheduler.selectNextProcess(manager.getReadyQueue(), 0)?.pid).toBe(p1.pid)
    scheduler.onProcessDispatched?.(p1)
    scheduler.onProcessPreempted?.(p1)
    expect(scheduler.selectNextProcess(manager.getReadyQueue(), 0)?.pid).toBe(p2.pid)
    expect(() => new RoundRobinScheduler(0)).toThrow()
  })
})

describe('CPU execution', () => {
  it('executes once per logical tick and records completion and metrics', () => {
    const { events, manager, p1, setTick } = processes()
    const cpu = new CPU({ processManager: manager, events, getCurrentTick: () => 5 }, new FcfsScheduler())
    for (let tick = 1; tick <= 7; tick += 1) { setTick(tick); cpu.onTick(tick) }

    expect(manager.getProcess(p1.pid)).toMatchObject({ state: ProcessState.TERMINATED, remainingTime: 0, firstStartTime: 0, completionTime: 5 })
    expect(cpu.getSnapshot()).toMatchObject({ busyTicks: 7, contextSwitches: 1 })
    expect(cpu.getSnapshot().metrics.find((metric) => metric.pid === p1.pid)).toMatchObject({ turnaroundTime: 5, waitingTime: 0, responseTime: 0 })
    expect(cpu.getSnapshot().executionSegments.some((segment) => segment.pid === p1.pid)).toBe(true)
  })

  it('tracks idle ticks without decrementing processes', () => {
    const { events, manager, setTick } = processes()
    const cpu = new CPU({ processManager: manager, events, getCurrentTick: () => 2 }, new FcfsScheduler())
    manager.reset()
    setTick(1)
    cpu.onTick(1)
    expect(cpu.getSnapshot().idleTicks).toBe(1)
    expect(cpu.getSnapshot().busyTicks).toBe(0)
  })

  it('preempts Round Robin at the quantum and preserves ready rotation', () => {
    const { events, manager, p1, p2, setTick } = processes()
    const cpu = new CPU({ processManager: manager, events, getCurrentTick: () => 2 }, new RoundRobinScheduler(1))
    setTick(1); cpu.onTick(1)
    expect(manager.getProcess(p1.pid)?.state).toBe(ProcessState.READY)
    setTick(2); cpu.onTick(2)
    expect(manager.getProcess(p2.pid)?.state).toBe(ProcessState.READY)
    expect(cpu.getSnapshot().busyTicks).toBe(2)
    expect(events.getAll().some((event) => event.type === 'QUANTUM_EXPIRED')).toBe(true)
  })

  it('replays engine scheduling deterministically', () => {
    const run = () => {
      const engine = new SimulationEngine()
      engine.setScheduler('ROUND_ROBIN', 2)
      engine.processManager.createProcess({ name: 'P1', arrivalTime: 0, burstTime: 3, priority: 1, memoryRequirement: 1 })
      engine.processManager.createProcess({ name: 'P2', arrivalTime: 0, burstTime: 2, priority: 1, memoryRequirement: 1 })
      engine.fastForward(6)
      const snapshot = engine.getSnapshot()
      return {
        processes: snapshot.processes,
        segments: snapshot.cpu.executionSegments,
        metrics: snapshot.cpu.metrics,
        events: snapshot.events.map(({ tick, type, message, processId }) => ({ tick, type, message, processId })),
      }
    }

    expect(run()).toEqual(run())
  })
})
