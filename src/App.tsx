import { useEffect, useState, type FormEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { SimulationEngine } from './simulation/engine/SimulationEngine'
import { ProcessState } from './simulation/process/Process'
import { SchedulerAlgorithm } from './simulation/cpu/Scheduler'
import { AllocationStrategyType, MemoryMode } from './simulation/memory/Memory'
import type { TranslationResult } from './simulation/memory/PageManager'
import { PageReplacementAlgorithm } from './simulation/memory/PageReplacement'
import type { DiskDirection, DiskSchedulingAlgorithm } from './simulation/disk/DiskScheduling'
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
  const [referenceInput, setReferenceInput] = useState('1 2 3 1 4 2 5 1')
  const [referenceError, setReferenceError] = useState('')
  const [diskCylinder, setDiskCylinder] = useState('')
  const [diskBulkInput, setDiskBulkInput] = useState('40 10 120 70')
  const [diskError, setDiskError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [syncPid, setSyncPid] = useState('')
  const [mutexId, setMutexId] = useState('')
  const [semaphoreId, setSemaphoreId] = useState('')
  const [resourceId, setResourceId] = useState('shared-resource')
  const [newMutexId, setNewMutexId] = useState('')
  const [newSemaphoreId, setNewSemaphoreId] = useState('')
  const [semaphorePermits, setSemaphorePermits] = useState('1')
  const [bufferCapacity, setBufferCapacity] = useState('5')
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

  const setReplacementAlgorithm = (nextAlgorithm: PageReplacementAlgorithm) => {
    engine.memoryManager.pagingManager.setReplacementAlgorithm(nextAlgorithm)
    engine.memoryManager.pagingManager.resetReplacementSimulation()
    setReferenceError('')
  }

  const applyReferenceString = () => {
    const tokens = referenceInput.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0 || tokens.length > 100 || tokens.some((token) => !/^\d+$/.test(token))) {
      setReferenceError('Enter 1 to 100 non-negative integer page numbers separated by spaces.')
      return
    }
    engine.memoryManager.pagingManager.setReferenceString(tokens.map(Number))
    setReferenceError('')
  }

  const stepReference = () => {
    try {
      engine.memoryManager.pagingManager.stepReference()
      setReferenceError('')
    } catch (referenceErrorValue) {
      setReferenceError(referenceErrorValue instanceof Error ? referenceErrorValue.message : 'Unable to step reference')
    }
  }

  const addDiskRequest = () => { try { engine.diskManager.requestDiskAccess(Number(diskCylinder)); setDiskCylinder(''); setDiskError('') } catch (diskRequestError) { setDiskError(diskRequestError instanceof Error ? diskRequestError.message : 'Unable to add disk request') } }
  const loadDiskRequests = () => { try { const values = diskBulkInput.trim().split(/[\s,]+/).filter(Boolean).map(Number); if (values.length === 0 || values.some((value) => !Number.isInteger(value))) throw new Error('Enter integer cylinder numbers separated by spaces or commas'); engine.diskManager.addBulkRequests(values); setDiskError('') } catch (bulkError) { setDiskError(bulkError instanceof Error ? bulkError.message : 'Unable to load disk requests') } }
  const changeDiskAlgorithm = (value: DiskSchedulingAlgorithm) => { engine.diskManager.setAlgorithm(value); setDiskError('') }
  const changeDiskDirection = (value: DiskDirection) => { engine.diskManager.setDirection(value); setDiskError('') }
  const runSynchronization = (operation: () => void) => { try { operation(); setSyncError('') } catch (syncOperationError) { setSyncError(syncOperationError instanceof Error ? syncOperationError.message : 'Synchronization operation failed') } }
  const createMutex = () => runSynchronization(() => { const mutex = engine.synchronizationManager.createMutex(newMutexId); setMutexId(mutex.id); setNewMutexId('') })
  const createSemaphore = () => runSynchronization(() => { const semaphore = engine.synchronizationManager.createSemaphore(newSemaphoreId, Number(semaphorePermits)); setSemaphoreId(semaphore.id); setNewSemaphoreId('') })

  return (
    <main className="dashboard">
      <header className="masthead">
        <div>
          <p className="eyebrow">MINI OS / MANUAL ALGORITHM TOOLS</p>
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
        <div className="section-heading"><h2>Memory Management</h2><span>{snapshot.memory.mode === MemoryMode.PAGED ? 'PAGING LAB' : 'CONTIGUOUS MEMORY LAB'}</span></div>
        <div className="memory-controls"><label>Mode<select value={snapshot.memory.mode} onChange={(event) => { setTranslation(undefined); changeMemoryMode(event.target.value as MemoryMode) }}><option value={MemoryMode.CONTIGUOUS}>Contiguous</option><option value={MemoryMode.PAGED}>Paged</option></select></label>{snapshot.memory.mode === MemoryMode.CONTIGUOUS ? <><label>Strategy<select value={snapshot.memory.allocationStrategy} onChange={(event) => changeAllocationStrategy(event.target.value as AllocationStrategyType)}><option value={AllocationStrategyType.FIRST_FIT}>First Fit</option><option value={AllocationStrategyType.BEST_FIT}>Best Fit</option><option value={AllocationStrategyType.WORST_FIT}>Worst Fit</option></select></label><label>Process<select value={allocationPid} onChange={(event) => setAllocationPid(event.target.value)}><option value="">Select process</option>{snapshot.processes.map((process) => <option key={process.pid} value={process.pid}>{process.pid} / {process.memoryRequirement} units</option>)}</select></label><button type="button" onClick={allocateProcessMemory}>Allocate</button></> : <><label>Process<select value={allocationPid} onChange={(event) => setAllocationPid(event.target.value)}><option value="">Select process</option>{snapshot.processes.map((process) => <option key={process.pid} value={process.pid}>{process.pid} / {process.memoryRequirement} units</option>)}</select></label><button type="button" onClick={allocatePages}>Allocate pages</button></>}<button type="button" className="quiet" onClick={() => engine.memoryManager.reset()}>Reset memory</button></div>
        {memoryError && <p className="form-error" role="alert">{memoryError}</p>}
        {snapshot.memory.mode === MemoryMode.PAGED && <div className="replacement-panel">
          <div className="section-heading"><h3>Page Replacement</h3><span>{snapshot.paging.currentReferenceIndex} / {snapshot.paging.referenceStringLength} REFERENCES</span></div>
          <div className="replacement-controls">
            <label>Algorithm<select value={snapshot.paging.replacementAlgorithm} onChange={(event) => setReplacementAlgorithm(event.target.value as PageReplacementAlgorithm)}><option value={PageReplacementAlgorithm.FIFO}>FIFO</option><option value={PageReplacementAlgorithm.LRU}>LRU</option><option value={PageReplacementAlgorithm.OPTIMAL}>Optimal</option></select></label>
            <label className="reference-input">Reference string<input value={referenceInput} onChange={(event) => setReferenceInput(event.target.value)} placeholder="1 2 3 1 4" /></label>
            <button type="button" onClick={applyReferenceString}>Load references</button>
            <button type="button" onClick={stepReference} disabled={snapshot.paging.currentReferenceIndex >= snapshot.paging.referenceStringLength}>Step</button>
            <button type="button" onClick={() => { try { engine.memoryManager.pagingManager.runAllReferences(); setReferenceError('') } catch (runError) { setReferenceError(runError instanceof Error ? runError.message : 'Unable to run references') } }} disabled={snapshot.paging.currentReferenceIndex >= snapshot.paging.referenceStringLength}>Run all</button>
            <button type="button" className="quiet" onClick={() => engine.memoryManager.pagingManager.resetReplacementSimulation()}>Reset</button>
          </div>
          {referenceError && <p className="form-error" role="alert">{referenceError}</p>}
          <div className="memory-stats replacement-stats"><div><span>References</span><strong>{snapshot.paging.totalReferences}</strong></div><div><span>Hits</span><strong>{snapshot.paging.pageHits}</strong></div><div><span>Faults</span><strong>{snapshot.paging.pageFaults}</strong></div><div><span>Replacements</span><strong>{snapshot.paging.pageReplacements}</strong></div><div><span>Hit ratio</span><strong>{snapshot.paging.hitRatio.toFixed(1)}%</strong></div><div><span>Fault ratio</span><strong>{snapshot.paging.faultRatio.toFixed(1)}%</strong></div><div><span>Replacement ratio</span><strong>{snapshot.paging.replacementRatio.toFixed(1)}%</strong></div><div><span>Current page</span><strong>{snapshot.paging.currentRequestedPage ?? '-'}</strong></div></div>
          <div className="paging-grid replacement-detail"><div><h3>Current frames</h3>{snapshot.paging.replacementFrames.map((frame) => <div className="memory-region" key={frame.frameNumber}><span>Frame {frame.frameNumber}</span><strong>{frame.pageNumber ?? 'FREE'}</strong></div>)}</div><div><h3>Reference history</h3>{snapshot.paging.replacementHistory.length === 0 ? <p className="phase-note">No references processed.</p> : <div className="table-wrap"><table><thead><tr><th>Ref</th><th>Page</th><th>Result</th><th>Victim</th><th>Frame</th><th>Frames</th></tr></thead><tbody>{snapshot.paging.replacementHistory.map((entry) => <tr key={entry.referenceIndex}><td>{entry.referenceIndex + 1}</td><td>{entry.requestedPage}</td><td>{entry.result}</td><td>{entry.victimPage ?? '-'}</td><td>{entry.victimFrame ?? '-'}</td><td>{entry.framesAfter.map((frame) => frame.pageNumber ?? '-').join(' / ')}</td></tr>)}</tbody></table></div>}</div></div>
        </div>}
        {snapshot.memory.mode === MemoryMode.CONTIGUOUS ? <><div className="memory-stats"><div><span>Total</span><strong>{snapshot.memory.totalMemory}</strong></div><div><span>Used</span><strong>{snapshot.memory.usedMemory}</strong></div><div><span>Free</span><strong>{snapshot.memory.freeMemory}</strong></div><div><span>Allocations</span><strong>{snapshot.memory.allocationCount}</strong></div><div><span>Free regions</span><strong>{snapshot.memory.freeRegionCount}</strong></div><div><span>Largest free</span><strong>{snapshot.memory.largestFreeRegion}</strong></div><div><span>External fragmentation</span><strong>{snapshot.memory.externalFragmentation}</strong></div></div><div className="memory-regions"><h3>Physical memory regions</h3>{snapshot.memory.regions.map((region) => <div className="memory-region" key={`${region.startAddress}-${region.endAddress}`}><span>{`[${region.startAddress}, ${region.endAddress})`}</span><strong>{region.allocated ? `ALLOCATED / ${region.ownerPid}` : 'FREE'}</strong><small>{region.size} units {region.allocated && region.ownerPid && <button type="button" className="region-action" onClick={() => deallocateProcessMemory(region.ownerPid as string)}>Deallocate</button>}</small></div>)}</div></> : <><div className="memory-stats"><div><span>Total memory</span><strong>{snapshot.paging.configuration.totalMemory}</strong></div><div><span>Page size</span><strong>{snapshot.paging.configuration.pageSize}</strong></div><div><span>Total frames</span><strong>{snapshot.paging.totalFrames}</strong></div><div><span>Used frames</span><strong>{snapshot.paging.usedFrames}</strong></div><div><span>Free frames</span><strong>{snapshot.paging.freeFrames}</strong></div><div><span>Frame utilization</span><strong>{snapshot.paging.frameUtilization.toFixed(1)}%</strong></div><div><span>Allocated pages</span><strong>{snapshot.paging.totalAllocatedPages}</strong></div><div><span>Internal fragmentation</span><strong>{snapshot.paging.totalInternalFragmentation}</strong></div></div><div className="paging-grid"><div><h3>Frame table</h3>{snapshot.paging.frames.map((frame) => <div className="memory-region" key={frame.frameNumber}><span>Frame {frame.frameNumber} [{frame.startAddress},{frame.endAddress})</span><strong>{frame.occupied ? `${frame.ownerPid} Page ${frame.pageNumber}` : 'FREE'}</strong></div>)}</div><div><h3>Page tables</h3>{snapshot.paging.pageTables.length === 0 ? <p className="phase-note">No page tables.</p> : snapshot.paging.pageTables.map((table) => <div key={table.ownerPid}><strong>{table.ownerPid}</strong>{table.pages.map((page) => <p className="page-mapping" key={page.pageNumber}>Page {page.pageNumber} -&gt; {page.present ? `Frame ${page.frameNumber}` : 'PAGE FAULT'}</p>)}<button type="button" className="region-action" onClick={() => deallocatePages(table.ownerPid)}>Deallocate pages</button></div>)}</div></div><div className="translation-panel"><h3>Address translation</h3><label>Logical address<input type="number" min="0" value={logicalAddress} onChange={(event) => setLogicalAddress(event.target.value)} /></label><button type="button" onClick={translateAddress}>Translate</button>{translation && <p className="translation-result">Logical {translation.logicalAddress} / Page {translation.pageNumber} / Offset {translation.offset} / {translation.pageFault ? 'PAGE FAULT' : `Frame ${translation.frameNumber} / Physical ${translation.physicalAddress}`}</p>}</div></>}
        <p className="phase-note">Paging uses deterministic FIFO, LRU, and theoretical Optimal replacement.</p>
      </section>

      <section className="disk-panel">
        <div className="section-heading"><h2>Disk Management</h2><span>{snapshot.disk.configuration.cylinders} CYLINDERS / INITIAL {snapshot.disk.configuration.initialHead} / HEAD {snapshot.disk.head}</span></div>
        <div className="disk-controls"><label>Algorithm<select value={snapshot.disk.algorithm} onChange={(event) => changeDiskAlgorithm(event.target.value as DiskSchedulingAlgorithm)}>{(['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK', 'C-LOOK'] as const).map((value) => <option key={value}>{value}</option>)}</select></label><label>Direction<select value={snapshot.disk.direction} onChange={(event) => changeDiskDirection(event.target.value as DiskDirection)}><option>UP</option><option>DOWN</option></select></label><label>Cylinder<input type="number" min="0" max={snapshot.disk.configuration.cylinders - 1} value={diskCylinder} onChange={(event) => setDiskCylinder(event.target.value)} /></label><button type="button" onClick={addDiskRequest}>Add request</button><label className="disk-bulk">Bulk requests<input value={diskBulkInput} onChange={(event) => setDiskBulkInput(event.target.value)} /></label><button type="button" onClick={loadDiskRequests}>Load requests</button><button type="button" onClick={() => engine.diskManager.step()} disabled={snapshot.disk.metrics.pending === 0}>Step</button><button type="button" onClick={() => engine.diskManager.runAll()} disabled={snapshot.disk.metrics.pending === 0}>Run all</button><button type="button" className="quiet" onClick={() => engine.diskManager.reset()}>Reset</button></div>
        {diskError && <p className="form-error" role="alert">{diskError}</p>}
        <div className="disk-track"><span className="track-start">0</span><div className="track-line">{snapshot.disk.pendingRequests.map((request) => <b className="track-request pending-marker" key={request.requestId} title={`${request.requestId} pending at ${request.cylinder}`} style={{ left: `${(request.cylinder / (snapshot.disk.configuration.cylinders - 1)) * 100}%` }} />)}{snapshot.disk.completedRequests.map((request) => <b className="track-request serviced-marker" key={request.requestId} title={`${request.requestId} serviced at ${request.cylinder}`} style={{ left: `${(request.cylinder / (snapshot.disk.configuration.cylinders - 1)) * 100}%` }} />)}<i className="track-head" style={{ left: `${(snapshot.disk.head / (snapshot.disk.configuration.cylinders - 1)) * 100}%` }} /></div><span>{snapshot.disk.configuration.cylinders - 1}</span></div>
        <div className="memory-stats disk-stats"><div><span>Total requests</span><strong>{snapshot.disk.metrics.total}</strong></div><div><span>Pending</span><strong>{snapshot.disk.metrics.pending}</strong></div><div><span>Serviced</span><strong>{snapshot.disk.metrics.serviced}</strong></div><div><span>Total movement</span><strong>{snapshot.disk.metrics.totalMovement}</strong></div><div><span>Average / request</span><strong>{snapshot.disk.metrics.averageMovement.toFixed(1)}</strong></div><div><span>Maximum movement</span><strong>{snapshot.disk.metrics.maxMovement}</strong></div></div>
        <div className="disk-tables"><div><h3>Pending requests</h3><div className="table-wrap"><table><thead><tr><th>ID</th><th>Cylinder</th><th>Arrival</th></tr></thead><tbody>{snapshot.disk.pendingRequests.map((request) => <tr key={request.requestId}><td>{request.requestId}</td><td>{request.cylinder}</td><td>{request.arrivalTick}</td></tr>)}</tbody></table></div></div><div><h3>Completed requests</h3><div className="table-wrap"><table><thead><tr><th>Order</th><th>ID</th><th>Cylinder</th><th>Tick</th></tr></thead><tbody>{snapshot.disk.metrics.serviceOrder.map((requestId, index) => { const request = snapshot.disk.completedRequests.find((candidate) => candidate.requestId === requestId); return request === undefined ? null : <tr key={request.requestId}><td>{index + 1}</td><td>{request.requestId}</td><td>{request.cylinder}</td><td>{request.completedTick}</td></tr> })}</tbody></table></div></div></div>
        <div className="movement-history"><h3>Movement history</h3><div className="table-wrap"><table><thead><tr><th>Request</th><th>Head path</th><th>Distance</th></tr></thead><tbody>{snapshot.disk.metrics.movementHistory.length === 0 ? <tr><td colSpan={3}>No movement recorded.</td></tr> : snapshot.disk.metrics.movementHistory.map((movement, index) => <tr key={`${movement.requestId ?? 'boundary'}-${index}`}><td>{movement.requestId ?? 'Boundary'}</td><td>{movement.from} -&gt; {movement.to}</td><td>{movement.distance}</td></tr>)}</tbody></table></div></div>
      </section>

      <section className="synchronization-panel">
        <div className="section-heading"><h2>Process Synchronization</h2><span>SYNCHRONIZATION LAB</span></div>
        <div className="sync-controls">
          <label>Process<select value={syncPid} onChange={(event) => setSyncPid(event.target.value)}><option value="">Select process</option>{snapshot.processes.filter((process) => process.state !== ProcessState.TERMINATED).map((process) => <option key={process.pid} value={process.pid}>{process.pid} / {process.state}</option>)}</select></label>
          <label>Mutex<select value={mutexId} onChange={(event) => setMutexId(event.target.value)}><option value="">Select mutex</option>{snapshot.synchronization.mutexes.map((mutex) => <option key={mutex.id} value={mutex.id}>{mutex.id}</option>)}</select></label>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.acquireMutex(syncPid, mutexId))}>Acquire</button>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.releaseMutex(syncPid, mutexId))}>Release</button>
          <input aria-label="New mutex ID" placeholder="New mutex ID" value={newMutexId} onChange={(event) => setNewMutexId(event.target.value)} />
          <button type="button" onClick={createMutex}>Create mutex</button>
        </div>
        <div className="sync-controls">
          <label>Semaphore<select value={semaphoreId} onChange={(event) => setSemaphoreId(event.target.value)}><option value="">Select semaphore</option>{snapshot.synchronization.semaphores.map((semaphore) => <option key={semaphore.id} value={semaphore.id}>{semaphore.id}</option>)}</select></label>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.waitSemaphore(syncPid, semaphoreId))}>Wait</button>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.signalSemaphore(syncPid, semaphoreId))}>Signal</button>
          <input aria-label="New semaphore ID" placeholder="New semaphore ID" value={newSemaphoreId} onChange={(event) => setNewSemaphoreId(event.target.value)} />
          <input aria-label="Semaphore permits" type="number" min="0" value={semaphorePermits} onChange={(event) => setSemaphorePermits(event.target.value)} />
          <button type="button" onClick={createSemaphore}>Create semaphore</button>
        </div>
        {syncError && <p className="form-error" role="alert">{syncError}</p>}
        <div className="sync-grid">
          <div><h3>Mutexes</h3><div className="table-wrap"><table><thead><tr><th>ID</th><th>Owner</th><th>FIFO waiters</th></tr></thead><tbody>{snapshot.synchronization.mutexes.map((mutex) => <tr key={mutex.id}><td>{mutex.id}</td><td>{mutex.ownerPid ?? '-'}</td><td>{mutex.waitingPids.join(' -> ') || '-'}</td></tr>)}</tbody></table></div></div>
          <div><h3>Semaphores</h3><div className="table-wrap"><table><thead><tr><th>ID</th><th>Permits</th><th>Holders</th><th>FIFO waiters</th></tr></thead><tbody>{snapshot.synchronization.semaphores.map((semaphore) => <tr key={semaphore.id}><td>{semaphore.id}</td><td>{semaphore.permits}</td><td>{Object.entries(semaphore.holders).map(([pid, count]) => `${pid}:${count}`).join(', ') || '-'}</td><td>{semaphore.waitingPids.join(' -> ') || '-'}</td></tr>)}</tbody></table></div></div>
        </div>
        <div className="sync-controls">
          <label>Shared resource<input value={resourceId} onChange={(event) => setResourceId(event.target.value)} /></label>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.enterCriticalSection(syncPid, resourceId, mutexId || undefined))}>Enter critical section</button>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.exitCriticalSection(syncPid, resourceId))}>Exit critical section</button>
          <label>Buffer capacity<input type="number" min="1" value={bufferCapacity} onChange={(event) => setBufferCapacity(event.target.value)} /></label>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.resetProducerConsumer(Number(bufferCapacity)))}>Reset buffer</button>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.produce(syncPid))}>Produce</button>
          <button type="button" onClick={() => runSynchronization(() => engine.synchronizationManager.consume(syncPid))}>Consume</button>
          <button type="button" className="quiet" onClick={() => runSynchronization(() => engine.synchronizationManager.reset())}>Reset synchronization</button>
        </div>
        <div className="memory-stats sync-stats"><div><span>Buffer</span><strong>{snapshot.synchronization.producerConsumer.items.join(', ') || 'Empty'}</strong></div><div><span>Capacity</span><strong>{snapshot.synchronization.producerConsumer.capacity}</strong></div><div><span>Produced / consumed</span><strong>{snapshot.synchronization.metrics.produced} / {snapshot.synchronization.metrics.consumed}</strong></div><div><span>Blocked / wakeups</span><strong>{snapshot.synchronization.metrics.blockedOperations} / {snapshot.synchronization.metrics.wakeups}</strong></div></div>
        <div className="sync-status"><strong>Critical sections:</strong> {snapshot.synchronization.activeCriticalSections.map((section) => `${section.pid}:${section.resourceId}`).join(', ') || 'none'} <strong>Blocked:</strong> {snapshot.processes.filter((process) => process.blockedReason !== undefined).map((process) => `${process.pid} ${process.blockedReason} ${process.blockedResourceId}`).join(', ') || 'none'}</div>
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
            <thead><tr><th>PID</th><th>Name</th><th>State</th><th>Block reason</th><th>Resource</th><th>Arrival</th><th>Burst</th><th>Remaining</th><th>Priority</th><th>Memory</th><th>Completion</th><th>First start</th><th>Waiting</th><th>Turnaround</th><th>Response</th><th>Actions</th></tr></thead>
            <tbody>{snapshot.processes.length === 0 ? <tr><td className="empty-cell" colSpan={16}>Create a process to inspect its lifecycle.</td></tr> : snapshot.processes.map((process) => <tr key={process.pid}>
              <td>{process.pid}</td><td>{process.name}</td><td><span className={`state state-${process.state.toLowerCase()}`}>{process.state}</span></td><td>{process.blockedReason ?? '-'}</td><td>{process.blockedResourceId ?? '-'}</td><td>{process.arrivalTime}</td><td>{process.burstTime}</td><td>{process.remainingTime}</td><td>{process.priority}</td><td>{process.memoryRequirement}</td>{(() => { const metrics = snapshot.cpu.metrics.find((metric) => metric.pid === process.pid); return <><td>{metrics?.completionTime ?? '-'}</td><td>{metrics?.firstStartTime ?? '-'}</td><td>{metrics?.waitingTime ?? '-'}</td><td>{metrics?.turnaroundTime ?? '-'}</td><td>{metrics?.responseTime ?? '-'}</td></> })()}
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
