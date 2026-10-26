import { integer } from '../integrated/Scenario'

export interface ResourceState { available: number[]; allocation: number[][]; maximum: number[][] }
export interface SafetyResult { safe: boolean; sequence: number[]; need: number[][]; steps: { process: number; before: number[]; after: number[] }[]; unfinished: number[] }
export interface RequestResult { status: 'granted' | 'deferred' | 'rejected'; reason: string; state: ResourceState; safety: SafetyResult }
export const bankerPreset: ResourceState = { available: [1], allocation: [[1], [1]], maximum: [[2], [3]] }

export function validateResources(value: unknown): ResourceState {
  if (!value || typeof value !== 'object') throw new Error('Resource state must be an object')
  const state = value as ResourceState
  if (!Array.isArray(state.available) || !state.available.length || state.available.length > 20) throw new Error('Available must contain 1–20 resource types')
  state.available.forEach((entry) => integer(entry, 'Available resource'))
  if (!Array.isArray(state.allocation) || state.allocation.length > 100 || !Array.isArray(state.maximum) || state.allocation.length !== state.maximum.length) throw new Error('Allocation and Maximum must have the same number of process rows (up to 100)')
  state.allocation.forEach((row, process) => {
    if (!Array.isArray(row) || row.length !== state.available.length || !Array.isArray(state.maximum[process]) || state.maximum[process].length !== row.length) throw new Error('Matrix dimensions must match the available resource vector')
    row.forEach((entry, resource) => {
      integer(entry, 'Allocation'); integer(state.maximum[process][resource], 'Maximum')
      if (entry > state.maximum[process][resource]) throw new Error('Allocation cannot exceed Maximum')
    })
  })
  return structuredClone(state)
}

export function checkSafety(input: unknown): SafetyResult {
  const state = validateResources(input)
  const need = state.maximum.map((row, process) => row.map((value, resource) => value - state.allocation[process][resource]))
  const work = [...state.available]
  const finished = state.allocation.map(() => false)
  const sequence: number[] = []
  const steps: SafetyResult['steps'] = []
  while (true) {
    const process = finished.findIndex((done, index) => !done && need[index].every((value, resource) => value <= work[resource]))
    if (process < 0) break
    const before = [...work]
    state.allocation[process].forEach((value, resource) => { work[resource] += value })
    finished[process] = true
    sequence.push(process)
    steps.push({ process, before, after: [...work] })
  }
  return { safe: finished.every(Boolean), sequence, need, steps, unfinished: finished.flatMap((done, process) => done ? [] : [process]) }
}

export function evaluateRequest(input: unknown, process: number, request: unknown): RequestResult {
  const state = validateResources(input)
  integer(process, 'Process index', 0, state.allocation.length - 1)
  if (!Array.isArray(request) || request.length !== state.available.length) throw new Error('Request must match the resource vector dimensions')
  request.forEach((entry) => integer(entry, 'Requested resource'))
  const initial = checkSafety(state)
  if (request.some((value, resource) => value > initial.need[process][resource])) return { status: 'rejected', reason: 'Request exceeds the process maximum remaining need.', state, safety: initial }
  if (request.some((value, resource) => value > state.available[resource])) return { status: 'deferred', reason: 'Request exceeds currently available resources; allocation is unchanged.', state, safety: initial }
  const tentative = structuredClone(state)
  request.forEach((value, resource) => { tentative.available[resource] -= value; tentative.allocation[process][resource] += value })
  const safety = checkSafety(tentative)
  if (!safety.safe) return { status: 'deferred', reason: 'Tentative state is unsafe. Request rolled back; allocation is unchanged.', state, safety }
  return { status: 'granted', reason: 'Tentative state is safe; request committed.', state: tentative, safety }
}
