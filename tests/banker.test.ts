import { describe, expect, it } from 'vitest'
import { bankerPreset, checkSafety, evaluateRequest, validateResources } from '../src/simulation/resources/Banker'

describe('Banker resource laboratory', () => {
  it('matches the proposal safe sequence and unsafe request rollback', () => {
    expect(checkSafety(bankerPreset)).toMatchObject({ safe: true, sequence: [0, 1], need: [[1], [2]] })
    const original = structuredClone(bankerPreset)
    const result = evaluateRequest(original, 1, [1])
    expect(result).toMatchObject({ status: 'deferred', safety: { safe: false } })
    expect(result.state).toEqual(original)
    expect(original).toEqual(bankerPreset)
  })
  it('commits only safe requests and conserves total resources', () => {
    const result = evaluateRequest(bankerPreset, 0, [1])
    expect(result).toMatchObject({ status: 'granted', state: { available: [0], allocation: [[2], [1]] } })
    expect(result.state.available[0] + result.state.allocation.reduce((sum, row) => sum + row[0], 0)).toBe(3)
  })
  it('distinguishes requests exceeding Need from unavailable requests', () => {
    expect(evaluateRequest(bankerPreset, 0, [2]).status).toBe('rejected')
    expect(evaluateRequest(bankerPreset, 1, [2]).status).toBe('deferred')
    expect(() => evaluateRequest(bankerPreset, 0, [-1])).toThrow()
    expect(() => evaluateRequest(bankerPreset, 2, [1])).toThrow()
  })
  it('validates dimensions, integer counts and maximum claims', () => {
    for (const state of [null, { available: [] }, { available: [1], allocation: [[2]], maximum: [[1]] }, { available: [1, 2], allocation: [[1]], maximum: [[2]] }, { available: [-1], allocation: [], maximum: [] }, { available: [1], allocation: [[0.5]], maximum: [[2]] }]) expect(() => validateResources(state)).toThrow()
    expect(checkSafety({ available: [0], allocation: [], maximum: [] })).toMatchObject({ safe: true, sequence: [] })
  })
})
