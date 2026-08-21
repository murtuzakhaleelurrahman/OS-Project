import { useEffect, useState, type FormEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { SimulationEngine } from './simulation/engine/SimulationEngine'
import { ProcessState } from './simulation/process/Process'
import './App.css'

const engine = new SimulationEngine(500)

function App() {
  const [form, setForm] = useState({ name: '', burstTime: '5', priority: '1', memoryRequirement: '64' })
  const [error, setError] = useState('')
  const snapshot = useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    () => engine.getSnapshot(),
  )

  useEffect(() => () => engine.dispose(), [])

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
            <thead><tr><th>PID</th><th>Name</th><th>State</th><th>Arrival</th><th>Burst</th><th>Remaining</th><th>Priority</th><th>Memory</th><th>Actions</th></tr></thead>
            <tbody>{snapshot.processes.length === 0 ? <tr><td className="empty-cell" colSpan={9}>Create a process to inspect its lifecycle.</td></tr> : snapshot.processes.map((process) => <tr key={process.pid}>
              <td>{process.pid}</td><td>{process.name}</td><td><span className={`state state-${process.state.toLowerCase()}`}>{process.state}</span></td><td>{process.arrivalTime}</td><td>{process.burstTime}</td><td>{process.remainingTime}</td><td>{process.priority}</td><td>{process.memoryRequirement}</td>
              <td className="actions">{process.state === ProcessState.NEW && <button type="button" onClick={() => transition(process.pid, ProcessState.READY)}>Ready</button>}{process.state === ProcessState.READY && <button type="button" onClick={() => transition(process.pid, ProcessState.RUNNING)}>Run</button>}{process.state === ProcessState.RUNNING && <><button type="button" onClick={() => transition(process.pid, ProcessState.READY)}>Ready</button><button type="button" onClick={() => transition(process.pid, ProcessState.BLOCKED)}>Block</button><button type="button" onClick={() => transition(process.pid, ProcessState.TERMINATED)}>Terminate</button></>}{process.state === ProcessState.BLOCKED && <button type="button" onClick={() => transition(process.pid, ProcessState.READY)}>Unblock</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
