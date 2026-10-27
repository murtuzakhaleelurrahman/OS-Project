# Extension roadmap

Requested on 27 October 2026. Baseline: `5eb7f7c`, 148 passing tests and green Ubuntu/Windows/macOS CI. These features extend the accepted proposal; a planned row is not a completion claim.

| Phase | Deliverables | Acceptance | Status |
| --- | --- | --- | --- |
| E1 | Integrated demand paging, FIFO/LRU, memory admission/job queue, termination cleanup, context-switch costs, thrashing comparison | Fault blocks/retries through the shared disk; no fabricated hits; freed frames admit jobs; conservation includes job wait and switch overhead; fewer frames visibly increase faults and lower productive utilization | Complete: 158 tests, build/lint, browser thrashing/admission checks |
| E2 | SRTF, preemptive Priority, aging, MLFQ; integrated SCAN/C-SCAN/LOOK; head path | Boundary/tie/preemption oracles; shared scheduling policy helpers where models agree; movement and service costs agree | Planned |
| E3 | Event-index time travel, predict-first lessons, seeded generators and batch comparisons, extra timeline/chart lanes, localStorage/URL sharing | Replay prefix equals original; reproducible seeds; identical input sets; validated sharing; clearly separate prediction and actual results | Planned |
| E4 | Property-based invariants with fast-check, coverage, Playwright navigation smoke suite, GitHub Pages deployment | Real tests/build/lint remain green; property tests cover enabled extensions; browser smoke passes; deployment URL verified | Planned |
| E5 | Wait-for graph detection and dining philosophers, TLB/EMAT lab | Detection explicitly restricted to single-instance resources; deadlocking/fixed philosophers; serial EMAT oracle and cache invalidation | Planned |
| E6 | Mini filesystem with contiguous/linked/indexed allocation, directories and disk-backed operations | Allocation conservation, directory/path validation, operation completion tied to disk service | Planned |
| E7 | Multi-core scheduling/load balancing, EDF and rate-monotonic lab | Unique core membership, per-core conservation, deterministic migration, release/deadline accounting | Planned |

## E1 semantics

Memory is opt-in so existing scenarios and textbook answers remain unchanged. Fixed allocation reserves all process pages on admission. Demand paging reserves a configurable per-process frame quota, uses **local replacement**, starts frames empty and shares the integrated disk for page-ins. A process with insufficient free frames waits in a FIFO job queue until another process terminates. Clean, read-only pages are modelled; there is no dirty writeback in E1.

Each productive CPU tick references one page. Optional per-burst reference strings must match the CPU duration. A fault consumes no productive tick, blocks the process, queues a page-in, then retries the same reference after disk completion. Retries do not count as a second logical reference or a hit. FIFO uses load order; LRU updates on actual access. Frames are released on termination and all pending activity is discarded on reset.

Context-switch cost applies to a direct change between different processes, including a zero-work page-fault dispatch. Initial dispatch and dispatch after an idle gap are free. The chosen target stays in READY during switching; its waiting time includes the overhead. Useful CPU time, switch overhead and idle time are separate. Switching does not stop the disk. Pages are identified per process; equal page numbers from two processes are not shared.

## Delivery discipline

Implement, test, document and locally commit each phase before beginning the next. Preserve the proposal's original example exports and opt-out behavior. Never label optional work complete until its model, controls and acceptance tests exist. Public hosting uses the existing public repository; no secret scenario data is included in share links automatically.
