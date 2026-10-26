import { useEffect, useState, useSyncExternalStore } from 'react'
import { IntegratedEngine } from '../simulation/integrated/IntegratedEngine'
import { cpuPreset, ioPreset, type Scenario } from '../simulation/integrated/Scenario'

const number = (value: number | null | undefined, suffix = '') => value == null ? 'N/A' : `${Number.isInteger(value) ? value : value.toFixed(2)}${suffix}`

export function IntegratedPanel() {
  const [engine, setEngine] = useState(() => new IntegratedEngine(ioPreset))
  const [input, setInput] = useState(JSON.stringify(ioPreset, null, 2))
  const [error, setError] = useState('')
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  useEffect(() => () => engine.pause(), [engine])
  const load = (value: unknown) => {
    try {
      const next = new IntegratedEngine(value)
      engine.dispose()
      setEngine(next)
      setInput(JSON.stringify(next.scenario, null, 2))
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load scenario') }
  }
  const policy = (algorithm: Scenario['cpu']['algorithm']) => load({ ...engine.scenario, cpu: { ...engine.scenario.cpu, algorithm } })
  return <main className="integrated">
    <header className="integrated-hero"><div><p className="kicker">OPERATING SYSTEMS / INTERACTIVE WORKBENCH</p><h1>Inside the system.</h1><p>Follow every decision, from arrival to completion.</p></div><div className="time-card"><span>LOGICAL TIME</span><strong>{snapshot.time.toString().padStart(3, '0')}</strong><small>ticks · {snapshot.playing ? 'playing' : snapshot.status}</small></div></header>
    <div className="model-note">INTEGRATED SYSTEM · One CPU + one disk · Zero switch cost · Lower priority number wins · SJF and Priority are non-preemptive</div>
    <section className="integrated-card">
      <div className="integrated-heading"><div><p className="kicker">01 / EXPERIMENT</p><h2>{engine.scenario.name}</h2></div><span className="tag">SCHEMA v1</span></div>
      <div className="integrated-controls">
        <label>Preset<select value={engine.scenario.name === ioPreset.name ? 'io' : engine.scenario.name === cpuPreset.name ? 'cpu' : 'custom'} onChange={(event) => load(event.target.value === 'io' ? ioPreset : cpuPreset)}><option value="io">CPU + disk overlap</option><option value="cpu">CPU scheduling oracle</option><option value="custom" disabled>Custom workload</option></select></label>
        <label>CPU policy<select value={engine.scenario.cpu.algorithm} onChange={(event) => policy(event.target.value as Scenario['cpu']['algorithm'])}><option>FCFS</option><option>SJF</option><option>PRIORITY</option><option value="ROUND_ROBIN">Round Robin</option></select></label>
        <label>Disk policy<select value={engine.scenario.disk.algorithm} onChange={(event) => load({ ...engine.scenario, disk: { ...engine.scenario.disk, algorithm: event.target.value } })}><option>FCFS</option><option>SSTF</option></select></label>
        <label>Quantum<input type="number" min="1" defaultValue={engine.scenario.cpu.quantum} key={`${engine.scenario.name}-${engine.scenario.cpu.quantum}`} onBlur={(event) => load({ ...engine.scenario, cpu: { ...engine.scenario.cpu, quantum: Number(event.target.value) } })} /></label>
        <button onClick={() => snapshot.playing ? engine.pause() : engine.play()} disabled={snapshot.status === 'complete' || snapshot.status === 'limit'}>{snapshot.playing ? 'Pause' : 'Play'}</button>
        <button className="quiet" onClick={() => { engine.pause(); engine.next() }} disabled={snapshot.status === 'complete' || snapshot.status === 'limit'}>Next event →</button>
        <button className="quiet" onClick={() => { engine.pause(); engine.runAll() }} disabled={snapshot.status === 'complete' || snapshot.status === 'limit'}>Run to end</button>
        <button className="quiet" onClick={() => engine.reset()}>Reset</button>
      </div>
      <p className="integrated-hint">Changing a policy starts a fresh run of the same workload. Next event processes exactly one queued event; several events can share a logical time.</p>
      {snapshot.status === 'limit' && <p role="alert" className="integrated-error">Stopped at the configured event limit ({engine.scenario.eventLimit}). Reset or load a larger limit to replay.</p>}
      {error && <p role="alert" className="integrated-error">{error}</p>}
      <details className="scenario-editor"><summary>Edit a workload / scenario JSON</summary><p>Arrival and priority are non-negative integers. Each CPU burst has a positive duration.</p><textarea aria-label="Scenario JSON" value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /><div className="integrated-controls"><button onClick={() => { try { load(JSON.parse(input)) } catch { setError('Invalid JSON; correct the scenario before loading.') } }}>Load scenario</button><button className="quiet" onClick={() => load(cpuPreset)}>CPU example preset</button></div></details>
    </section>
    <div className="integrated-stats">{[['CPU work', number(snapshot.busyTicks, ' ticks')], ['CPU utilization', number(snapshot.utilization, '%')], ['Throughput', number(snapshot.throughput, ' / tick')], ['Context switches', snapshot.contextSwitches]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <section className="integrated-card"><div className="integrated-heading"><h2>CPU timeline</h2><span className="tag">{snapshot.running ? `RUNNING ${snapshot.running}` : 'CPU IDLE'}</span></div><div className="gantt" aria-label="CPU Gantt chart">{snapshot.segments.length ? snapshot.segments.map((segment, index) => <div key={index} className={`gantt-segment ${segment.pid === 'IDLE' ? 'gantt-idle' : ''}`} style={{ flexGrow: segment.end - segment.start }}><strong>{segment.pid}</strong><small>{segment.start}–{segment.end}</small></div>) : <p className="integrated-hint">Advance the experiment to build the execution timeline.</p>}</div><p className="integrated-hint">Ready queue: {snapshot.ready.join(' → ') || 'empty'} · Next queued time: {number(snapshot.nextEventTime)}</p></section>
    <section className="integrated-card"><div className="integrated-heading"><h2>Processes</h2><span>{snapshot.processes.length} in this workload</span></div><div className="table-wrap"><table><thead><tr><th>Process</th><th>State</th><th>Arrival</th><th>Current CPU left</th><th>Ready wait</th><th>Blocked</th><th>Response</th><th>Completion</th><th>Turnaround</th></tr></thead><tbody>{snapshot.processes.map((process) => <tr key={process.id}><td><strong>{process.id}</strong></td><td><span className={`state state-${process.state.toLowerCase()}`}>{process.state}</span></td><td>{process.arrival}</td><td>{process.remaining}</td><td>{process.waiting}</td><td>{process.blocked}</td><td>{number(process.firstStart == null ? undefined : process.firstStart - process.arrival)}</td><td>{number(process.completion)}</td><td>{number(process.completion == null ? undefined : process.completion - process.arrival)}</td></tr>)}</tbody></table></div></section>
    <section className="integrated-card"><div className="integrated-heading"><h2>Disk service</h2><span className="tag">HEAD {snapshot.disk.head} · {snapshot.disk.active ? `SERVING ${snapshot.disk.active.pid}` : 'IDLE'}</span></div><p className="integrated-hint">Service = max(1, base {engine.scenario.disk.baseService} + seek cost {engine.scenario.disk.seekCost} × head movement). Total scheduled movement: {snapshot.disk.totalMovement} cylinders.</p><div className="table-wrap"><table><thead><tr><th>Request</th><th>Process</th><th>Cylinder</th><th>Enqueued</th><th>Start</th><th>Queue delay</th><th>Service</th><th>Completion</th></tr></thead><tbody>{snapshot.disk.requests.map((request) => <tr key={request.id}><td>R{request.id}</td><td>{request.pid}</td><td>{request.cylinder}</td><td>{request.enqueued}</td><td>{number(request.start)}</td><td>{number(request.start == null ? undefined : request.start - request.enqueued)}</td><td>{number(request.service)}</td><td>{number(request.completion)}</td></tr>)}</tbody></table></div></section>
    <section className="integrated-card"><div className="integrated-heading"><h2>Decision trace</h2><span>{snapshot.processedEvents} processed · latest {snapshot.retainedEvents} retained</span></div><p className="integrated-hint">At equal times: completions → arrivals → quantum expiry → dispatch. Trace retention is capped at 1,000 entries.</p><ol className="integrated-trace">{[...snapshot.trace].reverse().map((entry) => <li key={entry.sequence}><time>t={entry.time}</time><div><strong>{entry.type.replaceAll('_', ' ')}</strong><p>{entry.message}</p></div><small>#{entry.sequence}</small></li>)}</ol></section>
  </main>
}
