# Extension roadmap

Requested on 27 October 2026. Baseline: `5eb7f7c`, 148 passing tests and green Ubuntu/Windows/macOS CI. These features extend the accepted proposal; a planned row is not a completion claim.

| Phase | Deliverables | Acceptance | Status |
| --- | --- | --- | --- |
| E1 | Integrated demand paging, FIFO/LRU, memory admission/job queue, termination cleanup, context-switch costs, thrashing comparison | Fault blocks/retries through the shared disk; no fabricated hits; freed frames admit jobs; conservation includes job wait and switch overhead; fewer frames visibly increase faults and lower productive utilization | Complete: 158 tests, build/lint, browser thrashing/admission checks |
| E2 | SRTF, preemptive Priority, aging, MLFQ; integrated SCAN/C-SCAN/LOOK; head path | Boundary/tie/preemption oracles; shared scheduling policy helpers where models agree; movement and service costs agree | Complete: 175 tests, build/lint, browser CPU/sweep checks |
| E3 | Event-index time travel, predict-first lessons, seeded generators and batch comparisons, extra timeline/chart lanes, localStorage/URL sharing | Replay prefix equals original; reproducible seeds; identical input sets; validated sharing; clearly separate prediction and actual results | Complete: 194 tests, build/lint, browser replay/prediction/study/save/share checks |
| E4 | Property-based invariants with fast-check, coverage, Playwright navigation smoke suite, GitHub Pages deployment | Real tests/build/lint remain green; property tests cover enabled extensions; browser smoke passes; deployment URL verified | Complete: 243 core/property tests, 5 Chromium tests, coverage/typecheck/build/lint on three OSes, green hosted CI and verified live Pages site |
| E5 | Wait-for graph detection and dining philosophers, TLB/EMAT lab | Detection explicitly restricted to single-instance resources; deadlocking/fixed philosophers; serial EMAT oracle and cache invalidation | Complete: 280 core/property tests, 8 browser tests, coverage/typecheck/build/lint on three OSes, successful deployment and live lab checks |
| E6 | Mini filesystem with contiguous/linked/indexed allocation, directories and disk-backed operations | Allocation conservation, directory/path validation, operation completion tied to disk service | Complete: 312 core/property tests, 11 browser tests, coverage/typecheck/build/lint on three OSes; successful deployment and all browser tests passing against the public site |
| E7 | Multi-core scheduling/load balancing, EDF and rate-monotonic lab | Unique core membership, per-core conservation, deterministic migration, release/deadline accounting | Planned |

## E1 semantics

Memory is opt-in so existing scenarios and textbook answers remain unchanged. Fixed allocation reserves all process pages on admission. Demand paging reserves a configurable per-process frame quota, uses **local replacement**, starts frames empty and shares the integrated disk for page-ins. A process with insufficient free frames waits in a FIFO job queue until another process terminates. Clean, read-only pages are modelled; there is no dirty writeback in E1.

Each productive CPU tick references one page. Optional per-burst reference strings must match the CPU duration. A fault consumes no productive tick, blocks the process, queues a page-in, then retries the same reference after disk completion. Retries do not count as a second logical reference or a hit. FIFO uses load order; LRU updates on actual access. Frames are released on termination and all pending activity is discarded on reset.

Context-switch cost applies to a direct change between different processes, including a zero-work page-fault dispatch. Initial dispatch and dispatch after an idle gap are free. The chosen target stays in READY during switching; its waiting time includes the overhead. Useful CPU time, switch overhead and idle time are separate. Switching does not stop the disk. Pages are identified per process; equal page numbers from two processes are not shared.

## Delivery discipline

Implement, test, document and locally commit each phase before beginning the next. Preserve the proposal's original example exports and opt-out behavior. Never label optional work complete until its model, controls and acceptance tests exist. Public hosting uses the existing public repository; no secret scenario data is included in share links automatically.

## E2 policy semantics

SRTF and preemptive Priority switch only for a strictly better remaining burst or lower priority number; equal candidates retain the runner. Completion and quantum-boundary ordering remain unchanged. Cancelled CPU events are removed, rather than retained as future no-op events. A better arrival during a committed switch is reconsidered when that switch finishes.

Aging is preemptive priority with `effective = base - floor(current READY wait / agingInterval)`. Effective values may be negative. The runner's effective priority is frozen at dispatch, and a new ready wait begins after preemption. Reviews occur at exact aging boundaries while contention exists. Default interval: 5 ticks.

MLFQ defaults to FIFO queues with quanta [1,2,4] and a 20-tick boost interval. New jobs enter level 0. Full budget consumption demotes; higher queues preempt; partial budgets survive such preemption and page faults. Ordinary I/O resets the current-level budget without promotion. Under contention, boost events promote every process to level 0, reset budgets, and requeue the runner at the tail. Review timers are cancelled when there is no competing ready work, so they cannot extend the completed horizon.

Integrated SCAN and C-SCAN traverse configured endpoints when changing sweep/wrapping; LOOK and C-LOOK turn/jump at the pending request extremes. Every path leg, including wrap travel, counts toward distance and service duration. Selection reserves one entire request route and is non-preemptive. The completed head-path chart uses waypoint index rather than pretending intermediate points have measured timestamps. Initial direction defaults to UP. A run stops at its final request, without unnecessary post-completion travel.

FCFS/SJF/Priority comparisons are shared with the legacy tools through CpuPolicy.ts adapters. The adapters retain different definitions of work/ready time because the manual tool has a single burst and the integrated model has CPU/I/O scripts. All eight CPU and six disk policies are compared from fresh workloads (48 combinations).

## E3 learning and experiment semantics

Time travel counts processed queue events, including separate same-tick events. Previous event and the prepared slider rebuild the deterministic prefix through normal handlers; they never infer history from the capped decision trace. Preparing the slider runs an independent probe to the final event or configured limit. Replay pauses playback and reconstructs CPU, disk, memory, metrics and state lanes together; proceeding resumes the same future.

Two fixed predict-first exercises ask for FCFS order or one-frame thrashing faults. The learner must enter a valid guess before the engine computes and reveals its answer and explanation. Exercises do not modify the active workload.

The seeded study uses Mulberry32 with an unsigned 32-bit seed, 1–100 workloads and 1–12 processes each. Every generated process has arrival 0–15, priority 0–7, CPU/I/O/CPU with each CPU burst 1–10 ticks, and a uniformly sampled valid cylinder. Memory is explicitly disabled in this experiment. All eight CPU policies receive the same workload set, configured quantum/switch costs and selected disk policy/costs. Means weight each workload equally; throughput is the mean of per-workload throughput. Event-limited counts are visible and invalidate that policy's means instead of silently discarding samples. Stopping retains a clearly labelled partial set of complete policy rounds. Restart and scenario changes invalidate old asynchronous updates. READY/blocked/job state lanes and disk paths complement the new comparison bar charts.

Saving explicitly stores one validated scenario in localStorage. Share links put scenario JSON in an encoded URL fragment, capped at 16,000 characters; larger scenarios use file export. Links load at event zero on initial navigation or hash changes, and are schema-validated before replacing the active experiment. No playback state or prediction answers are persisted. Localhost links require the recipient to run the app at that address; public links can use the GitHub Pages deployment delivered in E4.

## E4 verification contract

Fast-check generates 20 bounded scenarios for each of 48 policy pairs and 60 additional replay/share cases, with fixed seeds and automatic counterexample shrinking. Every event is checked for unique CPU/ready membership, nonnegative waits, global and per-process time conservation, gap-free CPU segments, non-overlapping disk service, path-derived seek/page-in costs, memory ownership and reference accounting. Completed runs must terminate, free frames and match reset/replay results.

Coverage includes all simulation TypeScript sources (UI is outside this metric). Global gates: statements/functions 90%, branches 85%, lines 95%. Tests and test configurations also receive strict TypeScript checking. Playwright runs Chromium against a freshly built production preview under the GitHub Pages base path on a separate port. It checks each mode and interactions across E1–E3, failing on uncaught page errors or missing JS/CSS assets.

The workflow preserves the three-OS checks, uploads coverage/browser artifacts and gates deployment on both matrix and browser success. Deployment runs only on main outside pull requests, uses the github-pages environment and limited Pages/OIDC permissions, and uploads only dist. A configured workflow alone is not a verified live deployment.

Hosted run [40550899158](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/runs/40550899158) passed every job and published [the live simulator](https://murtuzakhaleelurrahman.github.io/OS-Project/). The deployed overlap example and translation lab were also checked in the actual public browser.

## E5 model contracts

The wait-for detector accepts up to 32 processes, 64 uniquely named resources with exactly one instance each, and 128 pending requests. Ownership is exclusive, locks are non-recursive/non-preemptible, and multiple outstanding requests are AND-waits. Edges point from a requester to the current holder; free resources produce no edge. Tarjan strongly connected components identify cycle members (including self-waits). A separate reachability closure labels processes waiting behind a cyclic component. Component lists are groups, not a claim that their listed order forms a simple cycle. Banker safety remains independent; no multi-instance deadlock claim is made.

Dining philosophers use deterministic round-robin one-meal scripts over 2–10 seats (UI: five). A step attempts an acquisition, eats while owning both forks, or releases one fork. A blocked actor becomes runnable when its required fork is free. Left-first gives a full ring deadlock after 2N attempts; lower-numbered-first removes circular wait and completes the finite workload. Both policies expose actual fork ownership and feed the same wait-for detector. Changing policy resets the lab; it is prevention in a fresh run, not silent recovery of a blocked run.

The independent tagged TLB lab uses private, single-level resident page tables, 1–32 FIFO/LRU entries and ASID/process + page keys. It performs serial lookup: a hit costs t+m, a resident miss t+2m; a nonresident page costs t+m to detect a fault and is not cached. No disk page-in, overlapping cache lookup or multilevel walk is invented. Fault attempts count among misses, but only successful translations determine observed EMAT and its matching empirical hit ratio. Analytical h is a separate assumption. Remap/unmap invalidate the affected entry, process free invalidates all its entries, flush retains statistics/mappings, and reset restores initial mappings and clears statistics. Frame aliasing is excluded in this lab. The last 200 access records are retained while counters remain cumulative.

[Hosted E5 run 40555374667](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/runs/40555374667) passed all platform, browser and deployment jobs. Public-browser checks confirmed cycle/dependent classification, deadlocking/corrected dining runs, the 140 ns EMAT oracle, and TLB miss/hit/remap results.

## E6 filesystem contract

The virtual filesystem is an independent laboratory with one serialized transaction and one disk. It reuses `chooseDiskRequest` and the integrated service-cost formula for all six policies, including endpoint/wrap travel. Each block maps to one cylinder. A step dispatches or completes one request; logical time, head and completed movement advance only on completion. Independent requests in a phase can be reordered; directory walks, actual linked-pointer traversal and index fetches impose prerequisites. The active CPU/paging experiment is unchanged.

Root owns metadata block zero. Each directory owns one abstract metadata block; entry byte-packing is outside this model. Contiguous files use adjacent full-payload blocks. Linked blocks reserve four pointer bytes; indexed files use full data blocks plus one four-byte-pointer index block. Empty files use only directory metadata. UTF-8 payload bytes live in committed data blocks, next pointers in linked blocks, and pointer lists in index blocks.

Queued commands are captured at submission, then validated against earlier committed operations when they start. Planning failure consumes no disk time and changes no committed state. New data/index/directory blocks are reserved until final commit. Copy-on-write overwrite retains the old file during all I/O and may fail on a full disk even for a smaller new payload. Namespace mutation, read-result publication and block frees occur only when all operation phases finish. This does not model a persistent journal, crash recovery, permissions or concurrent writers.

Canonical absolute paths have at most eight 1–32 character ASCII segments and 256 total characters; root cannot be removed or moved. Parent directories must exist, destinations must be free, descendant moves and depth-overflowing subtree moves are rejected, and removal requires an empty directory. Whole-file and logical-block reads are available; block reads return raw bytes to avoid mis-decoding a UTF-8 character split across blocks. Limits are 128 blocks/entries, 64 KiB per file and 256 commands. UI tables show the last 50 operations/100 requests and retain cumulative counters. Reset creates a new disk and discards pending work.

[E6 hosted run 40638576704](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/runs/40638576704), commit `79a4a4b`, passed every platform/browser/deployment job. All 11 browser tests were then run successfully against the public GitHub Pages build, including filesystem transaction visibility, fragmentation and directory cases.
