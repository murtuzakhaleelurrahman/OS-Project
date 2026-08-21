import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventSystem } from '../src/simulation/events/EventSystem'
import { SimulationClock } from '../src/simulation/engine/SimulationClock'
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine'

describe('SimulationClock', () => {
  it('advances deterministically and notifies on every tick', () => {
    const ticks: number[] = []
    const clock = new SimulationClock({ onTick: (tick) => ticks.push(tick) })

    expect(clock.tickNumber).toBe(0)
    expect(clock.step()).toBe(1)
    expect(clock.fastForward(2)).toBe(3)
    expect(ticks).toEqual([1, 2, 3])
  })

  it('rejects invalid fast-forward values', () => {
    const clock = new SimulationClock()

    expect(() => clock.fastForward(-1)).toThrow()
    expect(() => clock.fastForward(1.5)).toThrow()
  })

  it('resets to its configured initial tick', () => {
    const clock = new SimulationClock({ initialTick: 7 })

    clock.fastForward(3)
    clock.reset()

    expect(clock.tickNumber).toBe(7)
  })

  it('starts one timer and pauses it', () => {
    vi.useFakeTimers()
    const clock = new SimulationClock({ tickDurationMs: 10 })

    clock.start()
    clock.start()
    vi.advanceTimersByTime(30)
    expect(clock.tickNumber).toBe(3)
    clock.pause()
    vi.advanceTimersByTime(30)
    expect(clock.tickNumber).toBe(3)
    vi.useRealTimers()
  })
})

describe('EventSystem', () => {
  let events: EventSystem

  beforeEach(() => {
    events = new EventSystem()
  })

  it('stores structured events and notifies subscribers', () => {
    const received: string[] = []
    const unsubscribe = events.subscribe((event) => received.push(event.message))

    events.emit({ tick: 4, type: 'CLOCK_TICKED', message: 'tick' })
    unsubscribe()
    events.emit({ tick: 5, type: 'CLOCK_PAUSED', message: 'paused' })

    expect(events.getAll()).toMatchObject([
      { id: 1, tick: 4, type: 'CLOCK_TICKED', message: 'tick' },
      { id: 2, tick: 5, type: 'CLOCK_PAUSED', message: 'paused' },
    ])
    expect(received).toEqual(['tick'])
  })
})

describe('SimulationEngine', () => {
  it('coordinates clock state and event history', () => {
    const engine = new SimulationEngine()

    engine.step()
    engine.fastForward(2)

    expect(engine.getSnapshot()).toMatchObject({ tick: 3, running: false })
    expect(engine.getSnapshot().events.map((event) => event.type)).toEqual([
      'CLOCK_TICKED',
      'CLOCK_TICKED',
      'CLOCK_TICKED',
      'CLOCK_FAST_FORWARDED',
    ])
  })

  it('replays the same manual sequence identically after reset', () => {
    const engine = new SimulationEngine()
    const run = () => {
      engine.step()
      engine.step()
      engine.step()
      return engine.getSnapshot().events
        .filter((event) => event.type === 'CLOCK_TICKED')
        .map(({ tick, type, message }) => ({ tick, type, message }))
    }

    const firstRun = run()
    engine.reset()
    const secondRun = run()

    expect(secondRun).toEqual(firstRun)
    expect(engine.clock.tickNumber).toBe(3)
  })

  it('sends each logical tick to registered modules', () => {
    const engine = new SimulationEngine()
    const ticks: number[] = []
    const unregister = engine.registerTickable({ onTick: (tick) => ticks.push(tick) })

    engine.fastForward(3)
    unregister()
    engine.step()

    expect(ticks).toEqual([1, 2, 3])
  })

  it('produces the same tick events for manual and timer-driven ticks', () => {
    vi.useFakeTimers()
    const manual = new SimulationEngine()
    const timed = new SimulationEngine(10)

    manual.step()
    manual.step()
    manual.step()
    timed.start()
    vi.advanceTimersByTime(30)
    timed.pause()

    expect(timed.getSnapshot().events.filter((event) => event.type === 'CLOCK_TICKED').map((event) => event.tick)).toEqual(
      manual.getSnapshot().events.filter((event) => event.type === 'CLOCK_TICKED').map((event) => event.tick),
    )
    manual.dispose()
    timed.dispose()
    vi.useRealTimers()
  })
})
