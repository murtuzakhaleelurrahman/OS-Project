export const ProcessState = {
  NEW: 'NEW',
  READY: 'READY',
  RUNNING: 'RUNNING',
  BLOCKED: 'BLOCKED',
  TERMINATED: 'TERMINATED',
} as const

export type ProcessState = (typeof ProcessState)[keyof typeof ProcessState]

export interface Process {
  readonly pid: string
  readonly name: string
  readonly state: ProcessState
  readonly arrivalTime: number
  readonly burstTime: number
  readonly remainingTime: number
  readonly priority: number
  readonly memoryRequirement: number
  readonly programCounter: number
}

export interface ProcessConfiguration {
  readonly name: string
  readonly arrivalTime?: number
  readonly burstTime: number
  readonly priority: number
  readonly memoryRequirement: number
}

export type ProcessStateTransition = `${ProcessState} -> ${ProcessState}`

export const VALID_PROCESS_TRANSITIONS: ReadonlySet<ProcessStateTransition> = new Set<ProcessStateTransition>([
  `${ProcessState.NEW} -> ${ProcessState.READY}`,
  `${ProcessState.NEW} -> ${ProcessState.TERMINATED}`,
  `${ProcessState.READY} -> ${ProcessState.RUNNING}`,
  `${ProcessState.RUNNING} -> ${ProcessState.READY}`,
  `${ProcessState.RUNNING} -> ${ProcessState.BLOCKED}`,
  `${ProcessState.BLOCKED} -> ${ProcessState.READY}`,
  `${ProcessState.RUNNING} -> ${ProcessState.TERMINATED}`,
])

export function isValidProcessTransition(
  currentState: ProcessState,
  nextState: ProcessState,
): boolean {
  return VALID_PROCESS_TRANSITIONS.has(`${currentState} -> ${nextState}`)
}