import { useEffect, useState, type FormEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { SimulationEngine } from './simulation/engine/SimulationEngine'
import { ProcessState } from './simulation/process/Process'
import { SchedulerAlgorithm } from './simulation/cpu/Scheduler'
import { AllocationStrategyType, MemoryMode } from './simulation/memory/Memory'
import type { TranslationResult } from './simulation/memory/PageManager'
import './App.css'

const engine = new SimulationEngine(500)

function App() {
  const [form, setForm] = useState({ name: '', burstTime: '5', priority: '1', memoryRequirement: '64' })
  const [error, setError] = useState('')
  const [memoryError, setMemoryError] = useState('')
  const [algorithm, setAlgorithm] = useState<SchedulerAlgorithm>(SchedulerAlgorithm.FCFS)
  const [quantum, setQuantum] = useState('2')
  const [allocationPid, setAllocationPid] = useState('')
  const [logicalAddress, setLogicalAddress] = useState('0')
  const [translation, setTranslation] = useState<TranslationResult | undefined>()
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
    try {
      engine.memoryManager.setMode(mode)
      setMemoryError('')
    } catch (memoryError) {
      setMemoryError(memoryError instanceof Error ? memoryError.message : 'Unable to change memory mode')
    }
  }

  const changeAllocationStrategy = (strategy: AllocationStrategyType) => {
    engine.memoryManager.setAllocationStrategy(strategy)
  }

  const allocateProcessMemory = () => {
    try {
      if (allocationPid.length === 0) throw new Error('Select a process to allocate')
      engine.memoryManager.allocateProcess(allocationPid)
      setMemoryError('')
    } catch (memoryError) {
      setMemoryError(memoryError instanceof Error ? memoryError.message : 'Unable to allocate memory')
    }
  }

  const deallocateProcessMemory = (pid: string) => {
    try {
      engine.memoryManager.deallocate(pid)
      setMemoryError('')
    } catch (memoryError) {
      setMemoryError(memoryError instanceof Error ? memoryError.message : 'Unable to deallocate memory')
    }
  }

  const allocatePages = () => {
    try {
      if (allocationPid.length === 0) throw new Error('Select a process to allocate')
      engine.memoryManager.pagingManager.allocateProcessPages(allocationPid)
      setMemoryError('')
    } catch (pagingError) {
      setMemoryError(pagingError instanceof Error ? pagingError.message : 'Unable to allocate pages')
    }
  }

  const deallocatePages = (pid: string) => {
    try {
      engine.memoryManager.pagingManager.deallocateProcessPages(pid)
      setMemoryError('')
    } catch (pagingError) {
      setMemoryError(pagingError instanceof Error ? pagingError.message : 'Unable to deallocate pages')
    }
  }

  const translateAddress = () => {
    try {
      if (allocationPid.length === 0) throw new Error('Select a process to translate')
      const result = engine.memoryManager.pagingManager.translate(allocationPid, Number(logicalAddress))
      setTranslation(result)
      setMemoryError(result.error ?? '')
    } catch (translationError) {
      setMemoryError(translationError instanceof Error ? translationError.message : 'Unable to translate address')
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
        <div className="section-heading"><h2>Memory Management</h2><span>{snapshot.memory.mode === MemoryMode.PAGED ? 'PHASE 4C / PAGING' : 'PHASE 4B / CONTIGUOUS'}</span></div>
        <div className="memory-controls"><label>Mode<select value={snapshot.memory.mode} onChange={(event) => { setTranslation(undefined); changeMemoryMode(event.target.value as MemoryMode) }}><option value={MemoryMode.CONTIGUOUS}>Contiguous</option><option value={MemoryMode.PAGED}>Paged</option></select></label>{snapshot.memory.mode === MemoryMode.CONTIGUOUS ? <><label>Strategy<select value={snapshot.memory.allocationStrategy} onChange={(event) => changeAllocationStrategy(event.target.value as AllocationStrategyType)}><option value={AllocationStrategyType.FIRST_FIT}>First Fit</option><option value={AllocationStrategyType.BEST_FIT}>Best Fit</option><option value={AllocationStrategyType.WORST_FIT}>Worst Fit</option></select></label><label>Process<select value={allocationPid} onChange={(event) => setAllocationPid(event.target.value)}><option value="">Select process</option>{snapshot.processes.map((process) => <option key={process.pid} value={process.pid}>{process.pid} / {process.memoryRequirement} units</option>)}</select></label><button type="button" onClick={allocateProcessMemory}>Allocate</button></> : <><label>Process<select value={allocationPid} onChange={(event) => setAllocationPid(event.target.value)}><option value="">Select process</option>{snapshot.processes.map((process) => <option key={process.pid} value={process.pid}>{process.pid} / {process.memoryRequirement} units</option>)}</select></label><button type="button" onClick={allocatePages}>Allocate pages</button></>}<button type="button" className="quiet" onClick={() => engine.memoryManager.reset()}>Reset memory</button></div>
        {memoryError && <p className="form-error" role="alert">{memoryError}</p>}
        {snapshot.memory.mode === MemoryMode.CONTIGUOUS ? <><div className="memory-stats"><div><span>Total</span><strong>{snapshot.memory.totalMemory}</strong></div><div><span>Used</span><strong>{snapshot.memory.usedMemory}</strong></div><div><span>Free</span><strong>{snapshot.memory.freeMemory}</strong></div><div><span>Allocations</span><strong>{snapshot.memory.allocationCount}</strong></div><div><span>Free regions</span><strong>{snapshot.memory.freeRegionCount}</strong></div><div><span>Largest free</span><strong>{snapshot.memory.largestFreeRegion}</strong></div><div><span>External fragmentation</span><strong>{snapshot.memory.externalFragmentation}</strong></div></div><div className="memory-regions"><h3>Physical memory regions</h3>{snapshot.memory.regions.map((region) => <div className="memory-region" key={`${region.startAddress}-${region.endAddress}`}><span>{`[${region.startAddress}, ${region.endAddress})`}</span><strong>{region.allocated ? `ALLOCATED / ${region.ownerPid}` : 'FREE'}</strong><small>{region.size} units {region.allocated && region.ownerPid && <button type="button" className="region-action" onClick={() => deallocateProcessMemory(region.ownerPid as string)}>Deallocate</button>}</small></div>)}</div></> : <><div className="memory-stats"><div><span>Total memory</span><strong>{snapshot.paging.configuration.totalMemory}</strong></div><div><span>Page size</span><strong>{snapshot.paging.configuration.pageSize}</strong></div><div><span>Total frames</span><strong>{snapshot.paging.totalFrames}</strong></div><div><span>Used frames</span><strong>{snapshot.paging.usedFrames}</strong></div><div><span>Free frames</span><strong>{snapshot.paging.freeFrames}</strong></div><div><span>Frame utilization</span><strong>{snapshot.paging.frameUtilization.toFixed(1)}%</strong></div><div><span>Allocated pages</span><strong>{snapshot.paging.totalAllocatedPages}</strong></div><div><span>Internal fragmentation</span><strong>{snapshot.paging.totalInternalFragmentation}</strong></div></div><div className="paging-grid"><div><h3>Frame table</h3>{snapshot.paging.frames.map((frame) => <div className="memory-region" key={frame.frameNumber}><span>Frame {frame.frameNumber} [{frame.startAddress},{frame.endAddress})</span><strong>{frame.occupied ? `${frame.ownerPid} Page ${frame.pageNumber}` : 'FREE'}</strong></div>)}</div><div><h3>Page tables</h3>{snapshot.paging.pageTables.length === 0 ? <p className="phase-note">No page tables.</p> : snapshot.paging.pageTables.map((table) => <div key={table.ownerPid}><strong>{table.ownerPid}</strong>{table.pages.map((page) => <p className="page-mapping" key={page.pageNumber}>Page {page.pageNumber} -&gt; {page.present ? `Frame ${page.frameNumber}` : 'PAGE FAULT'}</p>)}<button type="button" className="region-action" onClick={() => deallocatePages(table.ownerPid)}>Deallocate pages</button></div>)}</div></div><div className="translation-panel"><h3>Address translation</h3><label>Logical address<input type="number" min="0" value={logicalAddress} onChange={(event) => setLogicalAddress(event.target.value)} /></label><button type="button" onClick={translateAddress}>Translate</button>{translation && <p className="translation-result">Logical {translation.logicalAddress} / Page {translation.pageNumber} / Offset {translation.offset} / {translation.pageFault ? 'PAGE FAULT' : `Frame ${translation.frameNumber} / Physical ${translation.physicalAddress}`}</p>}</div></>}
        <p className="phase-note">Page replacement, eviction, and swapping are not implemented.</p>
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
