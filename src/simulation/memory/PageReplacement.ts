export const PageReplacementAlgorithm = {
  FIFO: 'FIFO',
  LRU: 'LRU',
  OPTIMAL: 'OPTIMAL',
} as const
export type PageReplacementAlgorithm = (typeof PageReplacementAlgorithm)[keyof typeof PageReplacementAlgorithm]

export interface ReplacementFrame {
  readonly frameNumber: number
  pageNumber: number | null
  loadedAt: number
  lastUsedAt: number
}

export interface ReplacementHistoryEntry {
  readonly referenceIndex: number
  readonly requestedPage: number
  readonly result: 'HIT' | 'FAULT'
  readonly victimPage?: number
  readonly victimFrame?: number
  readonly framesAfter: readonly ReplacementFrame[]
}

export interface ReplacementContext {
  readonly frames: readonly ReplacementFrame[]
  readonly currentIndex: number
  readonly futureReferences: readonly number[]
}

export interface PageReplacementStrategy {
  readonly algorithm: PageReplacementAlgorithm
  selectVictim(context: ReplacementContext): ReplacementFrame
}

export class FifoReplacement implements PageReplacementStrategy {
  readonly algorithm = PageReplacementAlgorithm.FIFO
  selectVictim(context: ReplacementContext): ReplacementFrame { return [...context.frames].sort((left, right) => left.loadedAt - right.loadedAt || left.frameNumber - right.frameNumber)[0] }
}

export class LruReplacement implements PageReplacementStrategy {
  readonly algorithm = PageReplacementAlgorithm.LRU
  selectVictim(context: ReplacementContext): ReplacementFrame { return [...context.frames].sort((left, right) => left.lastUsedAt - right.lastUsedAt || left.frameNumber - right.frameNumber)[0] }
}

export class OptimalReplacement implements PageReplacementStrategy {
  readonly algorithm = PageReplacementAlgorithm.OPTIMAL
  selectVictim(context: ReplacementContext): ReplacementFrame {
    return [...context.frames].sort((left, right) => {
      const rightNextUse = this.nextUse(context, right)
      const leftNextUse = this.nextUse(context, left)
      if (rightNextUse === leftNextUse) return left.frameNumber - right.frameNumber
      if (rightNextUse === Number.POSITIVE_INFINITY) return 1
      if (leftNextUse === Number.POSITIVE_INFINITY) return -1
      return rightNextUse - leftNextUse
    })[0]
  }
  private nextUse(context: ReplacementContext, frame: ReplacementFrame): number { const next = context.futureReferences.slice(context.currentIndex + 1).indexOf(frame.pageNumber as number); return next < 0 ? Number.POSITIVE_INFINITY : next }
}

export function createPageReplacementStrategy(algorithm: PageReplacementAlgorithm): PageReplacementStrategy {
  if (algorithm === PageReplacementAlgorithm.LRU) return new LruReplacement()
  if (algorithm === PageReplacementAlgorithm.OPTIMAL) return new OptimalReplacement()
  return new FifoReplacement()
}