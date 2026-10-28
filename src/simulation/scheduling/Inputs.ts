export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Scenario and task entries must be objects')
  return input as Record<string, unknown>
}
export function rows(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) throw new Error(`Provide an array of up to ${maximum} tasks`)
  return input
}
export function identifier(input: unknown, seen: Set<string>): string {
  if (typeof input !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(input) || ['IDLE', 'SWITCH'].includes(input) || seen.has(input)) throw new Error('Task IDs must be unique; use letters/digits/underscore/hyphen, excluding IDLE and SWITCH')
  seen.add(input)
  return input
}
export interface ScheduleSegment { label: string; start: number; end: number }
export function appendSegment(segments: ScheduleSegment[], label: string, start: number): void {
  const last = segments.at(-1)
  if (last?.label === label && last.end === start) last.end++
  else segments.push({ label, start, end: start + 1 })
}
