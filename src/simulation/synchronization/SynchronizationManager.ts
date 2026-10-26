import { EventSystem } from '../events/EventSystem'
import { ProcessManager } from '../process/ProcessManager'
import { ProcessState, type Process } from '../process/Process'

export interface MutexSnapshot { readonly id: string; readonly ownerPid?: string; readonly waitingPids: readonly string[] }
export interface SemaphoreSnapshot { readonly id: string; readonly permits: number; readonly holders: Readonly<Record<string, number>>; readonly waitingPids: readonly string[] }
export interface SharedResourceSnapshot { readonly resourceId: string; readonly users: readonly string[] }
export interface CriticalSectionRecord { readonly pid: string; readonly resourceId: string; readonly mutexId?: string; readonly entryTick: number; readonly exitTick?: number }
export interface SynchronizationOperation { readonly tick: number; readonly operation: string; readonly pid?: string; readonly resourceId?: string; readonly success: boolean; readonly message: string }
export interface SynchronizationMetrics { readonly mutexOperations: number; readonly semaphoreOperations: number; readonly blockedOperations: number; readonly wakeups: number; readonly criticalSectionsCompleted: number; readonly produced: number; readonly consumed: number; readonly producerWaits: number; readonly consumerWaits: number }
export interface ProducerConsumerSnapshot {
  readonly capacity: number
  readonly items: readonly string[]
  readonly emptyPermits: number
  readonly fullPermits: number
  readonly producerCount: number
  readonly consumerCount: number
  readonly blockedProducers: readonly string[]
  readonly blockedConsumers: readonly string[]
  readonly mutexId: string
  readonly emptySemaphoreId: string
  readonly fullSemaphoreId: string
}
export interface SynchronizationSnapshot {
  readonly mutexes: readonly MutexSnapshot[]
  readonly semaphores: readonly SemaphoreSnapshot[]
  readonly blockedQueues: Readonly<Record<string, readonly string[]>>
  readonly activeCriticalSections: readonly CriticalSectionRecord[]
  readonly completedCriticalSections: readonly CriticalSectionRecord[]
  readonly sharedResources: readonly SharedResourceSnapshot[]
  readonly producerConsumer: ProducerConsumerSnapshot
  readonly metrics: SynchronizationMetrics
  readonly operationHistory: readonly SynchronizationOperation[]
}

interface Mutex { id: string; ownerPid?: string; waitingPids: string[] }
interface Semaphore { id: string; permits: number; holders: Map<string, number>; waitingPids: string[] }
interface ActiveSection { pid: string; resourceId: string; mutexId?: string; entryTick: number }

export interface SynchronizationManagerOptions {
  readonly processManager: ProcessManager
  readonly events: EventSystem
  readonly getCurrentTick: () => number
  readonly onChange?: () => void
}

export class SynchronizationManager {
  private readonly processManager: ProcessManager
  private readonly events: EventSystem
  private readonly getCurrentTick: () => number
  private readonly onChange?: () => void
  private readonly mutexes = new Map<string, Mutex>()
  private readonly semaphores = new Map<string, Semaphore>()
  private readonly activeSections: ActiveSection[] = []
  private readonly completedSections: CriticalSectionRecord[] = []
  private readonly resources = new Map<string, Set<string>>()
  private readonly history: SynchronizationOperation[] = []
  private mutexSequence = 1
  private semaphoreSequence = 1
  private itemSequence = 1
  private metrics: SynchronizationMetrics = { mutexOperations: 0, semaphoreOperations: 0, blockedOperations: 0, wakeups: 0, criticalSectionsCompleted: 0, produced: 0, consumed: 0, producerWaits: 0, consumerWaits: 0 }
  private producerConsumer = { capacity: 5, items: [] as string[], mutexId: 'pc-mutex', emptySemaphoreId: 'pc-empty', fullSemaphoreId: 'pc-full', producerCount: 0, consumerCount: 0 }

  constructor(options: SynchronizationManagerOptions) {
    this.processManager = options.processManager
    this.events = options.events
    this.getCurrentTick = options.getCurrentTick
    this.onChange = options.onChange
    this.resetPrimitive(this.producerConsumer.mutexId, this.producerConsumer.emptySemaphoreId, this.producerConsumer.fullSemaphoreId, this.producerConsumer.capacity)
  }

  createMutex(requestedId?: string): MutexSnapshot {
    const id = this.uniqueId(requestedId, 'mutex', () => this.mutexSequence++)
    this.mutexes.set(id, { id, waitingPids: [] })
    this.emit('MUTEX_CREATED', `Mutex ${id} created`, undefined, id)
    return this.getMutex(id)
  }

  acquireMutex(pid: string, id: string): boolean {
    const mutex = this.requireMutex(id)
    this.requireProcess(pid)
    this.metrics = { ...this.metrics, mutexOperations: this.metrics.mutexOperations + 1 }
    if (mutex.ownerPid === pid) return this.failMutex(pid, id, 'Mutex cannot be acquired recursively')
    if (mutex.ownerPid === undefined) {
      mutex.ownerPid = pid
      this.record('acquireMutex', pid, id, true, `${pid} acquired ${id}`)
      this.emit('MUTEX_ACQUIRED', `${pid} acquired mutex ${id}`, pid, id)
      return this.changedResult(true)
    }
    if (!mutex.waitingPids.includes(pid)) mutex.waitingPids.push(pid)
    this.block(pid, 'WAITING_FOR_MUTEX', id)
    this.metrics = { ...this.metrics, blockedOperations: this.metrics.blockedOperations + 1 }
    this.emit('MUTEX_BLOCKED', `${pid} blocked waiting for mutex ${id}`, pid, id)
    return this.changedResult(false)
  }

  releaseMutex(pid: string, id: string): boolean {
    const mutex = this.requireMutex(id)
    this.requireProcess(pid)
    if (mutex.ownerPid !== pid) return this.failMutex(pid, id, 'Only the mutex owner may release it')
    mutex.ownerPid = undefined
    this.emit('MUTEX_RELEASED', `${pid} released mutex ${id}`, pid, id)
    const nextPid = mutex.waitingPids.shift()
    if (nextPid !== undefined) {
      mutex.ownerPid = nextPid
      this.unblock(nextPid)
      this.metrics = { ...this.metrics, wakeups: this.metrics.wakeups + 1 }
      this.emit('MUTEX_OWNERSHIP_TRANSFERRED', `${id} transferred from ${pid} to ${nextPid}`, nextPid, id)
      this.emit('PROCESS_UNBLOCKED', `${nextPid} unblocked for mutex ${id}`, nextPid, id)
    }
    this.record('releaseMutex', pid, id, true, `${pid} released ${id}`)
    return this.changedResult(true)
  }

  createSemaphore(requestedId?: string, permits = 0): SemaphoreSnapshot {
    if (!Number.isInteger(permits) || permits < 0) throw new Error('Semaphore permits must be a non-negative integer')
    const id = this.uniqueId(requestedId, 'semaphore', () => this.semaphoreSequence++)
    this.semaphores.set(id, { id, permits, holders: new Map(), waitingPids: [] })
    this.emit('SEMAPHORE_CREATED', `Semaphore ${id} created with ${permits} permit${permits === 1 ? '' : 's'}`, undefined, id)
    return this.getSemaphore(id)
  }

  waitSemaphore(pid: string, id: string): boolean {
    const semaphore = this.requireSemaphore(id)
    this.requireProcess(pid)
    this.metrics = { ...this.metrics, semaphoreOperations: this.metrics.semaphoreOperations + 1 }
    if (semaphore.permits > 0) {
      semaphore.permits -= 1
      this.addHolder(semaphore, pid)
      this.emit('SEMAPHORE_ACQUIRED', `${pid} acquired semaphore ${id}`, pid, id)
      this.record('waitSemaphore', pid, id, true, `${pid} acquired ${id}`)
      return this.changedResult(true)
    }
    if (!semaphore.waitingPids.includes(pid)) semaphore.waitingPids.push(pid)
    this.block(pid, 'WAITING_FOR_SEMAPHORE', id)
    this.metrics = { ...this.metrics, blockedOperations: this.metrics.blockedOperations + 1 }
    this.emit('SEMAPHORE_BLOCKED', `${pid} blocked waiting for semaphore ${id}`, pid, id)
    return this.changedResult(false)
  }

  signalSemaphore(pid: string, id: string): boolean {
    const semaphore = this.requireSemaphore(id)
    this.requireProcess(pid)
    const held = semaphore.holders.get(pid) ?? 0
    if (held === 0) throw new Error(`${pid} does not hold a permit for semaphore ${id}`)
    this.removeHolder(semaphore, pid)
    this.emit('SEMAPHORE_RELEASED', `${pid} released one permit of ${id}`, pid, id)
    const nextPid = semaphore.waitingPids.shift()
    if (nextPid !== undefined) {
      this.addHolder(semaphore, nextPid)
      this.unblock(nextPid)
      this.metrics = { ...this.metrics, wakeups: this.metrics.wakeups + 1 }
      this.emit('SEMAPHORE_WAKE', `${nextPid} received a permit from ${id}`, nextPid, id)
      this.emit('PROCESS_UNBLOCKED', `${nextPid} unblocked for semaphore ${id}`, nextPid, id)
    } else semaphore.permits += 1
    this.record('signalSemaphore', pid, id, true, `${pid} signalled ${id}`)
    return this.changedResult(true)
  }

  enterCriticalSection(pid: string, resourceId: string, mutexId?: string): boolean {
    this.requireProcess(pid)
    this.requireResourceId(resourceId)
    if (this.activeSections.some((section) => section.pid === pid && section.resourceId === resourceId)) throw new Error(`${pid} is already in critical section ${resourceId}`)
    if (mutexId !== undefined && !this.acquireMutex(pid, mutexId)) return false
    const section: ActiveSection = { pid, resourceId, mutexId, entryTick: this.getCurrentTick() }
    this.activeSections.push(section)
    const users = this.resources.get(resourceId) ?? new Set<string>()
    users.add(pid)
    this.resources.set(resourceId, users)
    this.emit('CRITICAL_SECTION_ENTERED', `${pid} entered critical section ${resourceId}`, pid, resourceId)
    this.record('enterCriticalSection', pid, resourceId, true, `${pid} entered ${resourceId}`)
    return this.changedResult(true)
  }

  exitCriticalSection(pid: string, resourceId: string): boolean {
    const index = this.activeSections.findIndex((section) => section.pid === pid && section.resourceId === resourceId)
    if (index < 0) throw new Error(`${pid} is not active in critical section ${resourceId}`)
    const section = this.activeSections.splice(index, 1)[0]
    const users = this.resources.get(resourceId)
    users?.delete(pid)
    if (users?.size === 0) this.resources.delete(resourceId)
    if (section.mutexId !== undefined) this.releaseMutex(pid, section.mutexId)
    this.completedSections.push({ ...section, exitTick: this.getCurrentTick() })
    this.metrics = { ...this.metrics, criticalSectionsCompleted: this.metrics.criticalSectionsCompleted + 1 }
    this.emit('CRITICAL_SECTION_EXITED', `${pid} exited critical section ${resourceId}`, pid, resourceId)
    this.record('exitCriticalSection', pid, resourceId, true, `${pid} exited ${resourceId}`)
    return this.changedResult(true)
  }

  produce(pid: string): boolean {
    this.requireProcess(pid)
    if (!this.waitSemaphore(pid, this.producerConsumer.emptySemaphoreId)) {
      this.metrics = { ...this.metrics, producerWaits: this.metrics.producerWaits + 1 }
      this.emit('PRODUCER_WAITING', `${pid} is waiting for an empty buffer slot`, pid, this.producerConsumer.emptySemaphoreId)
      return this.changedResult(false)
    }
    if (!this.acquireMutex(pid, this.producerConsumer.mutexId)) {
      this.signalSemaphore(pid, this.producerConsumer.emptySemaphoreId)
      return false
    }
    const item = `item-${this.itemSequence++}`
    this.producerConsumer.items.push(item)
    this.producerConsumer.producerCount += 1
    this.metrics = { ...this.metrics, produced: this.metrics.produced + 1 }
    this.emit('PRODUCER_PRODUCED', `${pid} produced ${item}`, pid, item)
    this.releaseSemaphorePermit(this.producerConsumer.fullSemaphoreId, pid)
    this.releaseMutex(pid, this.producerConsumer.mutexId)
    if (this.producerConsumer.items.length === this.producerConsumer.capacity) this.emit('BUFFER_FULL', 'Producer-consumer buffer is full', undefined, 'producer-consumer')
    return this.changedResult(true)
  }

  consume(pid: string): boolean {
    this.requireProcess(pid)
    if (!this.waitSemaphore(pid, this.producerConsumer.fullSemaphoreId)) {
      this.metrics = { ...this.metrics, consumerWaits: this.metrics.consumerWaits + 1 }
      this.emit('CONSUMER_WAITING', `${pid} is waiting for an item`, pid, this.producerConsumer.fullSemaphoreId)
      return this.changedResult(false)
    }
    if (!this.acquireMutex(pid, this.producerConsumer.mutexId)) {
      this.signalSemaphore(pid, this.producerConsumer.fullSemaphoreId)
      return false
    }
    const item = this.producerConsumer.items.shift()
    if (item === undefined) throw new Error('Buffer semaphore state is inconsistent')
    this.producerConsumer.consumerCount += 1
    this.metrics = { ...this.metrics, consumed: this.metrics.consumed + 1 }
    this.emit('CONSUMER_CONSUMED', `${pid} consumed ${item}`, pid, item)
    this.releaseSemaphorePermit(this.producerConsumer.emptySemaphoreId, pid)
    this.releaseMutex(pid, this.producerConsumer.mutexId)
    if (this.producerConsumer.items.length === 0) this.emit('BUFFER_EMPTY', 'Producer-consumer buffer is empty', undefined, 'producer-consumer')
    return this.changedResult(true)
  }

  resetProducerConsumer(capacity = 5): void {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('Buffer capacity must be a positive integer')
    this.producerConsumer.capacity = capacity
    this.producerConsumer.items = []
    this.producerConsumer.producerCount = 0
    this.producerConsumer.consumerCount = 0
    this.itemSequence = 1
    this.resetPrimitive(this.producerConsumer.mutexId, this.producerConsumer.emptySemaphoreId, this.producerConsumer.fullSemaphoreId, capacity)
    this.emit('SYNCHRONIZATION_RESET', 'Producer-consumer synchronization reset')
    this.changedResult(true)
  }

  reset(emitResetEvent = true): void {
    this.mutexes.clear()
    this.semaphores.clear()
    this.activeSections.length = 0
    this.completedSections.length = 0
    this.resources.clear()
    this.history.length = 0
    this.metrics = { mutexOperations: 0, semaphoreOperations: 0, blockedOperations: 0, wakeups: 0, criticalSectionsCompleted: 0, produced: 0, consumed: 0, producerWaits: 0, consumerWaits: 0 }
    this.mutexSequence = 1
    this.semaphoreSequence = 1
    this.producerConsumer = { capacity: 5, items: [], mutexId: 'pc-mutex', emptySemaphoreId: 'pc-empty', fullSemaphoreId: 'pc-full', producerCount: 0, consumerCount: 0 }
    this.itemSequence = 1
    this.resetPrimitive(this.producerConsumer.mutexId, this.producerConsumer.emptySemaphoreId, this.producerConsumer.fullSemaphoreId, this.producerConsumer.capacity)
    if (emitResetEvent) this.emit('SYNCHRONIZATION_RESET', 'Synchronization state reset')
    this.changedResult(true)
  }

  onTick(_tickNumber: number): void {}

  getSnapshot(): SynchronizationSnapshot {
    const blockedQueues: Record<string, readonly string[]> = {}
    this.mutexes.forEach((mutex, id) => { blockedQueues[id] = [...mutex.waitingPids] })
    this.semaphores.forEach((semaphore, id) => { blockedQueues[id] = [...semaphore.waitingPids] })
    return {
      mutexes: [...this.mutexes.values()].map((mutex) => ({ id: mutex.id, ownerPid: mutex.ownerPid, waitingPids: [...mutex.waitingPids] })),
      semaphores: [...this.semaphores.values()].map((semaphore) => ({ id: semaphore.id, permits: semaphore.permits, holders: Object.fromEntries(semaphore.holders), waitingPids: [...semaphore.waitingPids] })),
      blockedQueues,
      activeCriticalSections: this.activeSections.map((section) => ({ ...section })),
      completedCriticalSections: this.completedSections.map((section) => ({ ...section })),
      sharedResources: [...this.resources.entries()].map(([resourceId, users]) => ({ resourceId, users: [...users] })),
      producerConsumer: { ...this.producerConsumer, items: [...this.producerConsumer.items], emptyPermits: this.requireSemaphore(this.producerConsumer.emptySemaphoreId).permits, fullPermits: this.requireSemaphore(this.producerConsumer.fullSemaphoreId).permits, blockedProducers: this.blockedPids(this.producerConsumer.emptySemaphoreId), blockedConsumers: this.blockedPids(this.producerConsumer.fullSemaphoreId) },
      metrics: { ...this.metrics },
      operationHistory: this.history.map((entry) => ({ ...entry })),
    }
  }

  private resetPrimitive(mutexId: string, emptyId: string, fullId: string, capacity: number): void {
    this.mutexes.set(mutexId, { id: mutexId, waitingPids: [] })
    this.semaphores.set(emptyId, { id: emptyId, permits: capacity, holders: new Map(), waitingPids: [] })
    this.semaphores.set(fullId, { id: fullId, permits: 0, holders: new Map(), waitingPids: [] })
  }

  private releaseSemaphorePermit(id: string, pid: string): void {
    const semaphore = this.requireSemaphore(id)
    const nextPid = semaphore.waitingPids.shift()
    if (nextPid === undefined) semaphore.permits += 1
    else {
      this.addHolder(semaphore, nextPid)
      this.unblock(nextPid)
      this.metrics = { ...this.metrics, wakeups: this.metrics.wakeups + 1 }
      this.emit('SEMAPHORE_WAKE', `${nextPid} received a permit from ${id}`, nextPid, id)
      this.emit('PROCESS_UNBLOCKED', `${nextPid} unblocked for semaphore ${id}`, nextPid, id)
    }
    this.emit('SEMAPHORE_RELEASED', `${pid} signalled ${id}`, pid, id)
  }

  private blockedPids(resourceId: string): readonly string[] { return this.processManager.getBlockedQueue().filter((process) => process.blockedResourceId === resourceId).map((process) => process.pid) }
  private getMutex(id: string): MutexSnapshot { const mutex = this.requireMutex(id); return { id: mutex.id, ownerPid: mutex.ownerPid, waitingPids: [...mutex.waitingPids] } }
  private getSemaphore(id: string): SemaphoreSnapshot { const semaphore = this.requireSemaphore(id); return { id, permits: semaphore.permits, holders: Object.fromEntries(semaphore.holders), waitingPids: [...semaphore.waitingPids] } }
  private requireMutex(id: string): Mutex { const mutex = this.mutexes.get(id); if (mutex === undefined) throw new Error(`Mutex not found: ${id}`); return mutex }
  private requireSemaphore(id: string): Semaphore { const semaphore = this.semaphores.get(id); if (semaphore === undefined) throw new Error(`Semaphore not found: ${id}`); return semaphore }
  private requireProcess(pid: string): Process { const process = this.processManager.getProcess(pid); if (process === undefined) throw new Error(`Process not found: ${pid}`); if (process.state === ProcessState.TERMINATED) throw new Error(`Process ${pid} is terminated`); return process }
  private requireResourceId(id: string): void { if (id.trim().length === 0) throw new Error('Resource ID is required') }
  private uniqueId(requestedId: string | undefined, prefix: string, next: () => number): string { const id = requestedId?.trim() || `${prefix}-${next()}`; if (this.mutexes.has(id) || this.semaphores.has(id)) throw new Error(`Synchronization resource already exists: ${id}`); return id }
  private addHolder(semaphore: Semaphore, pid: string): void { semaphore.holders.set(pid, (semaphore.holders.get(pid) ?? 0) + 1) }
  private removeHolder(semaphore: Semaphore, pid: string): void { const count = semaphore.holders.get(pid) ?? 0; if (count <= 1) semaphore.holders.delete(pid); else semaphore.holders.set(pid, count - 1) }
  private block(pid: string, reason: 'WAITING_FOR_MUTEX' | 'WAITING_FOR_SEMAPHORE', resourceId: string): void { this.processManager.setSynchronizationBlock(pid, reason, resourceId); this.emit('PROCESS_BLOCKED', `${pid} blocked for ${resourceId}`, pid, resourceId) }
  private unblock(pid: string): void { this.processManager.clearSynchronizationBlock(pid) }
  private failMutex(pid: string, id: string, message: string): false { this.emit('MUTEX_OPERATION_FAILED', message, pid, id); this.record('mutexOperation', pid, id, false, message); throw new Error(message) }
  private record(operation: string, pid: string | undefined, resourceId: string | undefined, success: boolean, message: string): void { this.history.push({ tick: this.getCurrentTick(), operation, pid, resourceId, success, message }) }
  private emit(type: Parameters<EventSystem['emit']>[0]['type'], message: string, processId?: string, resourceId?: string): void { this.events.emit({ tick: this.getCurrentTick(), type, message, processId, resourceId }) }
  private changedResult<T>(value: T): T { this.onChange?.(); return value }
}
