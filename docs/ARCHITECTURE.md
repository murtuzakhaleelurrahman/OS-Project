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

Scenario persistence is opt-in through localStorage, validated URL fragments or JSON exports. Playback and answers reset across reload. GitHub Pages hosts the static client; there is no authentication or backend. CSS uses responsive layouts and horizontal table scrolling. Event trace retention and execution limits constrain large runs; synchronous single-scenario comparisons and replay preparation may briefly occupy the browser for unusually large scenarios. Seeded studies yield between workloads. A Web Worker is a possible later enhancement.

The simulation does not execute real machine instructions or access host processes, RAM or disks. Disk costs are illustrative integer parameters, not hardware predictions. CPU switch overhead is optional and separately accounted for. Dirty-page writeback is not modelled.

## Why two scheduling implementations remain

`src/simulation/cpu/Schedulers.ts` supports the original tick-based engine and its manual CPU/synchronization demonstrations. Keeping it preserves the earlier dashboard API and its regression tests. It is accessed only through the explicitly labelled additional manual tools; it does not schedule the integrated workload.

`IntegratedEngine.select()` belongs to the event-driven CPU/disk model. It selects the next CPU burst using ready-entry timestamps, including returns from I/O, while the earlier tools operate on a single CPU burst per process. Combining the two immediately would change the legacy teaching model and its command API. The duplication is a compatibility boundary, not two schedulers acting on the same state. Future scheduling changes must check both implementations and their common FCFS/SJF examples, or migrate and retire the legacy tools in a dedicated change.

## Optional integrated memory

`IntegratedMemory` owns reserved frames, local FIFO/LRU ordering, outstanding fault retries and reference counters. `IntegratedEngine` owns the FIFO admission/job queue and frees frames on termination. Demand memory introduces same-time PAGE_CHECK events and one-tick productive CPU completions; memory-disabled and fixed-allocation runs keep the original batched CPU service behavior. Faults consume no productive tick, create typed PAGE_IN requests on the same disk as ordinary I/O, and retry the unconsumed reference after completion. Retried accesses do not fabricate an extra hit. Process page numbers are private and a reserved frame is never evicted by another process.

A context-switch completion event represents optional CPU overhead while the selected process remains READY. Disk service continues during switching. State-segment lanes distinguish READY, running, job-queue waits, I/O blocking and page-fault blocking. Reset clears the queue, switch, memory model, retry state and all disk requests together.
## Expanded CPU and disk policies

`shared/CpuPolicy.ts` supplies common FCFS/SJF/Priority ranking to both execution models, plus the integrated preemptive/MLFQ rankings. Legacy adapters pass arrival time and full single-burst work; integrated adapters pass ready-entry time and the remaining current burst. Round Robin retains a legacy queue adapter while the integrated engine owns event-driven ready-entry order.

The integrated engine holds a cancellable handle for the pending CPU event. Preemption removes that event and invalidates its token. Page checks evaluate same-time preemption before counting an unexecuted reference. Aging reviews occur at the next exact READY aging boundary. MLFQ boost events exist only under contention and are removed when unnecessary, preventing review events from extending final completion time. A selected switch target is committed during overhead; better arrivals are reconsidered immediately after switching completes.

`DiskPolicy.ts` chooses a request and its full waypoint path without mutation. The engine reserves that entire route and derives seek cost from its summed leg lengths. Endpoint and wrap travel therefore affect both movement and elapsed service. DiskPathChart plots completed waypoints on an ordinal x-axis; intermediate points are not assigned physical completion timestamps. Exported configuration and assumptions include aging, queue quanta, boost interval and initial disk direction.

## Replay, lessons and seeded studies

`LearningExperiments.ts` owns deterministic replay, fixed lesson evaluation, workload generation and study aggregation. Replay runs the existing engine handlers from a fresh scenario up to an event index, without starting a timer. It does not retain full snapshots per event or depend on trace retention. The replay slider's independent full-run probe establishes its finite range, including a labelled event-limit boundary.

`SeededStudy.step()` executes one identical generated workload under all eight CPU policies, then exposes aggregate means and completed/limited counts. The React controller yields between whole rounds so Stop and navigation remain responsive; its generation token prevents a stopped/unmounted run from overwriting a newer result. These task yields never advance simulated time. Results retain their actual seed/settings label even if the input fields are later edited. Memory is disabled explicitly for generated studies; the single-scenario 48-pair comparison continues to include configured memory.

Sharing encodes only a schema-validated scenario in the URL fragment. Incoming links, saved localStorage JSON and files are untrusted data and pass through the same parser before an engine is created. Fragment size is bounded before decode. Invalid links leave the active run intact and show an error. Initial page loads and same-document hash navigation both support shared scenarios. Browser storage failures are reported instead of claiming a save succeeded. Large workloads use existing JSON export.

## Verification and deployment

Fast-check properties validate each event of bounded generated scenarios across all CPU/disk pairs; fixed seeds and shrinking make failures replayable. V8 coverage includes every simulation source, including files not imported by a test. Strict test compilation checks the testing API and assertions separately from the production build. Playwright owns a separate production preview at port 4174 and tests the Pages base path; it never reuses the user's development server or resets their browser storage.

CI retains Ubuntu/Windows/macOS core checks and adds Chromium smoke tests with reports. A dependent main-only job builds and publishes dist through GitHub Pages using the github-pages environment. Pull requests cannot deploy. The simulator remains entirely client-side; hosting adds no backend or scenario collection. Only explicit share URLs carry workloads, and saved workloads remain in that browser's localStorage.

## Deadlock, philosophers and translation-cache laboratories

`resources/Deadlock.ts` validates exclusive single-instance ownership and pending AND-requests, builds a wait-for graph and uses Tarjan SCCs to identify true cycle members. A separate reverse reachability closure identifies blocked dependents. React draws the returned edges and groups; it does not infer deadlock from display positions or Banker safety. A request for an already held non-recursive lock can produce a self-cycle. Multi-instance resources are rejected before analysis.

`synchronization/Philosophers.ts` owns finite scripts, fork ownership, acquisition order, blocked attempts, meals and a deterministic round-robin cursor. Fork state generates the detector's input after every step. Ordered fork acquisition restarts the demonstration with a prevention rule; there is no fabricated meal count or automatic resource preemption. This lab remains separate from the older actor scripts and the integrated CPU clock.

`memory/TlbLaboratory.ts` owns address spaces, unique physical-frame mappings, tagged FIFO/LRU entries, invalidation, per-access latency and aggregate counters. Resident misses populate the cache; faults never do. Remapping validates target-frame ownership before changing either mappings or entries, so failure is atomic. Unmapping and process deletion invalidate their entries; reset rebuilds original mappings. `serialEmat` is a pure formula with explicit single-level serial assumptions. The UI separates editable drafts from active timing configuration and model state. This is an independent lab; existing PageManager translation and integrated demand-paging semantics remain unchanged.
