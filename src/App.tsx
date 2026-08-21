import { useEffect, useState, type FormEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { SimulationEngine } from './simulation/engine/SimulationEngine'
import { ProcessState } from './simulation/process/Process'
import { SchedulerAlgorithm } from './simulation/cpu/Scheduler'
import { MemoryMode } from './simulation/memory/Memory'
import './App.css'

const engine = new SimulationEngine(500)

function App() {
  const [form, setForm] = useState({ name: '', burstTime: '5', priority: '1', memoryRequirement: '64' })
  const [error, setError] = useState('')
  const [algorithm, setAlgorithm] = useState<SchedulerAlgorithm>(SchedulerAlgorithm.FCFS)
  const [quantum, setQuantum] = useState('2')
  const snapshot = useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    () => engine.getSnapshot(),
  )

  useEffect(() => () => engine.pause(), [])

  const createProcess = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      engine.processManager.createProcess({
        name: form.name,
        burstTime: Number(form.burstTime),
        priority: Number(form.priority),
        memoryRequirement: Number(form.memoryRequirement),
      })
      setForm({ name: '', burstTime: '5', priority: '1', memoryRequirement: '64' })
      setError('')
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : 'Unable to create process')
    }
  }

  const transition = (pid: string, state: ProcessState) => {
    try {
      engine.processManager.transitionProcess(pid, state)
      setError('')
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : 'Invalid process transition')
    }
  }

  const changeScheduler = (nextAlgorithm: SchedulerAlgorithm) => {
    try {
      engine.setScheduler(nextAlgorithm, Number(quantum))
      setAlgorithm(nextAlgorithm)
      setError('')
    } catch (schedulerError) {
      setError(schedulerError instanceof Error ? schedulerError.message : 'Unable to change scheduler')
    }
  }

  const changeMemoryMode = (mode: MemoryMode) => {
    engine.memoryManager.setMode(mode)
  }

  return (
    <main className="dashboard">
      <header className="masthead">
        <div>
          <p className="eyebrow">MINI OS / PHASE 01</p>
          <h1>Simulation Control</h1>
        </div>
        <div className="clock-readout">
          <span>LOGICAL CLOCK</span>
          <strong>{String(snapshot.tick).padStart(3, '0')}</strong>
        </div>
      </header>

      <section className="control-panel" aria-label="Simulation controls">
        <label className="scheduler-choice">Algorithm<select value={algorithm} onChange={(event) => changeScheduler(event.target.value as SchedulerAlgorithm)}><option value={SchedulerAlgorithm.FCFS}>FCFS</option><option value={SchedulerAlgorithm.SJF}>SJF</option><option value={SchedulerAlgorithm.PRIORITY}>Priority</option><option value={SchedulerAlgorithm.ROUND_ROBIN}>Round Robin</option></select></label>
        <label className="quantum-choice">Quantum<input type="number" min="1" value={quantum} onChange={(event) => setQuantum(event.target.value)} onBlur={() => algorithm === SchedulerAlgorithm.ROUND_ROBIN && changeScheduler(algorithm)} /></label>
        <div className="status"><span className={snapshot.running ? 'pulse' : ''} />{snapshot.running ? 'RUNNING' : 'PAUSED'}</div>
        <button type="button" onClick={() => engine.start()} disabled={snapshot.running}>Start</button>
        <button type="button" onClick={() => engine.pause()} disabled={!snapshot.running}>Pause</button>
        <button type="button" onClick={() => engine.step()}>Step</button>
        <button type="button" onClick={() => engine.fastForward(10)}>Fast-forward 10</button>
        <button type="button" className="quiet" onClick={() => engine.reset()}>Reset</button>
      </section>

      <section className="event-panel">
        <div className="section-heading"><h2>System Event Log</h2><span>{snapshot.events.length} EVENTS</span></div>
        <ol>{snapshot.events.length === 0 ? <li className="empty">No events yet. Step the simulation to begin.</li> : snapshot.events.map((event) => <li key={event.id}><time>[{String(event.tick).padStart(3, '0')}]</time><span>{event.message}</span><small>{event.type}</small></li>)}</ol>
      </section>

      <section className="cpu-panel">
        <div className="section-heading"><h2>CPU</h2><span>{snapshot.cpu.algorithm}{snapshot.cpu.timeQuantum ? ` / Q${snapshot.cpu.timeQuantum}` : ''}</span></div>
        <div className="cpu-stats"><div><span>Status</span><strong>{snapshot.cpu.busy ? 'BUSY' : 'IDLE'}</strong></div><div><span>Running</span><strong>{snapshot.cpu.runningProcess?.pid ?? '-'}</strong></div><div><span>Remaining</span><strong>{snapshot.cpu.runningProcess?.remainingTime ?? '-'}</strong></div><div><span>Busy ticks</span><strong>{snapshot.cpu.busyTicks}</strong></div><div><span>Idle ticks</span><strong>{snapshot.cpu.idleTicks}</strong></div><div><span>Switches</span><strong>{snapshot.cpu.contextSwitches}</strong></div><div><span>Utilization</span><strong>{snapshot.cpu.utilization.toFixed(1)}%</strong></div></div>
      </section>

      <section className="memory-panel">
        <div className="section-heading"><h2>Memory Management</h2><span>PHASE 4A FOUNDATION</span></div>
        <div className="memory-controls"><label>Mode<select value={snapshot.memory.mode} onChange={(event) => changeMemoryMode(event.target.value as MemoryMode)}><option value={MemoryMode.CONTIGUOUS}>Contiguous</option><option value={MemoryMode.PAGED}>Paged</option></select></label><button type="button" className="quiet" onClick={() => engine.memoryManager.reset()}>Reset memory</button></div>
        <div className="memory-stats"><div><span>Total</span><strong>{snapshot.memory.totalMemory}</strong></div><div><span>Used</span><strong>{snapshot.memory.usedMemory}</strong></div><div><span>Free</span><strong>{snapshot.memory.freeMemory}</strong></div><div><span>Region count</span><strong>{snapshot.memory.regions.length}</strong></div></div>
        <div className="memory-regions"><h3>Physical memory regions</h3>{snapshot.memory.regions.map((region) => <div className="memory-region" key={`${region.startAddress}-${region.endAddress}`}><span>{`[${region.startAddress}, ${region.endAddress})`}</span><strong>{region.allocated ? `ALLOCATED${region.ownerPid ? ` / ${region.ownerPid}` : ''}` : 'FREE'}</strong><small>{region.size} units</small></div>)}</div>
        <p className="phase-note">Allocation strategies and paging are reserved for later memory phases.</p>
      </section>

      <section className="process-panel">
        <div className="section-heading"><h2>Process Management</h2><span>{snapshot.processCount} PROCESSES</span></div>
        <form className="process-form" onSubmit={createProcess}>
          <input required aria-label="Process name" placeholder="Process name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input required type="number" min="1" aria-label="Burst time" placeholder="Burst" value={form.burstTime} onChange={(event) => setForm({ ...form, burstTime: event.target.value })} />
          <input required type="number" aria-label="Priority" placeholder="Priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} />
          <input required type="number" min="0" aria-label="Memory requirement" placeholder="Memory" value={form.memoryRequirement} onChange={(event) => setForm({ ...form, memoryRequirement: event.target.value })} />
          <button type="submit">Create process</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>PID</th><th>Name</th><th>State</th><th>Arrival</th><th>Burst</th><th>Remaining</th><th>Priority</th><th>Memory</th><th>Completion</th><th>First start</th><th>Waiting</th><th>Turnaround</th><th>Response</th><th>Actions</th></tr></thead>
            <tbody>{snapshot.processes.length === 0 ? <tr><td className="empty-cell" colSpan={14}>Create a process to inspect its lifecycle.</td></tr> : snapshot.processes.map((process) => <tr key={process.pid}>
              <td>{process.pid}</td><td>{process.name}</td><td><span className={`state state-${process.state.toLowerCase()}`}>{process.state}</span></td><td>{process.arrivalTime}</td><td>{process.burstTime}</td><td>{process.remainingTime}</td><td>{process.priority}</td><td>{process.memoryRequirement}</td>{(() => { const metrics = snapshot.cpu.metrics.find((metric) => metric.pid === process.pid); return <><td>{metrics?.completionTime ?? '-'}</td><td>{metrics?.firstStartTime ?? '-'}</td><td>{metrics?.waitingTime ?? '-'}</td><td>{metrics?.turnaroundTime ?? '-'}</td><td>{metrics?.responseTime ?? '-'}</td></> })()}
              <td className="actions">{process.state === ProcessState.NEW && <button type="button" onClick={() => transition(process.pid, ProcessState.READY)}>Ready</button>}{process.state === ProcessState.READY && <button type="button" onClick={() => transition(process.pid, ProcessState.RUNNING)}>Run</button>}{process.state === ProcessState.RUNNING && <><button type="button" onClick={() => transition(process.pid, ProcessState.READY)}>Ready</button><button type="button" onClick={() => transition(process.pid, ProcessState.BLOCKED)}>Block</button><button type="button" onClick={() => transition(process.pid, ProcessState.TERMINATED)}>Terminate</button></>}{process.state === ProcessState.BLOCKED && <button type="button" onClick={() => transition(process.pid, ProcessState.READY)}>Unblock</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="queue-and-timeline"><div><h3>Ready queue</h3><p>{snapshot.readyQueue.map((process) => process.pid).join('  ') || 'Empty'}</p></div><div><h3>Execution segments</h3><p>{snapshot.cpu.executionSegments.map((segment) => `${segment.pid} ${segment.startTick}-${segment.endTick}`).join('  ') || 'No execution yet'}</p></div></div>
      </section>
    </main>
  )
}

export default App
