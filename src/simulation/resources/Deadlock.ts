export interface LockState {
  processes: string[]
  resources: { id: string; instances: 1; owner: string | null }[]
  requests: { pid: string; resource: string }[]
}
export interface WaitEdge { from: string; to: string; resource: string }

export const deadlockPreset: LockState = {
  processes: ['P1', 'P2', 'P3'],
  resources: [{ id: 'R1', instances: 1, owner: 'P1' }, { id: 'R2', instances: 1, owner: 'P2' }],
  requests: [{ pid: 'P1', resource: 'R2' }, { pid: 'P2', resource: 'R1' }, { pid: 'P3', resource: 'R1' }],
}
export const chainPreset: LockState = { ...deadlockPreset, requests: deadlockPreset.requests.filter((request) => request.pid !== 'P2') }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Lock state entries must be objects')
  return value as Record<string, unknown>
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value)
export function validateLocks(input: unknown): LockState {
  const value = object(input)
  if (!Array.isArray(value.processes) || value.processes.length > 32 || value.processes.some((id) => !validId(id)) || new Set(value.processes).size !== value.processes.length) throw new Error('Provide up to 32 unique process IDs')
  const processes = value.processes as string[]
  if (!Array.isArray(value.resources) || value.resources.length > 64) throw new Error('Provide up to 64 resources')
  const resources = value.resources.map((entry) => {
    const resource = object(entry)
    if (!validId(resource.id)) throw new Error('Invalid resource ID')
    if (resource.instances !== 1) throw new Error('Wait-for detection requires exactly one instance per resource')
    if (resource.owner !== null && !processes.includes(resource.owner as string)) throw new Error('Unknown resource owner')
    return { id: resource.id, instances: 1 as const, owner: resource.owner as string | null }
  })
  if (new Set(resources.map((resource) => resource.id)).size !== resources.length) throw new Error('Resource IDs must be unique')
  if (!Array.isArray(value.requests) || value.requests.length > 128) throw new Error('Provide up to 128 pending requests')
  const requests = value.requests.map((entry) => {
    const request = object(entry)
    if (!processes.includes(request.pid as string) || !resources.some((resource) => resource.id === request.resource)) throw new Error('Request refers to an unknown process or resource')
    return { pid: request.pid as string, resource: request.resource as string }
  })
  if (new Set(requests.map((request) => `${request.pid}/${request.resource}`)).size !== requests.length) throw new Error('Duplicate pending request')
  return structuredClone({ processes, resources, requests })
}

/** Single-instance, non-recursive, non-preemptible locks and AND-waits only. */
export function detectDeadlock(input: unknown) {
  const state = validateLocks(input)
  const edges: WaitEdge[] = state.requests.flatMap((request) => {
    const owner = state.resources.find((resource) => resource.id === request.resource)!.owner
    return owner === null ? [] : [{ from: request.pid, to: owner, resource: request.resource }]
  })
  const adjacency = new Map(state.processes.map((pid) => [pid, [...new Set(edges.filter((edge) => edge.from === pid).map((edge) => edge.to))]]))
  let ordinal = 0
  const indices = new Map<string, number>(), lows = new Map<string, number>()
  const stack: string[] = [], onStack = new Set<string>(), components: string[][] = []
  const visit = (pid: string) => {
    indices.set(pid, ordinal); lows.set(pid, ordinal++); stack.push(pid); onStack.add(pid)
    for (const next of adjacency.get(pid)!) {
      if (!indices.has(next)) { visit(next); lows.set(pid, Math.min(lows.get(pid)!, lows.get(next)!)) }
      else if (onStack.has(next)) lows.set(pid, Math.min(lows.get(pid)!, indices.get(next)!))
    }
    if (lows.get(pid) === indices.get(pid)) {
      const members: string[] = []
      let next: string
      do { next = stack.pop()!; onStack.delete(next); members.push(next) } while (next !== pid)
      if (members.length > 1 || adjacency.get(pid)!.includes(pid)) components.push(state.processes.filter((id) => members.includes(id)))
    }
  }
  state.processes.forEach((pid) => { if (!indices.has(pid)) visit(pid) })
  const deadlocked = state.processes.filter((pid) => components.some((component) => component.includes(pid)))
  const affected = new Set(deadlocked)
  let changed = true
  while (changed) {
    changed = false
    for (const edge of edges) if (affected.has(edge.to) && !affected.has(edge.from)) { affected.add(edge.from); changed = true }
  }
  return { state, edges, components, deadlocked, dependent: state.processes.filter((pid) => affected.has(pid) && !deadlocked.includes(pid)), hasDeadlock: deadlocked.length > 0 }
}
