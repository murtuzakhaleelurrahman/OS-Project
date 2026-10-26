import { integer } from '../shared/validation'

export type ActorInstruction = { op: 'read' | 'increment' | 'write' | 'produce' | 'consume' } | { op: 'lock' | 'unlock' | 'wait' | 'signal'; resource: string }
export interface ActorScript { id: string; program: ActorInstruction[] }
export interface ActorScenario { name: string; initialValue: number; capacity: number; mutexes: string[]; semaphores: Record<string, number>; actors: ActorScript[]; schedule: string[] }
interface ActorRuntime extends ActorScript { pc: number; local: number; blockedOn?: string; blockedTicks: number }
interface Mutex { owner?: string; waiters: string[] }
interface Semaphore { permits: number; waiters: string[]; held: Record<string, number> }
export interface ActorTrace { tick: number; actor: string; operation: string; message: string; shared: number; occupancy: number }

const incrementProgram: ActorInstruction[] = [{ op: 'read' }, { op: 'increment' }, { op: 'write' }]
export const lostUpdatePreset: ActorScenario = { name: 'Lost update', initialValue: 0, capacity: 2, mutexes: ['m'], semaphores: {}, actors: [{ id: 'A', program: incrementProgram }, { id: 'B', program: incrementProgram }], schedule: ['A', 'B', 'A', 'B', 'A', 'B'] }
export const mutexPreset: ActorScenario = { ...lostUpdatePreset, name: 'Mutex-protected increment', actors: ['A', 'B'].map((id) => ({ id, program: [{ op: 'lock', resource: 'm' }, ...incrementProgram, { op: 'unlock', resource: 'm' }] })) }
export const bufferPreset: ActorScenario = {
  name: 'Bounded buffer', initialValue: 0, capacity: 2, mutexes: ['m'], semaphores: { empty: 2, full: 0 }, schedule: [],
  actors: [
    { id: 'Producer', program: Array.from({ length: 3 }, (): ActorInstruction[] => [{ op: 'wait', resource: 'empty' }, { op: 'lock', resource: 'm' }, { op: 'produce' }, { op: 'unlock', resource: 'm' }, { op: 'signal', resource: 'full' }]).flat() },
    { id: 'Consumer', program: Array.from({ length: 3 }, (): ActorInstruction[] => [{ op: 'wait', resource: 'full' }, { op: 'lock', resource: 'm' }, { op: 'consume' }, { op: 'unlock', resource: 'm' }, { op: 'signal', resource: 'empty' }]).flat() },
  ],
}

export function validateActorScenario(input: unknown): ActorScenario {
  if (!input || typeof input !== 'object') throw new Error('Actor scenario must be an object')
  const scenario = input as ActorScenario
  if (typeof scenario.name !== 'string' || !scenario.name.trim()) throw new Error('Scenario name is required')
  integer(scenario.initialValue, 'Initial value'); integer(scenario.capacity, 'Buffer capacity', 1, 100)
  if (!Array.isArray(scenario.mutexes) || new Set(scenario.mutexes).size !== scenario.mutexes.length || scenario.mutexes.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('Mutex IDs must be unique non-empty strings')
  if (!scenario.semaphores || typeof scenario.semaphores !== 'object' || Array.isArray(scenario.semaphores)) throw new Error('Semaphores must be an object of permit counts')
  for (const [id, permits] of Object.entries(scenario.semaphores)) { if (!id.trim() || scenario.mutexes.includes(id)) throw new Error('Resource IDs must be unique'); integer(permits, 'Semaphore permits') }
  if (!Array.isArray(scenario.actors) || !scenario.actors.length || scenario.actors.length > 20) throw new Error('Provide 1–20 actors')
  const ids = new Set<string>()
  for (const actor of scenario.actors) {
    if (!actor || typeof actor.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(actor.id) || ids.has(actor.id)) throw new Error('Actor IDs must be unique')
    ids.add(actor.id)
    if (!Array.isArray(actor.program) || actor.program.length > 200) throw new Error('Each actor needs an instruction array of up to 200 operations')
    for (const instruction of actor.program) {
      if (!instruction || !['read', 'increment', 'write', 'lock', 'unlock', 'wait', 'signal', 'produce', 'consume'].includes(instruction.op)) throw new Error('Unknown actor instruction')
      if ((instruction.op === 'lock' || instruction.op === 'unlock') && !scenario.mutexes.includes(instruction.resource)) throw new Error('Instruction refers to an unknown mutex')
      if ((instruction.op === 'wait' || instruction.op === 'signal') && !Object.hasOwn(scenario.semaphores, instruction.resource)) throw new Error('Instruction refers to an unknown semaphore')
      if ((instruction.op === 'produce' || instruction.op === 'consume') && (!scenario.mutexes.includes('m') || !Object.hasOwn(scenario.semaphores, 'empty') || !Object.hasOwn(scenario.semaphores, 'full'))) throw new Error('Buffer operations require mutex m and semaphores empty/full')
    }
  }
  if (!Array.isArray(scenario.schedule) || scenario.schedule.length > 1000 || scenario.schedule.some((id) => !ids.has(id))) throw new Error('Schedule must reference known actor IDs (up to 1000 entries)')
  return structuredClone(scenario)
}

export class ActorLab {
  readonly scenario: ActorScenario
  private actors: ActorRuntime[]
  private mutexes = new Map<string, Mutex>()
  private semaphores = new Map<string, Semaphore>()
  private shared: number
  private buffer: string[] = []
  private consumed: string[] = []
  private produced = 0
  private tick = 0
  private cursor = 0
  private trace: ActorTrace[] = []
  private error: string | undefined

  constructor(input: unknown) {
    this.scenario = validateActorScenario(input)
    this.actors = this.scenario.actors.map((actor) => ({ ...structuredClone(actor), pc: 0, local: 0, blockedTicks: 0 }))
    this.shared = this.scenario.initialValue
    this.scenario.mutexes.forEach((id) => this.mutexes.set(id, { waiters: [] }))
    Object.entries(this.scenario.semaphores).forEach(([id, permits]) => this.semaphores.set(id, { permits, waiters: [], held: Object.create(null) as Record<string, number> }))
  }
  getSnapshot() {
    const unfinished = this.actors.filter((actor) => actor.pc < actor.program.length)
    const status = this.error ? 'error' : !unfinished.length ? 'complete' : this.tick >= 1000 ? 'limit' : unfinished.every((actor) => actor.blockedOn) ? 'blocked' : 'ready'
    return structuredClone({ status, error: this.error, tick: this.tick, shared: this.shared, actors: this.actors, buffer: this.buffer, consumed: this.consumed, produced: this.produced, trace: this.trace, mutexes: Object.fromEntries(this.mutexes), semaphores: Object.fromEntries(this.semaphores) })
  }
  next(): boolean {
    if (this.getSnapshot().status !== 'ready') return false
    const specified = this.scenario.schedule[this.tick]
    let actor = specified ? this.actors.find((candidate) => candidate.id === specified && !candidate.blockedOn && candidate.pc < candidate.program.length) : undefined
    if (!actor) {
      for (let count = 0; count < this.actors.length; count++) {
        const index = (this.cursor + count) % this.actors.length
        if (!this.actors[index].blockedOn && this.actors[index].pc < this.actors[index].program.length) { actor = this.actors[index]; this.cursor = (index + 1) % this.actors.length; break }
      }
    }
    if (!actor) return false
    for (const candidate of this.actors) if (candidate.blockedOn) candidate.blockedTicks++
    const instruction = actor.program[actor.pc]
    let advance = true
    let message = ''
    try {
      if (instruction.op === 'read') { actor.local = this.shared; message = `Read shared ${this.shared} into local register.` }
      if (instruction.op === 'increment') { actor.local++; message = `Incremented local register to ${actor.local}.` }
      if (instruction.op === 'write') { this.shared = actor.local; message = `Wrote local ${actor.local} to shared value.` }
      if (instruction.op === 'lock') {
        const mutex = this.mutexes.get(instruction.resource)!
        if (mutex.owner === actor.id) throw new Error('Mutex is not reentrant')
        if (!mutex.owner) { mutex.owner = actor.id; message = `Acquired mutex ${instruction.resource}.` }
        else { mutex.waiters.push(actor.id); actor.blockedOn = instruction.resource; advance = false; message = `Blocked in FIFO queue for mutex ${instruction.resource}.` }
      }
      if (instruction.op === 'unlock') {
        const mutex = this.mutexes.get(instruction.resource)!
        if (mutex.owner !== actor.id) throw new Error('Mutex release requires ownership')
        mutex.owner = mutex.waiters.shift()
        if (mutex.owner) this.wake(mutex.owner)
        message = `Released mutex ${instruction.resource}${mutex.owner ? `; ownership transferred to ${mutex.owner}` : ''}.`
      }
      if (instruction.op === 'wait') {
        const semaphore = this.semaphores.get(instruction.resource)!
        if (semaphore.permits) { semaphore.permits--; semaphore.held[actor.id] = (semaphore.held[actor.id] ?? 0) + 1; message = `Acquired one ${instruction.resource} permit.` }
        else { semaphore.waiters.push(actor.id); actor.blockedOn = instruction.resource; advance = false; message = `Blocked in FIFO queue for ${instruction.resource}.` }
      }
      if (instruction.op === 'signal') {
        const semaphore = this.semaphores.get(instruction.resource)!
        if (semaphore.held[actor.id]) semaphore.held[actor.id]--
        const waiter = semaphore.waiters.shift()
        if (waiter) { semaphore.held[waiter] = (semaphore.held[waiter] ?? 0) + 1; this.wake(waiter) }
        else semaphore.permits++
        message = `Signalled ${instruction.resource}${waiter ? `; permit transferred to ${waiter}` : ''}.`
      }
      if (instruction.op === 'produce' || instruction.op === 'consume') {
        if (this.mutexes.get('m')?.owner !== actor.id) throw new Error('Buffer access requires ownership of mutex m')
        const permit = this.semaphores.get(instruction.op === 'produce' ? 'empty' : 'full')!
        if (!permit.held[actor.id]) throw new Error('Buffer operation requires the matching reserved semaphore permit')
        if (instruction.op === 'produce') {
          if (this.buffer.length >= this.scenario.capacity) throw new Error('Buffer capacity would be exceeded')
          const item = `item-${++this.produced}`; this.buffer.push(item); message = `Produced ${item}; occupancy ${this.buffer.length}/${this.scenario.capacity}.`
        } else {
          if (!this.buffer.length) throw new Error('Cannot consume an empty buffer')
          const item = this.buffer.shift()!; this.consumed.push(item); message = `Consumed ${item}; occupancy ${this.buffer.length}/${this.scenario.capacity}.`
        }
        permit.held[actor.id]--
      }
      if (advance) actor.pc++
    } catch (failure) { this.error = failure instanceof Error ? failure.message : 'Invalid actor operation'; message = this.error }
    this.tick++
    this.trace.push({ tick: this.tick, actor: actor.id, operation: instruction.op, message, shared: this.shared, occupancy: this.buffer.length })
    return true
  }
  runAll(): void { while (this.next()) { /* bounded scripted execution */ } }
  private wake(id: string): void { const actor = this.actors.find((candidate) => candidate.id === id)!; actor.blockedOn = undefined; actor.pc++ }
}
