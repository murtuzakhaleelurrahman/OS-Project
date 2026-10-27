import { useEffect, useRef, useState } from 'react'
import { IntegratedEngine, type IntegratedSnapshot } from '../simulation/integrated/IntegratedEngine'
import { type Scenario } from '../simulation/integrated/Scenario'
import { checkPrediction, lessons, replayToEvent, savedScenarioKey, scenarioFragment, SeededStudy, type StudyRow } from '../simulation/integrated/LearningExperiments'
import { importScenario } from '../simulation/integrated/Experiments'
import './LearningTools.css'

const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete this experiment'
const display = (value: number | null) => value === null ? 'N/A' : value.toFixed(3)

export function ReplayControls({ engine, snapshot, replace }: { engine: IntegratedEngine; snapshot: IntegratedSnapshot; replace: (engine: IntegratedEngine) => void }) {
  const [history, setHistory] = useState<{ count: number; limited: boolean }>()
  const [error, setError] = useState('')
  const seek = (index: number) => {
    try { engine.pause(); replace(replayToEvent(engine.scenario, index)); setError('') }
    catch (failure) { setError(message(failure)) }
  }
  return <div className="learning-replay">
    <h3>Time travel</h3><p className="integrated-hint">Event {snapshot.processedEvents} · Replay reconstructs the exact queue-event prefix from time zero. Events at the same tick remain separate.</p>
    <div className="integrated-controls">
      <button className="quiet" disabled={!snapshot.processedEvents} onClick={() => seek(snapshot.processedEvents - 1)}>← Previous event</button>
      <button className="quiet" onClick={() => {
        engine.pause()
        const probe = new IntegratedEngine(engine.scenario)
        probe.runAll()
        const result = probe.getSnapshot()
        setHistory({ count: result.processedEvents, limited: result.status === 'limit' })
        probe.dispose()
      }}>Prepare replay slider</button>
      {history && <label className="replay-slider">Replay event<input aria-label="Replay event" type="range" min="0" max={history.count} value={snapshot.processedEvents} onChange={(event) => seek(Number(event.target.value))} /><span>{snapshot.processedEvents} / {history.count}</span></label>}
    </div>
    {history?.limited && <p role="status">Replay ends at the scenario’s event limit; this run is incomplete.</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function ScenarioSharing({ scenario, load }: { scenario: Scenario; load: (scenario: unknown) => void }) {
  const [notice, setNotice] = useState('')
  const [link, setLink] = useState('')
  const act = (action: () => void) => { try { action() } catch (error) { setNotice(message(error)) } }
  return <div className="learning-sharing"><h3>Save & share</h3>
    <p className="integrated-hint">Save one workload in this browser, or create a link containing the scenario. Links include the complete workload; playback and answers are not saved.</p>
    <div className="integrated-controls">
      <button className="quiet" onClick={() => act(() => { localStorage.setItem(savedScenarioKey, JSON.stringify(scenario)); setNotice('Workload saved in this browser.') })}>Save in browser</button>
      <button className="quiet" onClick={() => act(() => {
        const saved = localStorage.getItem(savedScenarioKey)
        if (!saved) throw new Error('No saved workload in this browser yet.')
        load(importScenario(saved)); setNotice('Saved workload loaded at event zero.')
      })}>Load saved workload</button>
      <button className="quiet" onClick={() => act(() => {
        const url = new URL(window.location.href)
        url.hash = scenarioFragment(scenario)
        setLink(url.href); setNotice('Share link ready. The recipient needs access to the same app address.')
      })}>Create share link</button>
    </div>
    {link && <label>Scenario share link<input className="share-link" aria-label="Scenario share link" readOnly value={link} onClick={(event) => event.currentTarget.select()} /></label>}
    {notice && <p role="status" className="integrated-hint">{notice}</p>}
  </div>
}

export function PredictionLesson() {
  const [id, setId] = useState<string>(lessons[0].id)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<ReturnType<typeof checkPrediction>>()
  const [error, setError] = useState('')
  const lesson = lessons.find((candidate) => candidate.id === id)!
  return <section className="integrated-card"><p className="kicker">LEARN / PREDICT FIRST</p><h2>Make a prediction.</h2>
    <div className="integrated-controls"><label>Exercise<select value={id} onChange={(event) => { setId(event.target.value); setAnswer(''); setResult(undefined); setError('') }}>{lessons.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label></div>
    <p>{lesson.question}</p>
    <form className="integrated-controls" onSubmit={(event) => {
      event.preventDefault()
      try { setResult(checkPrediction(id, answer)); setError('') } catch (failure) { setError(message(failure)) }
    }}><label>Your prediction<input value={answer} disabled={!!result} onChange={(event) => setAnswer(event.target.value)} placeholder={id === 'gantt' ? 'P1 P2 P3' : 'Fault count'} /></label><button disabled={!!result}>Check prediction</button><button type="button" className="quiet" onClick={() => { setResult(undefined); setAnswer(''); setError('') }}>Try again</button></form>
    {error && <p role="alert">{error}</p>}
    {result && <div className="prediction-result" role="status"><strong>{result.correct ? 'Correct prediction.' : 'Compare with the result.'}</strong><p>Your prediction: {answer} · Actual: {result.actual}</p><p>{result.explanation}</p></div>}
    <p className="integrated-hint">Each exercise runs a separate fixed scenario. Results are revealed after a valid prediction; the active experiment is unchanged.</p>
  </section>
}

function StudyChart({ rows, metric, title }: { rows: StudyRow[]; metric: 'averageWaiting' | 'averageTurnaround' | 'throughput'; title: string }) {
  const maximum = Math.max(...rows.map((row) => row[metric] ?? 0), 1e-9)
  return <div className="study-chart"><h3>{title}</h3>{rows.map((row) => <div className="study-bar" key={row.cpu}><span>{row.cpu.replaceAll('_', ' ')}</span><div><i style={{ width: `${(row[metric] ?? 0) / maximum * 100}%` }} /></div><strong>{display(row[metric])}</strong></div>)}</div>
}

export function SeededComparison({ engine }: { engine: IntegratedEngine }) {
  const [seed, setSeed] = useState('2026')
  const [samples, setSamples] = useState('100')
  const [processes, setProcesses] = useState('5')
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<ReturnType<SeededStudy['snapshot']>>()
  const [usedSettings, setUsedSettings] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const run = async () => {
    const token = ++generation.current
    try {
      if ([seed, samples, processes].some((value) => !value.trim())) throw new Error('Fill in the seed, workload count and process count.')
      const study = new SeededStudy(engine.scenario, { seed: Number(seed), samples: Number(samples), processes: Number(processes) })
      setUsedSettings(`Seed ${Number(seed)} · ${Number(samples)} workloads · ${Number(processes)} processes per workload · disk ${engine.scenario.disk.algorithm}`)
      engine.pause(); setRunning(true); setError(''); setReport(study.snapshot())
      while (generation.current === token && study.step()) {
        setReport(study.snapshot())
        // Yield between whole workloads; simulated time still advances only in the engines.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      if (generation.current === token) setRunning(false)
    } catch (failure) { if (generation.current === token) { setError(message(failure)); setRunning(false) } }
  }
  return <section className="integrated-card"><p className="kicker">RESEARCH / REPRODUCIBLE EXPERIMENTS</p><h2>Compare across seeded workloads.</h2>
    <p className="integrated-hint">Eight CPU policies use identical generated arrivals (0–15), priorities (0–7), CPU/I/O/CPU scripts (1–10 ticks per CPU burst), and uniform disk requests. Memory is disabled for this study; disk policy {engine.scenario.disk.algorithm}, switch cost, quantum and disk costs come from the active scenario.</p>
    <div className="integrated-controls"><label>Random seed<input type="number" min="0" max="4294967295" value={seed} disabled={running} onChange={(event) => setSeed(event.target.value)} /></label><label>Workloads<input type="number" min="1" max="100" value={samples} disabled={running} onChange={(event) => setSamples(event.target.value)} /></label><label>Processes per workload<input type="number" min="1" max="12" value={processes} disabled={running} onChange={(event) => setProcesses(event.target.value)} /></label><button disabled={running} onClick={run}>Run seeded comparison</button><button className="quiet" disabled={!running} onClick={() => { generation.current++; setRunning(false) }}>Stop comparison</button></div>
    {error && <p role="alert">{error}</p>}
    {report && <><p className="integrated-hint">Results for: {usedSettings}</p><p role="status">{report.processed} / {report.total} workloads compared{running ? ' · running' : report.processed < report.total ? ' · stopped; partial sample' : ' · complete'}.</p><p className="integrated-hint">Means weight each workload equally. Throughput is mean processes per tick. Any event-limited workload makes that policy’s means N/A. Zero-length bars can represent zero; values are printed alongside.</p>
      <div className="study-charts"><StudyChart rows={report.rows} metric="averageWaiting" title="Mean ready wait · ticks" /><StudyChart rows={report.rows} metric="averageTurnaround" title="Mean turnaround · ticks" /><StudyChart rows={report.rows} metric="throughput" title="Mean throughput · processes/tick" /></div>
      <div className="table-wrap"><table><thead><tr><th>CPU</th><th>Completed workloads</th><th>Limited workloads</th><th>Mean wait</th><th>Mean turnaround</th><th>Mean throughput</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.cpu}><td>{row.cpu}</td><td>{row.completed}</td><td>{row.limited}</td><td>{display(row.averageWaiting)}</td><td>{display(row.averageTurnaround)}</td><td>{display(row.throughput)}</td></tr>)}</tbody></table></div>
    </>}
  </section>
}
