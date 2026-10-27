import { detectDeadlock } from '../resources/Deadlock'
import { integer } from '../shared/validation'

export type DiningPolicy = 'NAIVE' | 'ORDERED'
interface Philosopher { id: string; stage: number; meals: number; waiting?: number }
export class Philosophers {
  readonly count: number
  readonly policy: DiningPolicy
  private actors: Philosopher[]
  private owners: (string | null)[]
  private cursor = 0
  private step = 0
  private trace: { step: number; pid: string; message: string }[] = []
  constructor(policy: DiningPolicy = 'NAIVE', count = 5) {
    if (policy !== 'NAIVE' && policy !== 'ORDERED') throw new Error('Unknown dining policy')
    this.count = integer(count, 'Philosophers', 2, 10); this.policy = policy
    this.actors = Array.from({ length: count }, (_, index) => ({ id: `P${index}`, stage: 0, meals: 0 }))
    this.owners = Array.from({ length: count }, () => null)
  }
  private forks(index: number): number[] {
    const pair = [index, (index + 1) % this.count]
    return this.policy === 'ORDERED' ? pair.sort((a, b) => a - b) : pair
  }
  snapshot() {
    const detection = detectDeadlock({
      processes: this.actors.map((actor) => actor.id),
      resources: this.owners.map((owner, index) => ({ id: `F${index}`, instances: 1, owner })),
      requests: this.actors.flatMap((actor) => actor.waiting === undefined ? [] : [{ pid: actor.id, resource: `F${actor.waiting}` }]),
    })
    const status = this.actors.every((actor) => actor.stage === 5) ? 'complete' : detection.hasDeadlock ? 'deadlocked' : 'ready'
    return structuredClone({ status, step: this.step, actors: this.actors, owners: this.owners, trace: this.trace, detection })
  }
  next(): boolean {
    if (this.snapshot().status !== 'ready') return false
    for (let offset = 0; offset < this.count; offset++) {
      const index = (this.cursor + offset) % this.count
      const actor = this.actors[index]
      if (actor.stage === 5 || (actor.waiting !== undefined && this.owners[actor.waiting] !== null)) continue
      this.cursor = (index + 1) % this.count
      const [first, second] = this.forks(index)
      let message: string
      if (actor.stage < 2) {
        const fork = actor.stage === 0 ? first : second
        if (this.owners[fork] !== null) { actor.waiting = fork; message = `Waits for F${fork}, held by ${this.owners[fork]}.` }
        else { this.owners[fork] = actor.id; actor.waiting = undefined; actor.stage++; message = `Acquired F${fork}.` }
      } else if (actor.stage === 2) { actor.meals++; actor.stage++; message = 'Eats one meal while holding both forks.' }
      else {
        const fork = actor.stage === 3 ? second : first
        this.owners[fork] = null; actor.stage++; message = `Released F${fork}${actor.stage === 5 ? '; finished' : ''}.`
      }
      this.trace.push({ step: ++this.step, pid: actor.id, message })
      return true
    }
    return false
  }
  runAll(): void { while (this.next()) { /* bounded one-meal scripts */ } }
}
