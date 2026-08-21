import { useEffect, useSyncExternalStore } from 'react'
import { SimulationEngine } from './simulation/engine/SimulationEngine'
import './App.css'

const engine = new SimulationEngine(500)

function App() {
  const snapshot = useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    () => engine.getSnapshot(),
  )

  useEffect(() => () => engine.dispose(), [])

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
    </main>
  )
}

export default App
