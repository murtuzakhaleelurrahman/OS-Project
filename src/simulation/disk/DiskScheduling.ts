export type DiskDirection = 'UP' | 'DOWN'
export type DiskSchedulingAlgorithm = 'FCFS' | 'SSTF' | 'SCAN' | 'C-SCAN' | 'LOOK' | 'C-LOOK'

export interface DiskConfiguration { readonly cylinders: number; readonly initialHead: number }
export interface DiskRequest { readonly requestId: string; readonly cylinder: number; readonly arrivalTick: number; readonly status: 'PENDING' | 'COMPLETED'; readonly completedTick?: number }
export interface DiskSchedulingContext { readonly configuration: DiskConfiguration; readonly head: number; readonly direction: DiskDirection; readonly requests: readonly DiskRequest[] }
export interface DiskSchedulingDecision { readonly requestId?: string; readonly movement: readonly number[]; readonly nextDirection?: DiskDirection }
export interface DiskSchedulingStrategy { readonly algorithm: DiskSchedulingAlgorithm; schedule(context: DiskSchedulingContext): DiskSchedulingDecision | undefined }

export function validateDiskConfiguration(configuration: DiskConfiguration): void {
  if (!Number.isInteger(configuration.cylinders) || configuration.cylinders < 2) throw new Error('Cylinder count must be an integer of at least 2')
  if (!Number.isInteger(configuration.initialHead) || configuration.initialHead < 0 || configuration.initialHead >= configuration.cylinders) throw new Error('Initial head must be a valid cylinder')
}
export function validateDiskCylinder(cylinder: number, configuration: DiskConfiguration): void {
  if (!Number.isInteger(cylinder) || cylinder < 0 || cylinder >= configuration.cylinders) throw new Error(`Cylinder must be between 0 and ${configuration.cylinders - 1}`)
}

const pending = (context: DiskSchedulingContext): DiskRequest[] => context.requests.filter((request) => request.status === 'PENDING')
const idNumber = (requestId: string): number => Number(requestId.slice(1))
const byArrival = (first: DiskRequest, second: DiskRequest): number => first.arrivalTick - second.arrivalTick || idNumber(first.requestId) - idNumber(second.requestId)
const byCylinder = (first: DiskRequest, second: DiskRequest): number => first.cylinder - second.cylinder || idNumber(first.requestId) - idNumber(second.requestId)

function directional(context: DiskSchedulingContext, look: boolean, circular: boolean): DiskSchedulingDecision | undefined {
  const waiting = pending(context)
  if (waiting.length === 0) return undefined
  const sign = context.direction === 'UP' ? 1 : -1
  const ahead = waiting.filter((request) => sign > 0 ? request.cylinder >= context.head : request.cylinder <= context.head).sort(byCylinder)
  if (ahead.length > 0) {
    const request = sign > 0 ? ahead[0] : ahead[ahead.length - 1]
    return { requestId: request.requestId, movement: [request.cylinder] }
  }
  const ordered = [...waiting].sort(byCylinder)
  const target = sign > 0 ? ordered[ordered.length - 1] : ordered[0]
  if (look) return { requestId: target.requestId, movement: [target.cylinder], nextDirection: context.direction === 'UP' ? 'DOWN' : 'UP' }
  const boundary = sign > 0 ? context.configuration.cylinders - 1 : 0
  if (circular) return { requestId: target.requestId, movement: [boundary, sign > 0 ? 0 : context.configuration.cylinders - 1, target.cylinder] }
  return { movement: [boundary], nextDirection: context.direction === 'UP' ? 'DOWN' : 'UP' }
}

export class FcfsDiskStrategy implements DiskSchedulingStrategy {
  readonly algorithm = 'FCFS' as const
  schedule(context: DiskSchedulingContext): DiskSchedulingDecision | undefined { const request = [...pending(context)].sort(byArrival)[0]; return request === undefined ? undefined : { requestId: request.requestId, movement: [request.cylinder] } }
}
export class SstfDiskStrategy implements DiskSchedulingStrategy {
  readonly algorithm = 'SSTF' as const
  schedule(context: DiskSchedulingContext): DiskSchedulingDecision | undefined { const request = [...pending(context)].sort((first, second) => Math.abs(first.cylinder - context.head) - Math.abs(second.cylinder - context.head) || byCylinder(first, second))[0]; return request === undefined ? undefined : { requestId: request.requestId, movement: [request.cylinder] } }
}
export class ScanDiskStrategy implements DiskSchedulingStrategy { readonly algorithm = 'SCAN' as const; schedule(context: DiskSchedulingContext): DiskSchedulingDecision | undefined { return directional(context, false, false) } }
export class CircularScanDiskStrategy implements DiskSchedulingStrategy { readonly algorithm = 'C-SCAN' as const; schedule(context: DiskSchedulingContext): DiskSchedulingDecision | undefined { return directional(context, false, true) } }
export class LookDiskStrategy implements DiskSchedulingStrategy { readonly algorithm = 'LOOK' as const; schedule(context: DiskSchedulingContext): DiskSchedulingDecision | undefined { return directional(context, true, false) } }
export class CircularLookDiskStrategy implements DiskSchedulingStrategy {
  readonly algorithm = 'C-LOOK' as const
  schedule(context: DiskSchedulingContext): DiskSchedulingDecision | undefined {
    const waiting = pending(context); if (waiting.length === 0) return undefined
    const sign = context.direction === 'UP' ? 1 : -1
    const ahead = waiting.filter((request) => sign > 0 ? request.cylinder >= context.head : request.cylinder <= context.head).sort(byCylinder)
    if (ahead.length > 0) { const request = sign > 0 ? ahead[0] : ahead[ahead.length - 1]; return { requestId: request.requestId, movement: [request.cylinder] } }
    const ordered = [...waiting].sort(byCylinder); const target = sign > 0 ? ordered[0] : ordered[ordered.length - 1]
    const extreme = sign > 0 ? ordered[ordered.length - 1].cylinder : ordered[0].cylinder
    return { requestId: target.requestId, movement: [extreme, target.cylinder] }
  }
}
export function createDiskSchedulingStrategy(algorithm: DiskSchedulingAlgorithm): DiskSchedulingStrategy {
  switch (algorithm) { case 'FCFS': return new FcfsDiskStrategy(); case 'SSTF': return new SstfDiskStrategy(); case 'SCAN': return new ScanDiskStrategy(); case 'C-SCAN': return new CircularScanDiskStrategy(); case 'LOOK': return new LookDiskStrategy(); case 'C-LOOK': return new CircularLookDiskStrategy() }
}