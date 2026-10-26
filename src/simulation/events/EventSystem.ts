export type SimulationEventType =
  | 'CLOCK_STARTED'
  | 'CLOCK_PAUSED'
  | 'CLOCK_TICKED'
  | 'CLOCK_RESET'
  | 'CLOCK_FAST_FORWARDED'
  | 'PROCESS_CREATED'
  | 'PROCESS_STATE_CHANGED'
  | 'PROCESS_TERMINATED'
  | 'PROCESS_OPERATION_REJECTED'
  | 'PROCESS_ARRIVED'
  | 'PROCESS_SELECTED'
  | 'PROCESS_STARTED'
  | 'PROCESS_PREEMPTED'
  | 'PROCESS_COMPLETED'
  | 'CPU_IDLE'
  | 'CPU_BECAME_BUSY'
  | 'CONTEXT_SWITCH'
  | 'QUANTUM_EXPIRED'
  | 'MEMORY_INITIALIZED'
  | 'MEMORY_MODE_CHANGED'
  | 'MEMORY_RESET'
  | 'MEMORY_ALLOCATION_REQUESTED'
  | 'MEMORY_ALLOCATED'
  | 'MEMORY_ALLOCATION_FAILED'
  | 'MEMORY_DEALLOCATED'
  | 'MEMORY_REGIONS_MERGED'
  | 'MEMORY_STRATEGY_CHANGED'
  | 'MEMORY_PAGING_INITIALIZED'
  | 'PAGE_ALLOCATION_REQUESTED'
  | 'PAGE_ALLOCATED'
  | 'PAGE_ALLOCATION_FAILED'
  | 'PAGE_MAPPED'
  | 'PAGE_UNMAPPED'
  | 'ADDRESS_TRANSLATED'
  | 'ADDRESS_TRANSLATION_FAILED'
  | 'PAGE_FAULT'
  | 'PAGING_RESET'
  | 'PAGE_REFERENCE'
  | 'PAGE_HIT'
  | 'PAGE_REPLACEMENT'
  | 'PAGE_EVICTED'
  | 'PAGE_LOADED'
  | 'REPLACEMENT_ALGORITHM_CHANGED'
  | 'REPLACEMENT_SIMULATION_RESET'
  | 'DISK_INITIALIZED'
  | 'DISK_REQUEST_ADDED'
  | 'DISK_REQUEST_SELECTED'
  | 'DISK_REQUEST_SERVICED'
  | 'DISK_HEAD_MOVED'
  | 'DISK_QUEUE_EMPTY'
  | 'DISK_ALGORITHM_CHANGED'
  | 'DISK_DIRECTION_CHANGED'
  | 'DISK_RESET'
  | 'MUTEX_CREATED'
  | 'MUTEX_ACQUIRED'
  | 'MUTEX_RELEASED'
  | 'MUTEX_BLOCKED'
  | 'MUTEX_OWNERSHIP_TRANSFERRED'
  | 'MUTEX_OPERATION_FAILED'
  | 'SEMAPHORE_CREATED'
  | 'SEMAPHORE_ACQUIRED'
  | 'SEMAPHORE_RELEASED'
  | 'SEMAPHORE_BLOCKED'
  | 'SEMAPHORE_WAKE'
  | 'PROCESS_BLOCKED'
  | 'PROCESS_UNBLOCKED'
  | 'CRITICAL_SECTION_ENTERED'
  | 'CRITICAL_SECTION_EXITED'
  | 'PRODUCER_WAITING'
  | 'PRODUCER_PRODUCED'
  | 'CONSUMER_WAITING'
  | 'CONSUMER_CONSUMED'
  | 'BUFFER_FULL'
  | 'BUFFER_EMPTY'
  | 'SYNCHRONIZATION_RESET'

export interface SimulationEvent {
  readonly id: number
  readonly tick: number
  readonly type: SimulationEventType
  readonly message: string
  readonly processId?: string
  readonly resourceId?: string
}

export type EventListener = (event: SimulationEvent) => void

export class EventSystem {
  private readonly events: SimulationEvent[] = []
  private readonly listeners = new Set<EventListener>()
  private nextEventId = 1

  emit(event: Omit<SimulationEvent, 'id'>): SimulationEvent {
    const completeEvent = { ...event, id: this.nextEventId++ }
    this.events.push(completeEvent)
    this.listeners.forEach((listener) => listener(completeEvent))
    return completeEvent
  }

  getAll(): readonly SimulationEvent[] {
    return [...this.events]
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.events.length = 0
    this.nextEventId = 1
  }
}
