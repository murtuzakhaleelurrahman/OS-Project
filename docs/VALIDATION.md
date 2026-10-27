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

The historical baseline at commit `951e601` contained 102 tests. The current suite contains 280 core/property tests plus 8 automated Chromium browser tests. IMPLEMENTATION_PLAN.md records historical milestone counts. Production compilation and lint are required for each phase. Hosted checks run through `.github/workflows/ci.yml` when pushed; deployment records below distinguish local from hosted evidence. Historical manual browser checks remain separate from the automated suite added in E4 and extended in E5.

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

## E2 extension verification (27 October 2026)

175 tests pass locally with build and lint. New checks cover SRTF event cancellation and remaining-time ties; strict preemptive Priority; exact aging boundaries; MLFQ demotion, partial-budget retention and boosts; arrivals during switching; deterministic timer/step/reset behavior; page-reference counting at preemption; full UP/DOWN SCAN/C-SCAN/LOOK/C-LOOK paths; duplicate-cylinder ties; path-derived service duration; and time/reference conservation for all 48 CPU/disk combinations with demand paging enabled.

Browser checks show SRTF segments P1[0,2), P2[2,4), P1[4,10); aging segments P1[0,6), P2[6,7), P1[7,21); and the MLFQ higher-queue preemption with retained budget. The sweep preset shows SCAN route 199→20 and C-SCAN route 199→0→10, with corresponding movement/service totals. The expanded comparison control produces 48 policy rows. These are manual browser checks in addition to the automated core tests, not a claim of a Playwright CI suite.

## E3 extension verification (27 October 2026)

194 tests pass with production build and lint. Replay tests compare every original prefix for overlap, paging, SRTF, aging, MLFQ and disk sweeps; another case crosses the trace cap with paging and switch overhead. Tests check rewind/continue equivalence, invalid indices and event limits, a stable seed-zero oracle, reproducible inputs/results, all-policy equal-weight aggregate oracles, explicit incomplete results, study bounds, prediction validation/answers, Unicode share round-trips, invalid schemas/encoding and oversized links.

Manual browser checks confirm previous-event rewind, slider zero/final endpoints and exact restoration of the overlap Gantt chart; incorrect FCFS feedback and the correct 60-fault prediction; 100/100 generated workloads completed for all eight policies; stopping a partial comparison and immediately restarting with a different seed; browser save/load restoring the original workload; and share-link restoration on same-document navigation and reload. These local UI checks supplement core tests; the automated Playwright suite and coverage work remain E4.

## E4 local verification (27 October 2026)

The real npm clean install succeeds from the lockfile without special peer-dependency flags. Strict test type checking, 243 core/property tests, production compilation and lint pass locally. All 5 automated Chromium smoke tests pass against a production build served at `/OS-Project/`, covering navigation and preserved state, textbook lab operations, replay endpoints/continuation, demand paging, 48 comparison rows, predict-first answers, reproducible charts, stop/restart and validated saved/shared scenarios. Page errors and JS/CSS failures fail browser tests. Chromium is the automated browser scope; this does not claim Firefox/WebKit coverage.

The 49 fast-check properties execute 960 generated policy/workload combinations plus 60 replay/share cases, with automatic shrinking and fixed seeds. The additional reset pass checks every generated policy workload again. Coverage across all simulation sources: statements 93.53%, branches 87.96%, functions 96.81%, lines 98.36%. UI coverage is excluded from that figure and exercised through browser checks. Gates are 90% statements/functions, 85% branches and 95% lines. Matching patched Vitest/coverage 4.1.12 and Vite 8.3.5 are locked; npm audit reports zero known vulnerabilities at validation time.

The workflow uploads coverage and browser reports, then permits Pages publishing only after the three-OS verification matrix and browser job succeed. Local results alone do not establish deployment success.

## E4 hosted acceptance

[Run 40550899158](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/runs/40550899158), commit `917c0ff`, completed successfully on 27 October 2026: Ubuntu, Windows and macOS verification, the five Chromium smoke tests, report uploads and the dependent Pages deployment. The browser job uses the locally verified Windows runner with headless-only Chromium installation. An earlier superseded run was cancelled after its Linux browser dependency bootstrap remained active for several minutes; the final run passed every required job.

[The public simulator](https://murtuzakhaleelurrahman.github.io/OS-Project/) returns HTTP 200 and loads its app assets. Actual public-browser checks reproduce the overlap run at t=14 with 7 useful ticks and 50% utilization, P1/P2 completion and Gantt intervals; the memory lab translates to physical address 5572; returning to the integrated view preserves the run. Generated share links use the public GitHub Pages origin. The browser reported no runtime errors or warnings. These live checks are distinct from the automated production-preview suite and the hosted build result.

## E5 local acceptance

280 core/property tests and eight production-preview Chromium tests pass, along with strict test typing, build and lint. Simulation coverage: 94.16% statements, 89.20% branches, 97.12% functions and 98.45% lines. Existing gates remain unchanged.

Deadlock tests cover the P1/P2 cycle with P3 dependent, acyclic waiting, free resources, empty graphs, self-waits, disjoint/overlapping cycles, input immutability, validation and rejected multi-instance resources. A 100-case fixed-seed property compares detection with an independent Floyd–Warshall reachability oracle. Dining tests run both policies for every group size 2–10 and check exact fork ownership/meals after every step, deterministic replay, full naive deadlock and ordered completion/release.

TLB tests cover the serial 140 ns oracle, zero/full hit ratios, physical address 5572, ASID isolation, FIFO/LRU victims, remapping to 4548, unmap/free/reuse invalidation, uncached page faults, fault-excluded EMAT, atomic rejected operations, flush/reset, defensive snapshots and trace retention. Another 100-case property interleaves accesses/maps/unmaps/flushes and checks coherence, capacity and equality of measured/formula EMAT. The three new browser tests exercise graph edits, deadlocking/corrected dining runs, and TLB translation/remap/fault/configuration behavior.

## E5 hosted acceptance

[Run 40555374667](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/runs/40555374667), commit `32d6882`, passed Ubuntu, Windows and macOS verification, all eight Chromium tests, report uploads and GitHub Pages deployment. macOS initially waited in GitHub's runner queue, then passed all checks. No gate was removed or reduced.

The deployed app was checked through its actual public controls: the detector identifies P1/P2 in the cycle and P3 behind it; naive dining deadlocks with five participants at step 10; ordered dining completes with all five fed and forks released. P1 address 2500 misses then hits at physical address 5572, remapping invalidates the cache and produces a fresh miss at 4548, and the assumed 80% hit-ratio formula displays 140 ns. No browser runtime errors or warnings were reported. Both narrow and desktop diagram layouts were inspected locally in addition to the automated suite.
