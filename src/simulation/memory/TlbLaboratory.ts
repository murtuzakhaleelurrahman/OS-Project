import { integer } from '../shared/validation'

export interface TlbConfiguration {
  readonly capacity: number; readonly policy: 'FIFO' | 'LRU'; readonly pageSize: number
  readonly frames: number; readonly lookupNs: number; readonly memoryNs: number
}
export interface AddressSpace { pid: string; pages: (number | null)[] }
interface TlbEntry { pid: string; page: number; frame: number; loaded: number; used: number }
export interface TlbAccess {
  attempt: number; pid: string; address: number; page: number; offset: number
  outcome: 'HIT' | 'MISS' | 'FAULT'; costNs: number; physical?: number
}
export const tlbConfiguration: TlbConfiguration = { capacity: 2, policy: 'LRU', pageSize: 1024, frames: 8, lookupNs: 20, memoryNs: 100 }
export const tlbSpaces: AddressSpace[] = [{ pid: 'P1', pages: [0, 2, 5] }, { pid: 'P2', pages: [1, 3, null] }]

/** Serial TLB lookup, single-level resident page table, then data access. */
export function serialEmat(hitRatio: number, lookupNs: number, memoryNs: number): number {
  if (!Number.isFinite(hitRatio) || hitRatio < 0 || hitRatio > 1) throw new Error('Hit ratio must be from 0 to 1')
  integer(lookupNs, 'TLB lookup ns', 0); integer(memoryNs, 'Memory access ns', 1)
  return hitRatio * (lookupNs + memoryNs) + (1 - hitRatio) * (lookupNs + 2 * memoryNs)
}

export class TlbLaboratory {
  readonly configuration: TlbConfiguration
  private readonly initial: AddressSpace[]
  private spaces = new Map<string, (number | null)[]>()
  private entries: TlbEntry[] = []
  private ordinal = 0
  private attempts = 0
  private hits = 0
  private misses = 0
  private faults = 0
  private successfulNs = 0
  private trace: TlbAccess[] = []
  constructor(configuration: TlbConfiguration = tlbConfiguration, spaces: readonly AddressSpace[] = tlbSpaces) {
    integer(configuration.capacity, 'TLB capacity', 1, 32)
    integer(configuration.pageSize, 'Page bytes', 1, 65536)
    integer(configuration.frames, 'Physical frames', 1, 256)
    serialEmat(0, configuration.lookupNs, configuration.memoryNs)
    if (!['FIFO', 'LRU'].includes(configuration.policy)) throw new Error('Unknown TLB replacement policy')
    this.configuration = Object.freeze({ ...configuration })
    if (!Array.isArray(spaces) || spaces.length > 16) throw new Error('Provide up to 16 address spaces')
    const owners = new Set<number>()
    for (const space of spaces) {
      if (!space || typeof space.pid !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(space.pid) || this.spaces.has(space.pid)) throw new Error('Address-space IDs must be unique')
      if (!Array.isArray(space.pages) || !space.pages.length || space.pages.length > 64) throw new Error('Provide 1–64 virtual pages per process')
      for (const frame of space.pages) if (frame !== null) {
        integer(frame, 'Mapped frame', 0, configuration.frames - 1)
        if (owners.has(frame)) throw new Error('A physical frame cannot belong to two pages in this lab')
        owners.add(frame)
      }
      this.spaces.set(space.pid, [...space.pages])
    }
    this.initial = structuredClone(spaces) as AddressSpace[]
  }
  private pages(pid: string): (number | null)[] {
    const pages = this.spaces.get(pid)
    if (!pages) throw new Error('Unknown address space')
    return pages
  }
  access(pid: string, address: number): TlbAccess {
    const pages = this.pages(pid)
    const config = this.configuration
    integer(address, 'Logical byte address', 0, pages.length * config.pageSize - 1)
    const page = Math.floor(address / config.pageSize), offset = address % config.pageSize
    const cached = this.entries.find((entry) => entry.pid === pid && entry.page === page)
    const frame = pages[page]
    const order = ++this.ordinal
    this.attempts++
    let outcome: TlbAccess['outcome']
    if (cached) { this.hits++; cached.used = order; outcome = 'HIT' }
    else {
      this.misses++
      outcome = frame === null ? 'FAULT' : 'MISS'
      if (frame === null) this.faults++
      else {
        if (this.entries.length === config.capacity) {
          const victim = [...this.entries].sort((a, b) => (config.policy === 'LRU' ? a.used - b.used : a.loaded - b.loaded))[0]
          this.entries = this.entries.filter((entry) => entry !== victim)
        }
        this.entries.push({ pid, page, frame, loaded: order, used: order })
      }
    }
    const costNs = config.lookupNs + config.memoryNs * (outcome === 'MISS' ? 2 : 1)
    if (outcome !== 'FAULT') this.successfulNs += costNs
    const resolved = cached?.frame ?? frame
    const result: TlbAccess = { attempt: this.attempts, pid, address, page, offset, outcome, costNs,
      ...(resolved === null ? {} : { physical: resolved * config.pageSize + offset }) }
    this.trace.push(result)
    if (this.trace.length > 200) this.trace.shift()
    return { ...result }
  }
  map(pid: string, page: number, frame: number): void {
    const pages = this.pages(pid)
    integer(page, 'Virtual page', 0, pages.length - 1); integer(frame, 'Frame', 0, this.configuration.frames - 1)
    for (const [owner, mapping] of this.spaces) mapping.forEach((current, index) => {
      if (current === frame && (owner !== pid || index !== page)) throw new Error('Frame already belongs to another page')
    })
    pages[page] = frame; this.invalidate(pid, page)
  }
  unmap(pid: string, page: number): void {
    const pages = this.pages(pid)
    integer(page, 'Virtual page', 0, pages.length - 1)
    pages[page] = null; this.invalidate(pid, page)
  }
  free(pid: string): void { this.pages(pid); this.spaces.delete(pid); this.entries = this.entries.filter((entry) => entry.pid !== pid) }
  private invalidate(pid: string, page: number): void { this.entries = this.entries.filter((entry) => entry.pid !== pid || entry.page !== page) }
  flush(): void { this.entries = [] }
  reset(): void {
    this.spaces = new Map(this.initial.map((space) => [space.pid, [...space.pages]])); this.entries = []
    this.ordinal = this.attempts = this.hits = this.misses = this.faults = this.successfulNs = 0; this.trace = []
  }
  snapshot() {
    const successful = this.attempts - this.faults
    const hitRatio = successful ? this.hits / successful : null
    return structuredClone({ configuration: this.configuration, spaces: [...this.spaces].map(([pid, pages]) => ({ pid, pages })), entries: this.entries,
      attempts: this.attempts, hits: this.hits, misses: this.misses, faults: this.faults, successful, hitRatio,
      observedEmat: successful ? this.successfulNs / successful : null,
      formulaEmat: hitRatio === null ? null : serialEmat(hitRatio, this.configuration.lookupNs, this.configuration.memoryNs), trace: this.trace })
  }
}
