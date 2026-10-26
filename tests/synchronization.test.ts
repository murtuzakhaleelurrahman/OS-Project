import { describe, expect, it } from 'vitest'
import { EventSystem } from '../src/simulation/events/EventSystem'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'
import { ProcessManager } from '../src/simulation/process/ProcessManager'
import { ProcessState } from '../src/simulation/process/Process'
import { SynchronizationManager } from '../src/simulation/synchronization/SynchronizationManager'

function setup() {
  let tick = 0
  const events = new EventSystem()
  const processManager = new ProcessManager({ events, getCurrentTick: () => tick })
  const synchronization = new SynchronizationManager({ processManager, events, getCurrentTick: () => tick })
  const addProcess = (name: string) => {
    const process = processManager.createProcess({ name, arrivalTime: 0, burstTime: 5, priority: 1, memoryRequirement: 1 })
    processManager.transitionProcess(process.pid, ProcessState.READY)
    return process.pid
  }
  return { events, processManager, synchronization, addProcess, advance: (value: number) => { tick = value } }
}

describe('SynchronizationManager mutexes', () => {
  it('creates, acquires, blocks FIFO, transfers, and clears process metadata', () => {
    const { processManager, synchronization, addProcess } = setup()
    const first = addProcess('first')
    const second = addProcess('second')
    const third = addProcess('third')
    synchronization.createMutex('m')

    expect(synchronization.acquireMutex(first, 'm')).toBe(true)
    expect(synchronization.acquireMutex(second, 'm')).toBe(false)
    expect(synchronization.acquireMutex(third, 'm')).toBe(false)
    expect(processManager.getProcess(second)).toMatchObject({ state: ProcessState.BLOCKED, blockedReason: 'WAITING_FOR_MUTEX', blockedResourceId: 'm' })
    expect(synchronization.getSnapshot().mutexes.find((mutex) => mutex.id === 'm')).toMatchObject({ ownerPid: first, waitingPids: [second, third] })
    expect(synchronization.releaseMutex(first, 'm')).toBe(true)
    expect(synchronization.getSnapshot().mutexes.find((mutex) => mutex.id === 'm')).toMatchObject({ ownerPid: second, waitingPids: [third] })
    expect(processManager.getProcess(second)).toMatchObject({ state: ProcessState.READY, blockedReason: undefined, blockedResourceId: undefined })
    expect(synchronization.getSnapshot().blockedQueues.m).toEqual([third])
  })

  it('rejects recursive and non-owner operations without mutating ownership', () => {
    const { synchronization, addProcess } = setup()
    const owner = addProcess('owner')
    const other = addProcess('other')
    synchronization.createMutex('m')
    synchronization.acquireMutex(owner, 'm')
    expect(() => synchronization.acquireMutex(owner, 'm')).toThrow()
    expect(() => synchronization.releaseMutex(other, 'm')).toThrow()
    expect(synchronization.getSnapshot().mutexes.find((mutex) => mutex.id === 'm')).toMatchObject({ ownerPid: owner, waitingPids: [] })
  })
})

describe('SynchronizationManager semaphores', () => {
  it('tracks per-process permits and wakes waiters FIFO without negative permits', () => {
    const { synchronization, addProcess } = setup()
    const first = addProcess('first')
    const second = addProcess('second')
    const third = addProcess('third')
    synchronization.createSemaphore('s', 1)
    synchronization.waitSemaphore(first, 's')
    expect(synchronization.waitSemaphore(second, 's')).toBe(false)
    expect(synchronization.waitSemaphore(third, 's')).toBe(false)
    synchronization.signalSemaphore(first, 's')
    expect(synchronization.getSnapshot().semaphores.find((semaphore) => semaphore.id === 's')).toMatchObject({ permits: 0, waitingPids: [third] })
    expect(synchronization.getSnapshot().semaphores.find((semaphore) => semaphore.id === 's')?.holders).toEqual({ [second]: 1 })
    expect(() => synchronization.signalSemaphore(first, 's')).toThrow()
    synchronization.signalSemaphore(second, 's')
    expect(synchronization.getSnapshot().semaphores.find((semaphore) => semaphore.id === 's')?.holders).toEqual({ [third]: 1 })
  })

  it('supports zero permits and rejects over-release by non-holders', () => {
    const { synchronization, addProcess } = setup()
    const process = addProcess('blocked')
    const other = addProcess('other')
    synchronization.createSemaphore('zero', 0)
    expect(synchronization.waitSemaphore(process, 'zero')).toBe(false)
    expect(synchronization.getSnapshot().semaphores.find((semaphore) => semaphore.id === 'zero')?.permits).toBe(0)
    expect(() => synchronization.signalSemaphore(other, 'zero')).toThrow()
  })
})

describe('Critical sections and producer-consumer', () => {
  it('records critical section entry and completion', () => {
    const { synchronization, addProcess, advance } = setup()
    const process = addProcess('worker')
    synchronization.createMutex('lock')
    advance(4)
    expect(synchronization.enterCriticalSection(process, 'resource', 'lock')).toBe(true)
    advance(7)
    synchronization.exitCriticalSection(process, 'resource')
    expect(synchronization.getSnapshot().completedCriticalSections).toMatchObject([{ pid: process, resourceId: 'resource', entryTick: 4, exitTick: 7 }])
  })

  it('keeps a bounded buffer, blocks producers, and wakes one on consume', () => {
    const { synchronization, addProcess } = setup()
    const producer = addProcess('producer')
    const waitingProducer = addProcess('waiting producer')
    const consumer = addProcess('consumer')
    synchronization.resetProducerConsumer(2)
    expect(synchronization.produce(producer)).toBe(true)
    expect(synchronization.produce(producer)).toBe(true)
    expect(synchronization.produce(waitingProducer)).toBe(false)
    expect(synchronization.getSnapshot().producerConsumer.items).toEqual(['item-1', 'item-2'])
    expect(synchronization.consume(consumer)).toBe(true)
    expect(synchronization.getSnapshot().producerConsumer).toMatchObject({ items: ['item-2'], blockedProducers: [] })
    expect(synchronization.getSnapshot().producerConsumer.producerCount).toBe(2)
  })

  it('resets synchronization and produces deterministic identifiers', () => {
    const { synchronization, addProcess, events } = setup()
    const process = addProcess('producer')
    synchronization.resetProducerConsumer(1)
    synchronization.produce(process)
    synchronization.reset()
    expect(synchronization.getSnapshot().producerConsumer.items).toEqual([])
    expect(synchronization.createMutex().id).toBe('mutex-1')
    expect(events.getAll().at(-1)?.type).toBe('MUTEX_CREATED')
  })
})

describe('SimulationEngine synchronization integration', () => {
  it('exposes one synchronized snapshot and central event history', () => {
    const engine = new SimulationEngine()
    const process = engine.processManager.createProcess({ name: 'worker', burstTime: 2, priority: 1, memoryRequirement: 1 })
    engine.processManager.transitionProcess(process.pid, ProcessState.READY)
    const engineMutex = engine.synchronizationManager.createMutex('engine-lock')
    engine.synchronizationManager.acquireMutex(process.pid, engineMutex.id)
    expect(engine.getSnapshot().synchronization.mutexes.find((candidate) => candidate.id === engineMutex.id)?.ownerPid).toBe(process.pid)
    expect(engine.getSnapshot().events.some((event) => event.type === 'MUTEX_ACQUIRED')).toBe(true)
    engine.reset()
    expect(engine.getSnapshot().synchronization.mutexes.map((candidate) => candidate.id)).toEqual(['pc-mutex'])
    expect(engine.getSnapshot().synchronization.producerConsumer.items).toEqual([])
  })
})
