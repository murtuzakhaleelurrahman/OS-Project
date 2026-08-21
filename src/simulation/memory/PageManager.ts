import { EventSystem } from '../events/EventSystem'
import type { Process } from '../process/Process'

export interface PagingConfiguration {
  readonly totalMemory: number
  readonly pageSize: number
  readonly totalFrames: number
}

export interface Page {
  readonly pageNumber: number
  readonly ownerPid: string
  readonly frameNumber: number | null
  readonly present: boolean
}

export interface Frame {
  readonly frameNumber: number
  readonly startAddress: number
  readonly endAddress: number
  readonly pageNumber: number | null
  readonly ownerPid: string | null
  readonly occupied: boolean
}

export interface PageTable {
  readonly ownerPid: string
  readonly pages: readonly Page[]
}

export interface TranslationResult {
  readonly success: boolean
  readonly logicalAddress: number
  readonly pageNumber: number
  readonly offset: number
  readonly frameNumber?: number
  readonly physicalAddress?: number
  readonly pageFault?: boolean
  readonly error?: string
}

export interface PagingSnapshot {
  readonly configuration: PagingConfiguration
  readonly frames: readonly Frame[]
  readonly pageTables: readonly PageTable[]
  readonly totalFrames: number
  readonly usedFrames: number
  readonly freeFrames: number
  readonly frameUtilization: number
  readonly totalAllocatedPages: number
  readonly totalInternalFragmentation: number
}

export interface PageManagerOptions {
  readonly events: EventSystem
  readonly getCurrentTick: () => number
  readonly getProcess?: (pid: string) => Process | undefined
  readonly isPagedMode: () => boolean
  readonly totalMemory: number
  readonly pageSize: number
  readonly onChange?: () => void
}

export function validatePagingConfiguration(totalMemory: number, pageSize: number): void {
  if (!Number.isInteger(totalMemory) || totalMemory <= 0) throw new Error('Total memory must be a positive integer')
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('Page size must be a positive integer')
  if (totalMemory % pageSize !== 0) throw new Error('Total memory must be divisible by page size')
}

export class PageManager {
  private readonly events: EventSystem
  private readonly getCurrentTick: () => number
  private readonly getProcess?: (pid: string) => Process | undefined
  private readonly isPagedMode: () => boolean
  private readonly configuration: PagingConfiguration
  private readonly onChange?: () => void
  private frames: Frame[]
  private pageTables = new Map<string, PageTable>()

  constructor(options: PageManagerOptions) {
    validatePagingConfiguration(options.totalMemory, options.pageSize)
    this.events = options.events
    this.getCurrentTick = options.getCurrentTick
    this.getProcess = options.getProcess
    this.isPagedMode = options.isPagedMode
    this.configuration = { totalMemory: options.totalMemory, pageSize: options.pageSize, totalFrames: options.totalMemory / options.pageSize }
    this.frames = this.createFrames()
  }

  announceInitialized(): void {
    this.events.emit({ tick: this.getCurrentTick(), type: 'MEMORY_PAGING_INITIALIZED', message: `Paging initialized: ${this.configuration.totalFrames} frames of ${this.configuration.pageSize} units` })
  }

  getConfiguration(): PagingConfiguration { return { ...this.configuration } }
  getPageTable(pid: string): PageTable | undefined {
    const table = this.pageTables.get(pid)
    return table === undefined ? undefined : this.copyTable(table)
  }
  getAllPageTables(): readonly PageTable[] { return [...this.pageTables.values()].map((table) => this.copyTable(table)) }
  getFrames(): readonly Frame[] { return this.frames.map((frame) => ({ ...frame })) }

  allocateProcessPages(pid: string): PageTable {
    this.requirePagedMode()
    const process = this.getProcess?.(pid)
    if (process === undefined) return this.failAllocation(pid, 'Process not found')
    if (this.pageTables.has(pid)) return this.failAllocation(pid, 'Process already has allocated pages')
    const pageCount = Math.ceil(process.memoryRequirement / this.configuration.pageSize)
    this.events.emit({ tick: this.getCurrentTick(), type: 'PAGE_ALLOCATION_REQUESTED', processId: pid, message: `${pid} page allocation requested: ${pageCount} pages` })
    const freeFrames = this.frames.filter((frame) => !frame.occupied).slice(0, pageCount)
    if (freeFrames.length < pageCount) return this.failAllocation(pid, 'Insufficient free frames')
    const pages: Page[] = freeFrames.map((frame, pageNumber) => ({ pageNumber, ownerPid: pid, frameNumber: frame.frameNumber, present: true }))
    this.frames = this.frames.map((frame) => {
      const page = pages.find((candidate) => candidate.frameNumber === frame.frameNumber)
      return page === undefined ? frame : { ...frame, pageNumber: page.pageNumber, ownerPid: pid, occupied: true }
    })
    const table: PageTable = { ownerPid: pid, pages }
    this.pageTables.set(pid, table)
    pages.forEach((page) => this.events.emit({ tick: this.getCurrentTick(), type: 'PAGE_MAPPED', processId: pid, message: `${pid} page ${page.pageNumber} mapped to frame ${page.frameNumber}` }))
    this.events.emit({ tick: this.getCurrentTick(), type: 'PAGE_ALLOCATED', processId: pid, message: `${pid} allocated ${pageCount} pages` })
    this.changed()
    return this.copyTable(table)
  }

  deallocateProcessPages(pid: string): void {
    this.requirePagedMode()
    const table = this.pageTables.get(pid)
    if (table === undefined) throw new Error(`No page table found for process ${pid}`)
    const pageNumbers = new Set(table.pages.map((page) => page.pageNumber))
    this.frames = this.frames.map((frame) => frame.ownerPid === pid ? { ...frame, pageNumber: null, ownerPid: null, occupied: false } : frame)
    pageNumbers.forEach((pageNumber) => this.events.emit({ tick: this.getCurrentTick(), type: 'PAGE_UNMAPPED', processId: pid, message: `${pid} page ${pageNumber} unmapped` }))
    this.pageTables.delete(pid)
    this.changed()
  }

  unmapPage(pid: string, pageNumber: number): void {
    this.requirePagedMode()
    const table = this.pageTables.get(pid)
    const page = table?.pages.find((candidate) => candidate.pageNumber === pageNumber)
    if (table === undefined || page === undefined || page.frameNumber === null) throw new Error(`Page ${pageNumber} is not mapped for ${pid}`)
    const pages = table.pages.map((candidate) => candidate.pageNumber === pageNumber ? { ...candidate, frameNumber: null, present: false } : candidate)
    this.pageTables.set(pid, { ...table, pages })
    this.frames = this.frames.map((frame) => frame.frameNumber === page.frameNumber ? { ...frame, pageNumber: null, ownerPid: null, occupied: false } : frame)
    this.events.emit({ tick: this.getCurrentTick(), type: 'PAGE_UNMAPPED', processId: pid, message: `${pid} page ${pageNumber} unmapped` })
    this.changed()
  }

  translate(pid: string, logicalAddress: number): TranslationResult {
    this.requirePagedMode()
    const process = this.getProcess?.(pid)
    if (process === undefined) return { success: false, logicalAddress, pageNumber: 0, offset: 0, error: 'Process not found' }
    if (!Number.isInteger(logicalAddress) || logicalAddress < 0 || logicalAddress >= process.memoryRequirement) {
      this.events.emit({ tick: this.getCurrentTick(), type: 'ADDRESS_TRANSLATION_FAILED', processId: pid, message: `Invalid logical address: ${logicalAddress}` })
      return { success: false, logicalAddress, pageNumber: Math.floor(Math.max(0, logicalAddress) / this.configuration.pageSize), offset: Math.max(0, logicalAddress) % this.configuration.pageSize, error: 'Invalid logical address' }
    }
    const pageNumber = Math.floor(logicalAddress / this.configuration.pageSize)
    const offset = logicalAddress % this.configuration.pageSize
    const page = this.pageTables.get(pid)?.pages.find((candidate) => candidate.pageNumber === pageNumber)
    if (page === undefined || !page.present || page.frameNumber === null) {
      this.events.emit({ tick: this.getCurrentTick(), type: 'PAGE_FAULT', processId: pid, message: `Page fault: ${pid} page ${pageNumber} is not mapped` })
      return { success: false, logicalAddress, pageNumber, offset, pageFault: true, error: 'Page fault: page is not currently mapped' }
    }
    const physicalAddress = page.frameNumber * this.configuration.pageSize + offset
    this.events.emit({ tick: this.getCurrentTick(), type: 'ADDRESS_TRANSLATED', processId: pid, message: `${pid} logical address ${logicalAddress} translated to ${physicalAddress}` })
    return { success: true, logicalAddress, pageNumber, offset, frameNumber: page.frameNumber, physicalAddress }
  }

  getSnapshot(): PagingSnapshot {
    const usedFrames = this.frames.filter((frame) => frame.occupied).length
    return {
      configuration: this.getConfiguration(),
      frames: this.getFrames(),
      pageTables: this.getAllPageTables(),
      totalFrames: this.configuration.totalFrames,
      usedFrames,
      freeFrames: this.configuration.totalFrames - usedFrames,
      frameUtilization: this.configuration.totalFrames === 0 ? 0 : (usedFrames / this.configuration.totalFrames) * 100,
      totalAllocatedPages: [...this.pageTables.values()].reduce((total, table) => total + table.pages.length, 0),
      totalInternalFragmentation: [...this.pageTables.values()].reduce((total, table) => {
        const process = this.getProcess?.(table.ownerPid)
        return total + (process === undefined ? 0 : table.pages.length * this.configuration.pageSize - process.memoryRequirement)
      }, 0),
    }
  }

  reset(): void {
    this.frames = this.createFrames()
    this.pageTables.clear()
    this.events.emit({ tick: this.getCurrentTick(), type: 'PAGING_RESET', message: 'Paging reset' })
    this.changed()
  }

  private createFrames(): Frame[] {
    return Array.from({ length: this.configuration.totalFrames }, (_, frameNumber) => ({ frameNumber, startAddress: frameNumber * this.configuration.pageSize, endAddress: (frameNumber + 1) * this.configuration.pageSize, pageNumber: null, ownerPid: null, occupied: false }))
  }
  private requirePagedMode(): void { if (!this.isPagedMode()) throw new Error('Cannot perform paging while Contiguous mode is active') }
  private failAllocation(pid: string, reason: string): never { this.events.emit({ tick: this.getCurrentTick(), type: 'PAGE_ALLOCATION_FAILED', processId: pid, message: `Page allocation failed: ${reason}` }); throw new Error(reason) }
  private copyTable(table: PageTable): PageTable { return { ownerPid: table.ownerPid, pages: table.pages.map((page) => ({ ...page })) } }
  private changed(): void { this.onChange?.() }
}