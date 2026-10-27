# Validation record

Validation date: 26 October 2026. Commands run from the repository root.

## Automated acceptance

| Proposal check | Evidence |
| --- | --- |
| CPU FCFS oracle | Order P1,P2,P3; waits 0,4,6; completion horizon 9 |
| CPU SJF oracle | Order P1,P3,P2; waits by PID 0,5,3 |
| Paging oracle | References 1,2,3,1,4,1,2,5 with 3 frames: FIFO 7, LRU 6, Optimal 5 faults; fills excluded from replacements |
| Translation oracle | Page size 1024; logical address 2500; page 2 in frame 5; offset 452; physical address 5572; out-of-range address rejected |
| Banker oracle | Available [1], Allocation [[1],[1]], Maximum [[2],[3]]: safe sequence P1,P2; P2 request [1] deferred and rolled back |
| CPU/disk integration | P1 completes at 14, P2 at 6; P1 blocked 11; CPU busy 7; idle 7; utilization 50% |
| Concurrency oracle | Lost-update shared value 1; full-region mutex shared value 2; bounded-buffer items consumed in FIFO order within capacity |
| Determinism | Repeated runs, step versus timer playback and reset produce identical traces and metrics |
| Event ordering | Completion → arrival → expiry → dispatch; stable insertion order; no earlier same-time phase scheduling |
| Edge cases | Empty workload/N/A ratios, idle gaps, exact quantum completion, arrival at quantum boundary, duplicate disk cylinders, one-frame/repeated-page references, invalid matrices, unmap/remap, failed allocation, coalescing, reset during pending CPU/disk completion, event limit and trace retention |
| State invariants | At most one runner; no duplicate ready membership; turnaround = CPU + READY wait + BLOCKED time; buffer occupancy and production/consumption conservation; safe requests conserve total resources |

The historical baseline at commit `951e601` contained 102 tests. The current suite contains 148 tests; the additional acceptance, laboratory, export and preset tests extend that baseline. IMPLEMENTATION_PLAN.md records the historical count at each phase, rather than the current total. Production compilation and lint are required for each phase. The phase commits were published on GitHub; subsequent checks are automated by `.github/workflows/ci.yml`. Historical browser checks below were performed manually and are distinct from automated CI evidence.

## Browser smoke checks

Verified the running localhost app through its actual controls:

- Integrated overlap run displays t=14, CPU work 7, utilization 50%, P1 blocked 11 and completion 14, P2 completion 6, and the correct Gantt segments.
- Comparing policies displays eight fresh-run rows.
- Banker P2 request is deferred with an unsafe-state explanation; current Available and allocations remain unchanged.
- Lost-update lesson ends at 1; protected lesson ends at 2, displaying ownership transfer.
- Translation preset displays 5572; FIFO reference run displays 7 faults. Changing frame count resets the independent experiment.
- View navigation preserves experiments; integrated playback pauses when hidden.

Browser interactions are smoke checks, not a claim of a comprehensive automated cross-browser UI suite. The numerical acceptance tests exercise the core directly.

## Limits

Trace/result exports disclose retention truncation. Large custom scenarios stop explicitly at their configured event limit. No measurements claim real hardware performance. Optional extensions listed in the proposal remain excluded from core acceptance.

## Review follow-up

The follow-up patch passes the real npm commands locally: 148 tests, production build and lint. Three preset-identification tests cover normalized built-ins, edits under an unchanged name, and independent policy changes. Browser checks confirm unchanged quantum focus/blur preserves t=14, a changed quantum resets the run, invalid quantum input preserves the result, and edited bursts display Custom workload. The new CI workflow is configured for Ubuntu, Windows and macOS; a successful hosted run is not claimed until GitHub Actions reports it.

## E1 extension verification (27 October 2026)

The suite now contains 158 tests. Tests/build/lint pass locally, including the original proposal cases with memory disabled. New cases cover local FIFO/LRU, one fault followed by exact retry counting, mixed page-in and explicit I/O on the same disk, termination/admission, two-process time conservation, overhead costs, invalid quotas/references, and reset during paging.

The thrashing reference workload uses sixty productive ticks and a three-page cyclic working set. One/two frames give 60 faults and 16.67% productive utilization; three or more frames give 3 faults and 80.00%. The browser independently displayed these results, showed P2 waiting in JOB with 3/4 frames reserved, then showed both processes terminated and 0/4 reserved after cleanup. This is local replacement with reserved per-process quotas and clean read-only pages; global replacement and dirty-page writeback remain future work. The browser's original stale tab failed to reconnect; verification succeeded in a fresh tab against the restarted localhost server.
