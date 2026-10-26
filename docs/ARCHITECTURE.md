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

Legacy tick-based CPU and standalone disk tools are retained behind an explicit manual-tools disclosure for compatibility. The default integrated experiment uses the new event-driven model. General cross-subsystem integration is limited to CPU and disk; memory and synchronization do not claim integrated process faults or thread scheduling.

There is no persistence across reload, authentication, backend or deployment. Exports provide manual persistence. CSS uses responsive layouts and horizontal table scrolling. Event trace retention and execution limits constrain large runs; synchronous comparisons may briefly occupy the browser for unusually large scenarios. A Web Worker is a possible later enhancement.

The simulation does not execute real machine instructions or access host processes, RAM or disks. Disk costs are illustrative integer parameters, not hardware predictions. CPU switch overhead and dirty-page writeback are not modelled.
