export const integratedCpuPolicies = ['FCFS', 'SJF', 'PRIORITY', 'ROUND_ROBIN', 'SRTF', 'PREEMPTIVE_PRIORITY', 'AGING', 'MLFQ'] as const
export type IntegratedCpuPolicy = (typeof integratedCpuPolicies)[number]

export interface CpuCandidate {
  id: string
  readySince: number
  order: number
  work: number
  priority: number
  level: number
}

export function effectivePriority(candidate: CpuCandidate, time: number, interval: number): number {
  return candidate.priority - Math.floor(Math.max(0, time - candidate.readySince) / interval)
}

/** Shared ranking; each model supplies its own meaning of work and ready-entry time. */
export function compareCpuCandidates(a: CpuCandidate, b: CpuCandidate, policy: IntegratedCpuPolicy, time = 0, agingInterval = 5): number {
  let primary = 0
  if (policy === 'SJF' || policy === 'SRTF') primary = a.work - b.work
  if (policy === 'PRIORITY' || policy === 'PREEMPTIVE_PRIORITY') primary = a.priority - b.priority
  if (policy === 'AGING') primary = effectivePriority(a, time, agingInterval) - effectivePriority(b, time, agingInterval)
  if (policy === 'MLFQ') primary = a.level - b.level
  const fifo = policy === 'ROUND_ROBIN' || policy === 'MLFQ'
  return primary || a.readySince - b.readySince || (fifo ? a.order - b.order : 0)
    || a.id.localeCompare(b.id, undefined, { numeric: true })
}
