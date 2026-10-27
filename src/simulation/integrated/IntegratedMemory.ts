import type { Scenario, ScenarioProcess } from './Scenario'

export interface ResidentFrame {
  index: number
  owner?: string
  page?: number
  loadingPage?: number
  loadedAt: number
  lastUsed: number
}

export interface PageAccess {
  hit: boolean
  frame: number
  victim?: number
  retry: boolean
}

/** Local replacement prevents another process from evicting an in-flight CPU reference. */
export class IntegratedMemory {
  readonly configuration: NonNullable<Scenario['memory']>
  readonly frames: ResidentFrame[]
  private ordinal = 0
  private references = 0
  private hits = 0
  private faults = 0
  private replacements = 0
  private readonly retry = new Map<string, number>()

  constructor(configuration: NonNullable<Scenario['memory']>) {
    this.configuration = configuration
    this.frames = Array.from({ length: configuration.frames }, (_, index) => ({ index, loadedAt: 0, lastUsed: 0 }))
  }

  pages(process: ScenarioProcess): number {
    const referenced = process.bursts.flatMap((burst) => burst.kind === 'cpu' ? burst.references ?? [0] : [])
    return process.memoryPages ?? referenced.reduce((maximum, page) => Math.max(maximum, page + 1), 1)
  }

  quota(process: ScenarioProcess): number {
    return this.configuration.mode === 'fixed'
      ? this.pages(process)
      : process.frameQuota ?? Math.min(this.pages(process), this.configuration.frames)
  }

  admit(process: ScenarioProcess): boolean {
    const free = this.frames.filter((frame) => frame.owner === undefined)
    const quota = this.quota(process)
    if (free.length < quota) return false
    free.slice(0, quota).forEach((frame, page) => {
      frame.owner = process.id
      if (this.configuration.mode === 'fixed') frame.page = page
    })
    return true
  }

  access(pid: string, page: number): PageAccess {
    const owned = this.frames.filter((frame) => frame.owner === pid)
    if (!owned.length) throw new Error('Page access requires admitted memory')
    const resident = owned.find((frame) => frame.page === page)
    const retry = this.retry.get(pid) === page
    if (resident) {
      if (!retry) { this.references++; this.hits++ }
      this.retry.delete(pid)
      resident.lastUsed = ++this.ordinal
      return { hit: true, frame: resident.index, retry }
    }
    if (retry) throw new Error('Page-in completed without making the retried page resident')
    this.references++
    this.faults++
    const frame = owned.find((candidate) => candidate.page === undefined && candidate.loadingPage === undefined)
      ?? [...owned].sort((a, b) => (this.configuration.replacement === 'LRU' ? a.lastUsed - b.lastUsed : a.loadedAt - b.loadedAt) || a.index - b.index)[0]
    if (frame.loadingPage !== undefined) throw new Error('Cannot replace a frame with an in-flight page-in')
    const victim = frame.page
    if (victim !== undefined) this.replacements++
    frame.page = undefined
    frame.loadingPage = page
    this.retry.set(pid, page)
    return { hit: false, frame: frame.index, victim, retry: false }
  }

  complete(pid: string, frameNumber: number, page: number): void {
    const frame = this.frames[frameNumber]
    if (!frame || frame.owner !== pid || frame.loadingPage !== page) throw new Error('Page-in token does not match its reserved frame')
    frame.page = page
    frame.loadingPage = undefined
    frame.loadedAt = ++this.ordinal
    frame.lastUsed = this.ordinal
  }

  release(pid: string): void {
    for (const frame of this.frames) {
      if (frame.owner !== pid) continue
      frame.owner = undefined
      frame.page = undefined
      frame.loadingPage = undefined
      frame.loadedAt = 0
      frame.lastUsed = 0
    }
    this.retry.delete(pid)
  }

  snapshot() {
    return {
      configuration: { ...this.configuration }, frames: structuredClone(this.frames),
      references: this.references, hits: this.hits, faults: this.faults, replacements: this.replacements,
      usedFrames: this.frames.filter((frame) => frame.owner !== undefined).length,
    }
  }
}
