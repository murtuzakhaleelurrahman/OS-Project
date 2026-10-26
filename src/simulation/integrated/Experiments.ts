import { IntegratedEngine, type IntegratedSnapshot } from './IntegratedEngine'
import { parseScenario, type Scenario } from './Scenario'

export const modelAssumptions = {
  model: 'Single CPU, single disk; educational simulation', units: 'integer logical ticks; disk movement in cylinders',
  contextSwitchCost: 0, phases: ['completion', 'arrival', 'quantum expiry', 'dispatch'],
  cpuTies: 'ready-entry time then natural process ID; Round Robin uses FIFO ready entry',
  priority: 'lower number is higher priority', sjf: 'non-preemptive, next known CPU burst',
  diskTies: 'enqueue sequence; active service is never preempted',
  diskService: 'max(1, baseService + seekCost * absolute head movement)',
  metricHorizon: 'time 0 to final completion; incomplete results explicitly labelled',
  traceRetention: 1000,
} as const

export interface ComparisonRow {
  cpu: Scenario['cpu']['algorithm']; disk: Scenario['disk']['algorithm']; status: string
  elapsed: number; utilization: number | null; throughput: number | null; averageWaiting: number | null
  averageTurnaround: number | null; diskMovement: number
}
export function comparePolicies(input: unknown): ComparisonRow[] {
  const scenario = parseScenario(input)
  const rows: ComparisonRow[] = []
  for (const cpu of ['FCFS', 'SJF', 'PRIORITY', 'ROUND_ROBIN'] as const) {
    for (const disk of ['FCFS', 'SSTF'] as const) {
      const engine = new IntegratedEngine({ ...structuredClone(scenario), cpu: { ...scenario.cpu, algorithm: cpu }, disk: { ...scenario.disk, algorithm: disk } })
      engine.runAll()
      const result = engine.getSnapshot()
      const complete = result.status === 'complete' && result.processes.length > 0
      rows.push({ cpu, disk, status: result.status, elapsed: result.time, utilization: result.utilization, throughput: result.throughput,
        averageWaiting: complete ? result.processes.reduce((sum, process) => sum + process.waiting, 0) / result.processes.length : null,
        averageTurnaround: complete ? result.processes.reduce((sum, process) => sum + process.completion! - process.arrival, 0) / result.processes.length : null,
        diskMovement: result.disk.totalMovement })
      engine.dispose()
    }
  }
  return rows
}
export function resultBundle(scenario: Scenario, result: IntegratedSnapshot) {
  return { schemaVersion: 1, kind: 'mini-os-result', scenario: structuredClone(scenario), assumptions: modelAssumptions, traceTruncated: result.processedEvents > result.retainedEvents, result: structuredClone(result) }
}
export function importScenario(text: string): Scenario {
  if (text.length > 1_000_000) throw new Error('Scenario input is limited to 1 MB')
  const value = JSON.parse(text)
  return parseScenario(value?.kind === 'mini-os-result' ? value.scenario : value)
}
function csvCell(value: unknown): string {
  let text = value == null ? 'N/A' : String(value)
  if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
function csv(rows: unknown[][]): string { return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n' }
const metadataHeaders = ['schema_version', 'scenario', 'cpu_policy', 'quantum', 'disk_policy', 'base_service', 'seek_cost', 'context_switch_cost', 'units', 'phase_order', 'cpu_ties', 'disk_ties', 'priority_rule', 'metric_horizon']
function metadata(scenario: Scenario): unknown[] { return [1, scenario.name, scenario.cpu.algorithm, scenario.cpu.quantum, scenario.disk.algorithm, scenario.disk.baseService, scenario.disk.seekCost, 0, modelAssumptions.units, modelAssumptions.phases.join(' > '), modelAssumptions.cpuTies, modelAssumptions.diskTies, modelAssumptions.priority, modelAssumptions.metricHorizon] }
export function traceCsv(scenario: Scenario, result: IntegratedSnapshot): string {
  return csv([[...metadataHeaders, 'status', 'processed_events', 'trace_truncated', 'sequence', 'time', 'phase', 'type', 'process', 'explanation'], ...result.trace.map((event) => [...metadata(scenario), result.status, result.processedEvents, result.processedEvents > result.retainedEvents, event.sequence, event.time, event.phase, event.type, event.pid ?? '', event.message])])
}
export function metricsCsv(scenario: Scenario, result: IntegratedSnapshot): string {
  const system = [result.status, result.time, result.busyTicks, result.idleTicks, result.utilization, result.throughput, result.disk.totalMovement]
  const rows = result.processes.length ? result.processes.map((process) => [...metadata(scenario), ...system, process.id, process.arrival, process.completion, process.firstStart == null ? null : process.firstStart - process.arrival, process.waiting, process.blocked, process.completion == null ? null : process.completion - process.arrival]) : [[...metadata(scenario), ...system, '', '', '', '', '', '', '']]
  return csv([[...metadataHeaders, 'status', 'elapsed_ticks', 'productive_ticks', 'idle_ticks', 'cpu_utilization_percent', 'throughput_processes_per_tick', 'disk_movement_cylinders', 'process', 'arrival', 'completion', 'response', 'ready_wait', 'blocked', 'turnaround'], ...rows])
}
