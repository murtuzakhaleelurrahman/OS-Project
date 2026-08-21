export type ClockListener = (tick: number) => void

export interface SimulationClockOptions {
  readonly initialTick?: number
  readonly tickDurationMs?: number
  readonly onTick?: ClockListener
}

export class SimulationClock {
  private readonly initialTick: number
  private currentTick: number
  private running = false
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly tickDurationMs: number
  private readonly onTick?: ClockListener

  constructor(options: SimulationClockOptions = {}) {
    this.initialTick = options.initialTick ?? 0
    this.currentTick = this.initialTick
    this.tickDurationMs = options.tickDurationMs ?? 1000
    this.onTick = options.onTick
  }

  get tickNumber(): number {
    return this.currentTick
  }

  get isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => this.tick(), this.tickDurationMs)
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  tick(): number {
    this.currentTick += 1
    this.onTick?.(this.currentTick)
    return this.currentTick
  }

  step(): number {
    return this.tick()
  }

  fastForward(ticks: number): number {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error('Fast-forward ticks must be a non-negative integer')
    }
    for (let index = 0; index < ticks; index += 1) this.tick()
    return this.currentTick
  }

  reset(): void {
    this.pause()
    this.currentTick = this.initialTick
  }
}
