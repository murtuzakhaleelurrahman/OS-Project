export const Phase = { COMPLETION: 0, ARRIVAL: 1, QUANTUM: 2, DISPATCH: 3 } as const
export type EventPhase = (typeof Phase)[keyof typeof Phase]

export interface ScheduledEvent<T> {
  readonly time: number
  readonly phase: EventPhase
  readonly sequence: number
  readonly generation: number
  readonly payload: T
}

/** Stable event ordering; resetting invalidates handles from a previous run. */
export class EventQueue<T> {
  private events: ScheduledEvent<T>[] = []
  private sequence = 0
  private generation = 0
  private cursor: ScheduledEvent<T> | undefined

  schedule(time: number, phase: EventPhase, payload: T): ScheduledEvent<T> {
    if (!Number.isSafeInteger(time) || time < 0) throw new Error('Event time must be a non-negative safe integer')
    if (![0, 1, 2, 3].includes(phase)) throw new Error('Invalid event phase')
    if (this.cursor && (time < this.cursor.time || (time === this.cursor.time && phase < this.cursor.phase))) {
      throw new Error('An event cannot schedule an earlier time or an earlier same-time phase')
    }
    const event = { time, phase, sequence: this.sequence++, generation: this.generation, payload }
    this.events.push(event)
    this.events.sort((a, b) => a.time - b.time || a.phase - b.phase || a.sequence - b.sequence)
    return event
  }

  pop(): ScheduledEvent<T> | undefined {
    this.cursor = this.events.shift()
    return this.cursor
  }

  cancel(event: ScheduledEvent<T>): void {
    this.events = this.events.filter((candidate) => candidate !== event)
  }

  get size(): number { return this.events.length }
  get nextTime(): number | undefined { return this.events[0]?.time }
  clear(): void {
    this.events = []
    this.cursor = undefined
    this.sequence = 0
    this.generation++
  }
}
