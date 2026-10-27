import { useState } from 'react'
import type { Scenario } from '../simulation/integrated/Scenario'
import type { IntegratedSnapshot } from '../simulation/integrated/IntegratedEngine'
import { compareFrameCounts, type ThrashingRow } from '../simulation/integrated/MemoryExperiments'
import './IntegratedMemoryPanel.css'

interface Props {
  scenario: Scenario
  snapshot: IntegratedSnapshot
  load: (scenario: unknown) => void
}

export function IntegratedMemoryPanel({ scenario, snapshot, load }: Props) {
  const [study, setStudy] = useState<ThrashingRow[]>([])
  const changeMemory = (patch: Partial<NonNullable<Scenario['memory']>>) => load({
    ...scenario,
    memory: {
      mode: 'demand', frames: 3, pageSize: 1024, replacement: 'FIFO', pageInTicks: 5,
      pageInCylinder: 0, ...scenario.memory, ...patch,
    },
  })
  const disable = () => {
    const { memory: _memory, ...withoutMemory } = scenario
    void _memory
    load({
      ...withoutMemory,
      processes: scenario.processes.map((process) => ({
        id: process.id, arrival: process.arrival, priority: process.priority,
        bursts: process.bursts.map((burst) => burst.kind === 'cpu' ? { kind: 'cpu', duration: burst.duration } : burst),
      })),
    })
  }
  return <section className="integrated-card">
    <div className="integrated-heading">
      <h2>Integrated memory</h2>
      <span className="tag">{scenario.memory ? `${scenario.memory.mode.toUpperCase()} / LOCAL ${scenario.memory.replacement}` : 'DISABLED'}</span>
    </div>
    <div className="integrated-controls">
      <label>Memory model
        <select value={scenario.memory?.mode ?? 'off'} onChange={(event) => event.target.value === 'off' ? disable() : changeMemory({ mode: event.target.value as 'fixed' | 'demand' })}>
          <option value="off">Disabled (original model)</option>
          <option value="fixed">Allocate all pages on admission</option>
          <option value="demand">Demand paging</option>
        </select>
      </label>
      {scenario.memory && <>
        <label>Physical frames
          <input type="number" min="1" max="256" defaultValue={scenario.memory.frames}
            key={`frames-${scenario.memory.frames}`} onBlur={(event) => {
              const frames = Number(event.currentTarget.value)
              if (frames !== scenario.memory!.frames) changeMemory({ frames })
            }} />
        </label>
        <label>Replacement
          <select value={scenario.memory.replacement} onChange={(event) => changeMemory({ replacement: event.target.value as 'FIFO' | 'LRU' })}>
            <option>FIFO</option><option>LRU</option>
          </select>
        </label>
        <label>Page-in ticks
          <input type="number" min="0" max="10000" defaultValue={scenario.memory.pageInTicks}
            key={`pagein-${scenario.memory.pageInTicks}`} onBlur={(event) => {
              const pageInTicks = Number(event.currentTarget.value)
              if (pageInTicks !== scenario.memory!.pageInTicks) changeMemory({ pageInTicks })
            }} />
        </label>
      </>}
      <button className="quiet" onClick={() => setStudy(compareFrameCounts())}>Compare frames / thrashing</button>
    </div>
    <p className="integrated-hint">
      Memory settings start a fresh run. A process reserves its frame quota on admission; insufficient free frames put it in the FIFO job queue.
      Demand paging starts empty, blocks on a fault, uses the shared disk and retries the same reference. Quotas, page size and per-tick page references are editable in scenario JSON.
      Pages are clean/read-only; dirty writeback is not modelled.
    </p>
    {snapshot.memory && <>
      <div className="integrated-stats memory-integration-stats">
        {[
          ['Reserved frames', `${snapshot.memory.usedFrames}/${snapshot.memory.configuration.frames}`],
          ['References', snapshot.memory.references], ['Page faults', snapshot.memory.faults],
          ['Page hits', snapshot.memory.hits], ['Replacements', snapshot.memory.replacements],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <p className="integrated-hint">Waiting for admission: {snapshot.jobQueue.join(' → ') || 'none'}. All frames are released on process termination.</p>
      <div className="memory-frame-grid">
        {snapshot.memory.frames.map((frame) => <div key={frame.index}>
          <strong>Frame {frame.index}</strong>
          <small>{frame.owner ?? 'FREE'}{frame.owner && (frame.loadingPage !== undefined ? ` / loading page ${frame.loadingPage}` : frame.page !== undefined ? ` / page ${frame.page}` : ' / reserved, empty')}</small>
        </div>)}
      </div>
    </>}
    {study.length > 0 && <div className="thrashing-study">
      <h3>Same workload, different frame counts</h3>
      <p className="integrated-hint">60 productive ticks, references 0 → 1 → 2 repeated, LRU, one process, 5 disk ticks per fault. Only frame count changes. This benchmark is independent of the current workload.</p>
      <div role="img" aria-label="Thrashing comparison: CPU utilization versus physical frames">
        {study.map((row) => <div className="thrashing-bar-row" key={row.frames}>
          <span>{row.frames} frames</span>
          <div className="thrashing-bar-track"><div style={{ width: `${row.utilization}%` }} /></div>
          <strong>{row.utilization.toFixed(1)}%</strong>
        </div>)}
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Frames</th><th>Faults</th><th>Hits</th><th>Useful CPU ticks</th><th>Elapsed ticks</th><th>Productive utilization</th></tr></thead>
        <tbody>{study.map((row) => <tr key={row.frames}><td>{row.frames}</td><td>{row.faults}</td><td>{row.hits}</td><td>{row.usefulTicks}</td><td>{row.elapsed}</td><td>{row.utilization.toFixed(1)}%</td></tr>)}</tbody>
      </table></div>
    </div>}
    {snapshot.time > 0 && <div className="process-state-lanes">
      <h3>Process-state timeline</h3>
      <p className="integrated-hint">Green: running · gray: READY · orange: disk I/O · red: page-fault blocked · purple: job queue. Waiting and blocked time are distinct.</p>
      {snapshot.processes.map((process) => <div className="state-lane" key={process.id}>
        <strong>{process.id}</strong><div>
          {snapshot.stateSegments.filter((segment) => segment.pid === process.id && segment.state !== 'NEW' && segment.state !== 'TERMINATED').map((segment, index) => <span
            key={index} className={`state-block lane-${segment.state.toLowerCase()} ${segment.reason === 'PAGE_FAULT' ? 'lane-fault' : ''}`}
            title={`${segment.state}${segment.reason ? ` / ${segment.reason}` : ''}: [${segment.start}, ${segment.end})`}
            style={{ left: `${segment.start / snapshot.time * 100}%`, width: `${(segment.end - segment.start) / snapshot.time * 100}%` }}
          />)}
        </div>
      </div>)}
    </div>}
  </section>
}
