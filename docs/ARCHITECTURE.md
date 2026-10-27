# Architecture and limitations

## Integrated system

`src/simulation/integrated/Scenario.ts` validates and copies versioned input. `EventQueue.ts` orders events by (timestamp, phase, sequence), rejects backward same-time phase insertion, and clears all old handles on reset.

`IntegratedEngine.ts` owns process state, ready ordering, CPU/disk activity, dispatch deduplication, service tokens, accounting and snapshots. Each public next-event action processes exactly one queued event. A single optional display timer calls that same action; no process owns a timer. Reset cancels playback and clears pending completion events. CPU tokens prevent stale completion actions from changing the current runner.

Elapsed time is charged to RUNNING/READY/BLOCKED states before handling an event. CPU burst completion either terminates the process or queues disk I/O and blocks it. Disk completion moves to the next CPU burst and returns the process to READY. A deduplicated dispatch phase chooses both CPU and disk work. Only one runner and one disk request can be active.

`Experiments.ts` creates a new engine for every policy pair, and exports scenarios, results, traces, parameters, units and assumptions. Scenario/result imports always replay from initial input, rather than trusting exported runtime state.

## Separate laboratories

- Existing fit strategies, MemoryManager and PageManager are reused by MemoryLaboratory. A process's allocation is a manual laboratory operation, not a prerequisite for integrated CPU admission.
- Replacement frames and reference history are independent of resident page tables. Optimal reads the future reference string and is explicitly labelled as an offline benchmark.
- ActorLab owns scripted registers, shared values, mutex ownership, semaphore reservations, FIFO waiters and buffer contents. Wakeups transfer ownership/permits and complete the blocked acquire/wait operation. No integrated process is mutated.
- Banker functions are pure. Validation precedes safety analysis; tentative resource requests are committed only after a complete safe sequence is found. A returned unsafe analysis describes the rejected tentative state; the displayed current resource state remains unchanged.
- React renders snapshots and sends commands. UI state contains input text and navigation, never the authoritative simulation model.

## Deliberate boundaries

Legacy tick-based CPU and standalone disk tools are retained behind an explicit manual-tools disclosure for compatibility. The default integrated experiment uses the new event-driven model. The optional E1 memory model now connects CPU references, local frame replacement and page-in disk requests. The focused memory laboratories remain independent; synchronization still does not claim a general integrated thread scheduler.

There is no persistence across reload, authentication, backend or deployment. Exports provide manual persistence. CSS uses responsive layouts and horizontal table scrolling. Event trace retention and execution limits constrain large runs; synchronous comparisons may briefly occupy the browser for unusually large scenarios. A Web Worker is a possible later enhancement.

The simulation does not execute real machine instructions or access host processes, RAM or disks. Disk costs are illustrative integer parameters, not hardware predictions. CPU switch overhead is optional and separately accounted for. Dirty-page writeback is not modelled.

## Why two scheduling implementations remain

`src/simulation/cpu/Schedulers.ts` supports the original tick-based engine and its manual CPU/synchronization demonstrations. Keeping it preserves the earlier dashboard API and its regression tests. It is accessed only through the explicitly labelled additional manual tools; it does not schedule the integrated workload.

`IntegratedEngine.select()` belongs to the event-driven CPU/disk model. It selects the next CPU burst using ready-entry timestamps, including returns from I/O, while the earlier tools operate on a single CPU burst per process. Combining the two immediately would change the legacy teaching model and its command API. The duplication is a compatibility boundary, not two schedulers acting on the same state. Future scheduling changes must check both implementations and their common FCFS/SJF examples, or migrate and retire the legacy tools in a dedicated change.

## Optional integrated memory

`IntegratedMemory` owns reserved frames, local FIFO/LRU ordering, outstanding fault retries and reference counters. `IntegratedEngine` owns the FIFO admission/job queue and frees frames on termination. Demand memory introduces same-time PAGE_CHECK events and one-tick productive CPU completions; memory-disabled and fixed-allocation runs keep the original batched CPU service behavior. Faults consume no productive tick, create typed PAGE_IN requests on the same disk as ordinary I/O, and retry the unconsumed reference after completion. Retried accesses do not fabricate an extra hit. Process page numbers are private and a reserved frame is never evicted by another process.

A context-switch completion event represents optional CPU overhead while the selected process remains READY. Disk service continues during switching. State-segment lanes distinguish READY, running, job-queue waits, I/O blocking and page-fault blocking. Reset clears the queue, switch, memory model, retry state and all disk requests together.