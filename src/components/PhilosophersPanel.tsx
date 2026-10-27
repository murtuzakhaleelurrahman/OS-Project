import { useState } from 'react'
import { Philosophers, type DiningPolicy } from '../simulation/synchronization/Philosophers'
import { WaitForGraph } from './DeadlockPanel'

export function PhilosophersPanel() {
  const [lab, setLab] = useState(() => new Philosophers())
  const [snapshot, setSnapshot] = useState(() => lab.snapshot())
  const load = (policy: DiningPolicy) => { const next = new Philosophers(policy); setLab(next); setSnapshot(next.snapshot()) }
  return <section className="integrated-card"><p className="kicker">DINING PHILOSOPHERS / CIRCULAR WAIT</p><div className="integrated-heading"><h2>Five seats. Five forks.</h2><span className="tag">{snapshot.status.toUpperCase()}</span></div>
    <div className="integrated-controls"><label>Fork rule<select value={lab.policy} onChange={(event) => load(event.target.value as DiningPolicy)}><option value="NAIVE">Left first — can deadlock</option><option value="ORDERED">Lower-numbered fork first</option></select></label><button disabled={snapshot.status !== 'ready'} onClick={() => { lab.next(); setSnapshot(lab.snapshot()) }}>Next dining step</button><button className="quiet" disabled={snapshot.status !== 'ready'} onClick={() => { lab.runAll(); setSnapshot(lab.snapshot()) }}>Run dining demo</button><button className="quiet" onClick={() => load(lab.policy)}>Reset dining demo</button><button className="quiet" onClick={() => load('ORDERED')}>Use ordered forks</button></div>
    <p className="integrated-hint">Each philosopher eats once, using Fᵢ and F(i+1) mod 5. A deterministic round-robin script alternates lock attempts, eating and releases. Ordered acquisition breaks circular wait; this finite example does not claim a starvation guarantee for an infinite workload. Steps are laboratory operations, separate from integrated CPU time. Red seats are waiting; green seats have eaten. Graph colors indicate cycle membership.</p>
    <div className="advanced-grid"><div className="dining-table" role="img" aria-label={`Dining table: ${snapshot.actors.map((actor) => `${actor.id} ${actor.meals} meals`).join(', ')}`}>
      <svg viewBox="0 0 400 360"><circle cx="200" cy="180" r="85" fill="#e7e3d3" stroke="#9d9d86" /><text x="200" y="178" textAnchor="middle">{snapshot.actors.reduce((sum, actor) => sum + actor.meals, 0)} / 5 meals</text><text x="200" y="198" textAnchor="middle">Step {snapshot.step}</text>
        {snapshot.actors.map((actor, index) => {
          const angle = index * 2 * Math.PI / 5 - Math.PI / 2, forkAngle = angle - Math.PI / 5
          const x = 200 + 130 * Math.cos(angle), y = 180 + 130 * Math.sin(angle)
          return <g key={actor.id}><circle cx={x} cy={y} r="25" fill={actor.waiting !== undefined ? '#e2b0a3' : actor.meals ? '#c9dfb8' : '#dfe5d6'} stroke="#65775b" /><text x={x} y={y + 5} textAnchor="middle">{actor.id}</text><text x={200 + 115 * Math.cos(forkAngle)} y={180 + 115 * Math.sin(forkAngle)} textAnchor="middle">F{index}: {snapshot.owners[index] ?? 'free'}</text></g>
        })}
      </svg></div><WaitForGraph result={snapshot.detection} /></div>
    <p role="status">{snapshot.status === 'deadlocked' ? `Deadlock: ${snapshot.detection.deadlocked.join(', ')} form a circular wait. Switch to ordered forks to start a corrected run.` : snapshot.status === 'complete' ? 'All five philosophers ate; all forks are released.' : 'Advance the script to see fork ownership and waiting edges.'}</p>
    <div className="table-wrap"><table><thead><tr><th>Philosopher</th><th>Next action</th><th>Waiting for</th><th>Meals</th></tr></thead><tbody>{snapshot.actors.map((actor) => <tr key={actor.id}><td>{actor.id}</td><td>{['First fork', 'Second fork', 'Eat', 'Release second', 'Release first', 'Finished'][actor.stage]}</td><td>{actor.waiting === undefined ? 'none' : `F${actor.waiting}`}</td><td>{actor.meals}</td></tr>)}</tbody></table></div>
    <details><summary>Dining decision trace ({snapshot.trace.length} operations)</summary><ol className="integrated-trace">{[...snapshot.trace].reverse().map((entry) => <li key={entry.step}><time>#{entry.step}</time><div><strong>{entry.pid}</strong><p>{entry.message}</p></div></li>)}</ol></details>
  </section>
}
