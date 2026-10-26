import { describe, expect, it } from 'vitest'
import { EventSystem } from '../src/simulation/events/EventSystem'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'
import { ProcessManager } from '../src/simulation/process/ProcessManager'
import { ProcessState } from '../src/simulation/process/Process'

function createManager(currentTick = 0) {
  const events = new EventSystem()
  const manager = new ProcessManager({ events, getCurrentTick: () => currentTick })
  return { events, manager }
}

function createProcess(manager: ProcessManager) {
  return manager.createProcess({
    name: 'P1 program',
    arrivalTime: 0,
    burstTime: 10,
    priority: 2,
    memoryRequirement: 120,
  })
}

describe('ProcessManager creation and retrieval', () => {
  it('creates a simulated process with deterministic defaults', () => {
    const { manager, events } = createManager()
    const process = createProcess(manager)

    expect(process).toMatchObject({
      pid: 'P1',
      name: 'P1 program',
      state: ProcessState.NEW,
      arrivalTime: 0,
      burstTime: 10,
      remainingTime: 10,
      priority: 2,
      memoryRequirement: 120,
      programCounter: 0,
    })
    expect(manager.getAllProcesses()).toHaveLength(1)
    expect(events.getAll()[0]).toMatchObject({
      tick: 0,
      type: 'PROCESS_CREATED',
      processId: 'P1',
      message: 'Process P1 created',
    })
  })

  it('generates unique PIDs and uses the current tick when arrival is omitted', () => {
    let currentTick = 4
    const events = new EventSystem()
    const manager = new ProcessManager({ events, getCurrentTick: () => currentTick })
    const first = manager.createProcess({ name: 'first', burstTime: 1, priority: 1, memoryRequirement: 1 })
    currentTick = 9
    const second = manager.createProcess({ name: 'second', burstTime: 2, priority: 1, memoryRequirement: 1 })

    expect([first.pid, second.pid]).toEqual(['P1', 'P2'])
    expect([first.arrivalTime, second.arrivalTime]).toEqual([4, 9])
  })

  it('returns copies so callers cannot mutate manager state directly', () => {
    const { manager } = createManager()
    const process = createProcess(manager)
    const copy = manager.getProcess(process.pid) as { state: ProcessState }
    copy.state = ProcessState.RUNNING

    expect(manager.getProcess(process.pid)?.state).toBe(ProcessState.NEW)
  })

  it('filters ready, blocked, running, active, and terminated processes', () => {
    const { manager } = createManager()
    const first = createProcess(manager)
    const second = manager.createProcess({ name: 'P2', burstTime: 5, priority: 1, memoryRequirement: 10 })
    manager.transitionProcess(first.pid, ProcessState.READY)
    manager.transitionProcess(second.pid, ProcessState.READY)
    manager.transitionProcess(second.pid, ProcessState.RUNNING)
    manager.transitionProcess(second.pid, ProcessState.BLOCKED)
    manager.transitionProcess(first.pid, ProcessState.RUNNING)

    expect(manager.getRunningProcess()?.pid).toBe(first.pid)
    expect(manager.getReadyQueue()).toHaveLength(0)
    expect(manager.getBlockedQueue().map((process) => process.pid)).toEqual([second.pid])
    expect(manager.getActiveProcesses()).toHaveLength(2)
    manager.terminateProcess(first.pid)
    expect(manager.getTerminatedProcesses().map((process) => process.pid)).toEqual([first.pid])
  })
})

describe('ProcessManager state transitions', () => {
  it.each([
    [ProcessState.NEW, ProcessState.READY],
    [ProcessState.READY, ProcessState.RUNNING],
    [ProcessState.RUNNING, ProcessState.READY],
    [ProcessState.RUNNING, ProcessState.BLOCKED],
    [ProcessState.BLOCKED, ProcessState.READY],
    [ProcessState.RUNNING, ProcessState.TERMINATED],
    [ProcessState.NEW, ProcessState.TERMINATED],
  ])('allows %s -> %s', (initialState, nextState) => {
    const { manager } = createManager()
    const process = createProcess(manager)
    if (initialState !== ProcessState.NEW) {
      manager.transitionProcess(process.pid, ProcessState.READY)
      if (initialState === ProcessState.RUNNING || initialState === ProcessState.BLOCKED) {
        manager.transitionProcess(process.pid, ProcessState.RUNNING)
      }
      if (initialState === ProcessState.BLOCKED) manager.transitionProcess(process.pid, ProcessState.BLOCKED)
    }

    expect(() => manager.transitionProcess(process.pid, nextState)).not.toThrow()
  })

  it.each([
    [ProcessState.TERMINATED, ProcessState.READY],
    [ProcessState.TERMINATED, ProcessState.RUNNING],
    [ProcessState.TERMINATED, ProcessState.BLOCKED],
    [ProcessState.BLOCKED, ProcessState.RUNNING],
    [ProcessState.READY, ProcessState.BLOCKED],
  ])('rejects %s -> %s', (initialState, nextState) => {
    const { manager, events } = createManager()
    const process = createProcess(manager)
    if (initialState === ProcessState.TERMINATED) manager.terminateProcess(process.pid)
    if (initialState === ProcessState.READY) manager.transitionProcess(process.pid, ProcessState.READY)
    if (initialState === ProcessState.BLOCKED) {
      manager.transitionProcess(process.pid, ProcessState.READY)
      manager.transitionProcess(process.pid, ProcessState.RUNNING)
      manager.transitionProcess(process.pid, ProcessState.BLOCKED)
    }

    expect(() => manager.transitionProcess(process.pid, nextState)).toThrow()
    expect(events.getAll().at(-1)).toMatchObject({ type: 'PROCESS_OPERATION_REJECTED', processId: process.pid })
  })
})

describe('ProcessManager engine integration', () => {
  it('publishes process state through the engine snapshot and resets it', () => {
    const engine = new SimulationEngine()
    const process = engine.processManager.createProcess({ name: 'worker', burstTime: 3, priority: 1, memoryRequirement: 8 })
    engine.processManager.transitionProcess(process.pid, ProcessState.READY)

    expect(engine.getSnapshot()).toMatchObject({
      processCount: 1,
      activeProcessCount: 1,
      readyProcessCount: 1,
      blockedProcessCount: 0,
      terminatedProcessCount: 0,
    })
    engine.reset()
    expect(engine.getSnapshot().processes).toEqual([])
    expect(engine.processManager.createProcess({ name: 'again', burstTime: 1, priority: 1, memoryRequirement: 1 }).pid).toBe('P1')
  })

  it('recreates equivalent process state for the same command sequence', () => {
    const run = () => {
      const engine = new SimulationEngine()
      const process = engine.processManager.createProcess({ name: 'worker', burstTime: 3, priority: 1, memoryRequirement: 8 })
      engine.processManager.transitionProcess(process.pid, ProcessState.READY)
      return engine.getSnapshot().processes
    }

    expect(run()).toEqual(run())
  })
})
