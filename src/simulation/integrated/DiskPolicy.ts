export const integratedDiskPolicies = ['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK', 'C-LOOK'] as const
export type IntegratedDiskPolicy = (typeof integratedDiskPolicies)[number]
export type DiskDirection = 'UP' | 'DOWN'
interface PendingRequest { readonly id: number; readonly cylinder: number }
export interface DiskSelection<T> { request: T; path: number[]; distance: number; direction: DiskDirection }

/** A chosen request's complete route is reserved; arrivals never preempt active service. */
export function chooseDiskRequest<T extends PendingRequest>(pending: readonly T[], head: number,
  direction: DiskDirection, policy: IntegratedDiskPolicy, cylinders: number): DiskSelection<T> | undefined {
  if (!pending.length) return undefined
  const fifo = [...pending].sort((a, b) => a.id - b.id)
  let request = fifo[0]
  let path: number[] = []
  let nextDirection = direction
  if (policy === 'SSTF') {
    request = [...pending].sort((a, b) => Math.abs(a.cylinder - head) - Math.abs(b.cylinder - head) || a.id - b.id)[0]
  } else if (policy !== 'FCFS') {
    const up = direction === 'UP'
    const directional = (a: T, b: T) => (up ? a.cylinder - b.cylinder : b.cylinder - a.cylinder) || a.id - b.id
    const ahead = pending.filter((candidate) => up ? candidate.cylinder >= head : candidate.cylinder <= head).sort(directional)
    if (ahead.length) request = ahead[0]
    else if (policy === 'C-SCAN' || policy === 'C-LOOK') {
      request = [...pending].sort((a, b) => (up ? a.cylinder - b.cylinder : b.cylinder - a.cylinder) || a.id - b.id)[0]
      if (policy === 'C-SCAN') path = [up ? cylinders - 1 : 0, up ? 0 : cylinders - 1]
    } else {
      nextDirection = up ? 'DOWN' : 'UP'
      request = [...pending].sort((a, b) => (up ? b.cylinder - a.cylinder : a.cylinder - b.cylinder) || a.id - b.id)[0]
      if (policy === 'SCAN') path = [up ? cylinders - 1 : 0]
    }
  }
  path.push(request.cylinder)
  let previous = head
  const distance = path.reduce((total, position) => {
    const movement = Math.abs(position - previous)
    previous = position
    return total + movement
  }, 0)
  return { request, path, distance, direction: nextDirection }
}
