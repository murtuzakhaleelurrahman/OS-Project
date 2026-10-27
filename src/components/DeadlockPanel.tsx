import { useId, useState } from 'react'
import { chainPreset, deadlockPreset, detectDeadlock } from '../simulation/resources/Deadlock'
import './AdvancedLabs.css'

export function WaitForGraph({ result }: { result: ReturnType<typeof detectDeadlock> }) {
  const marker = `wait-arrow-${useId().replaceAll(':', '')}`
  const nodes = result.state.processes.map((pid, index, all) => ({ pid, x: 250 + 125 * Math.cos(2 * Math.PI * index / all.length - Math.PI / 2), y: 190 + 125 * Math.sin(2 * Math.PI * index / all.length - Math.PI / 2) }))
  return <div className="wait-graph"><svg viewBox="0 0 500 380" role="img" aria-label={`Wait-for graph. Cycle members: ${result.deadlocked.join(', ') || 'none'}. Waiting behind cycle: ${result.dependent.join(', ') || 'none'}.`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#65775b" /></marker></defs>
    {result.edges.map((edge) => {
      const a = nodes.find((node) => node.pid === edge.from)!, b = nodes.find((node) => node.pid === edge.to)!
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / length, dy = (b.y - a.y) / length
      const cx = (a.x + b.x) / 2 - dy * 26, cy = (a.y + b.y) / 2 + dx * 26
      const path = a === b ? `M ${a.x - 12} ${a.y - 20} C ${a.x - 85} ${a.y - 95}, ${a.x + 85} ${a.y - 95}, ${a.x + 12} ${a.y - 20}` : `M ${a.x + dx * 25} ${a.y + dy * 25} Q ${cx} ${cy} ${b.x - dx * 28} ${b.y - dy * 28}`
      return <g key={`${edge.from}/${edge.resource}`}><path d={path} stroke="#65775b" strokeWidth="2" fill="none" markerEnd={`url(#${marker})`} /><text x={a === b ? a.x : cx} y={a === b ? a.y - 75 : cy - 5} textAnchor="middle">{edge.resource}</text></g>
    })}
    {nodes.map((node) => <g key={node.pid}><circle cx={node.x} cy={node.y} r="24" fill={result.deadlocked.includes(node.pid) ? '#e2b0a3' : result.dependent.includes(node.pid) ? '#edcf94' : '#dbe6ce'} stroke="#65775b" /><text x={node.x} y={node.y + 5} textAnchor="middle">{node.pid}</text></g>)}
    {!nodes.length && <text x="250" y="190" textAnchor="middle">Empty graph</text>}
  </svg><p className="integrated-hint">Arrow P → Q: P waits for a lock held by Q. Red: cycle member. Amber: waiting behind a cycle. Green: outside these groups.</p></div>
}

export function DeadlockPanel() {
  const [result, setResult] = useState(() => detectDeadlock(deadlockPreset))
  const [input, setInput] = useState(JSON.stringify(deadlockPreset, null, 2))
  const [error, setError] = useState('')
  const load = (value: unknown) => { try { const next = detectDeadlock(value); setResult(next); setInput(JSON.stringify(next.state, null, 2)); setError('') } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid lock state') } }
  return <section className="integrated-card"><p className="kicker">DEADLOCK / SINGLE-INSTANCE LOCKS</p><div className="integrated-heading"><h2>Wait-for graph detection</h2><span className="tag">{result.hasDeadlock ? 'DEADLOCK DETECTED' : 'NO CYCLE'}</span></div>
    <p className="integrated-hint">This detector uses current ownership and outstanding AND-waits on non-recursive, non-preemptible locks with exactly one instance each. Multi-instance resources are rejected. Banker safety above answers a different question about future maximum claims.</p>
    <div className="integrated-controls"><button onClick={() => load(deadlockPreset)}>Load deadlock example</button><button className="quiet" onClick={() => load(chainPreset)}>Load waiting chain</button></div>
    <div className="advanced-grid"><WaitForGraph result={result} /><div><p role="status">Cycle members: {result.deadlocked.join(', ') || 'none'} · Waiting behind cycle: {result.dependent.join(', ') || 'none'}</p><p className="integrated-hint">{result.components.length ? `Cyclic strongly connected groups: ${result.components.map((group) => `{${group.join(', ')}}`).join('; ')}. A group may contain several cycles.` : 'No deadlock under this model. A process waiting in an acyclic chain is not itself proof of deadlock.'}</p><div className="table-wrap"><table><thead><tr><th>Waiting process</th><th>Holder</th><th>Resource</th></tr></thead><tbody>{result.edges.map((edge) => <tr key={`${edge.from}/${edge.resource}`}><td>{edge.from}</td><td>{edge.to}</td><td>{edge.resource}</td></tr>)}</tbody></table></div></div></div>
    <details className="scenario-editor"><summary>Edit ownership and pending requests</summary><textarea aria-label="Deadlock lock-state JSON" value={input} onChange={(event) => setInput(event.target.value)} /><button onClick={() => { try { load(JSON.parse(input)) } catch { setError('Invalid JSON') } }}>Analyze lock state</button></details>{error && <p role="alert">{error}</p>}
  </section>
}
