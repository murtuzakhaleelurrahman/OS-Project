import { EventSystem, type SimulationEvent } from '../events/EventSystem'
import { SimulationClock } from './SimulationClock'

export interface SimulationSnapshot {
  readonly tick: number
  readonly running: boolean
  readonly events: readonly SimulationEvent[]
}

export interface TickableSimulationModule {
  onTick(tickNumber: number): void
}

export class SimulationEngine {
  readonly events: EventSystem
  readonly clock: SimulationClock
  private readonly listeners = new Set<() => void>()
  private readonly tickableModules = new Set<TickableSimulationModule>()
  private cachedSnapshot: SimulationSnapshot | undefined

  constructor(tickDurationMs = 1000, initialTick = 0) {
    this.events = new EventSystem()
    this.clock = new SimulationClock({
      tickDurationMs,
      initialTick,
      onTick: (tick) => {
        this.events.emit({
          tick,
          type: 'CLOCK_TICKED',
          message: `Logical clock advanced to tick ${tick}`,
        })
        this.tickableModules.forEach((module) => module.onTick(tick))
        this.notify()
      },
    })
  }

  start(): void {
    this.clock.start()
    this.events.emit({
      tick: this.clock.tickNumber,
      type: 'CLOCK_STARTED',
      message: 'Simulation started',
    })
    this.notify()
  }

  pause(): void {
    this.clock.pause()
    this.events.emit({
      tick: this.clock.tickNumber,
      type: 'CLOCK_PAUSED',
      message: 'Simulation paused',
    })
    this.notify()
  }

  step(): void {
    this.clock.step()
  }

  tick(): void {
    this.clock.tick()
  }

  fastForward(ticks: number): void {
    this.clock.fastForward(ticks)
    this.events.emit({
      tick: this.clock.tickNumber,
      type: 'CLOCK_FAST_FORWARDED',
      message: `Fast-forwarded simulation by ${ticks} tick${ticks === 1 ? '' : 's'}`,
    })
    this.notify()
  }

  reset(): void {
    this.clock.reset()
    this.events.clear()
    this.events.emit({ tick: 0, type: 'CLOCK_RESET', message: 'Simulation reset' })
    this.notify()
  }

  getSnapshot(): SimulationSnapshot {
    if (this.cachedSnapshot === undefined) {
      this.cachedSnapshot = {
        tick: this.clock.tickNumber,
        running: this.clock.isRunning,
        events: this.events.getAll(),
      }
    }
    return this.cachedSnapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  registerTickable(module: TickableSimulationModule): () => void {
    this.tickableModules.add(module)
    return () => this.tickableModules.delete(module)
  }

  dispose(): void {
    this.clock.pause()
    this.tickableModules.clear()
    this.listeners.clear()
  }

  private notify(): void {
    this.cachedSnapshot = undefined
    this.listeners.forEach((listener) => listener())
  }
}
