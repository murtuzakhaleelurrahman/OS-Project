# Mini Operating System Dashboard

[![Verify simulator](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/workflows/ci.yml)

**[Open the live simulator](https://murtuzakhaleelurrahman.github.io/OS-Project/)** · [Verified CI and deployment](https://github.com/murtuzakhaleelurrahman/OS-Project/actions/runs/40550899158)

A browser-based educational OS simulator built with React, TypeScript and Vite. No backend is required. The integrated system models **one CPU and one disk** with a deterministic event queue. Memory can optionally participate in the integrated system through frame admission and demand paging. The focused memory, concurrency and resource-safety laboratories remain separate experiments.

## Run

Use Node.js 22.12+ (the project was validated with 22.20.0).

Clone the repository and run these commands on Windows, macOS or Linux:

```sh
git clone https://github.com/murtuzakhaleelurrahman/OS-Project.git
cd OS-Project
npm ci
npm run dev -- --host 127.0.0.1
```

In Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is restricted. You can also open a terminal in an existing clone; no specific drive or folder name is required.

Open the local URL printed in the terminal. For a production preview, run `npm run build` then `npm run preview`.

## What is implemented

- Integrated CPU scheduling: FCFS, non-preemptive SJF/Priority, Round Robin, SRTF, preemptive Priority, aging and MLFQ.
- Alternating CPU/I/O scripts, single-disk FCFS/SSTF/SCAN/C-SCAN/LOOK/C-LOOK, process blocking and resumption, ready/blocked-time accounting, and CPU Gantt chart.
- Stable event ordering: timestamp, completion/arrival/quantum/dispatch phase, insertion sequence. Logical time jumps to the next event. Play and next-event use identical handlers.
- First/Best/Worst Fit allocation, freeing and hole coalescing; configurable memory/page sizes, address translation, page faults and explicit page remapping.
- Independent FIFO/LRU/Optimal reference-string experiments with configurable frames and per-access history.
- Scripted lost-update, mutex-protected increment and bounded-buffer lessons with atomic mutex/semaphore commands and FIFO waiter transfer.
- Banker safety analysis and tentative requests committed only when safe; unsafe requests roll back.
- Presets, editable/importable versioned JSON, all 48 CPU/disk policy comparisons, result/workload JSON and trace/metric CSV exports.
- The earlier manual dashboard is preserved under Memory & algorithms → Additional manual algorithm tools.

## Suggested demonstration

1. **Integrated system:** Run the default CPU + disk overlap preset. P1 completes at 14, P2 at 6; P1 blocks for 11 ticks; CPU work is 7 ticks.
2. **CPU policy:** Choose the CPU oracle preset. FCFS order is P1,P2,P3; SJF order is P1,P3,P2. Compare all policies from the same workload.
3. **Memory & algorithms:** Run the default references with three frames. FIFO/LRU/Optimal fault totals are 7/6/5. Choose the translation example to show physical byte address 5572.
4. **Concurrency:** Run Lost update (final shared value 1), then Mutex-protected increment (final value 2), then Bounded buffer.
5. **Resource safety:** The proposal preset is safe through P1,P2. Request one unit for P2: deferred because the tentative state is unsafe; allocations remain unchanged.
6. Export a result JSON and re-import it to replay its workload from the beginning.

## Assumptions and metrics

All integrated durations use integer logical ticks; CPU bursts are positive. Lower numeric priority means higher priority. SJF chooses the shortest next CPU burst. FCFS/SJF/Priority ties use ready-entry time then natural process ID; RR uses FIFO ready entry. Arrivals at a quantum boundary precede requeuing. Burst completion wins over expiry at an exact quantum boundary.

Disk service is `max(1, baseService + seekCost * full route distance)`; active service is not preempted. FCFS uses enqueue order; SSTF ties use enqueue order. Context-switch cost defaults to zero; optional `cpu.contextSwitchCost` charges direct switches, with overhead reported separately. Only direct switches between different processes count as context switches; dispatch after an idle gap does not.

Waiting accumulates only in READY; blocked time only in BLOCKED. Turnaround = completion - arrival, response = first CPU start - arrival. CPU utilization = productive ticks / elapsed ticks; throughput is completed processes per tick. The completed horizon starts at zero and ends at final completion. Undefined ratios display N/A. Memory addresses are bytes; concurrency uses operation steps, independent of integrated ticks.

## Scenario format

The UI editor contains the complete schema. `schemaVersion` is 1. Each process has a unique `id`, non-negative integer `arrival` and `priority`, and a burst array that starts/ends with CPU and alternates CPU/I/O:

```json
{"id":"P1","arrival":0,"priority":1,"bursts":[{"kind":"cpu","duration":2},{"kind":"io","cylinder":10},{"kind":"cpu","duration":1}]}
```

CPU configuration supplies `algorithm` and a positive `quantum`. Disk configuration supplies `algorithm`, `cylinders`, `initialHead`, `baseService` and `seekCost`. `eventLimit` defaults to 20,000. Inputs are validated before simulation. Changing a policy resets to a fresh copy of the workload. Switching views preserves experiments and pauses integrated playback; refreshing resets playback (a scenario in the URL loads at event zero).

## Validation

```sh
npm test
npm run build
npm run lint
```

See [validation](docs/VALIDATION.md), [architecture and limitations](docs/ARCHITECTURE.md), [implementation phases](docs/IMPLEMENTATION_PLAN.md) and [presentation guide](docs/DEMONSTRATION.md). Exported examples are in `examples/`.

## Limits and future scope

Integrated scenarios accept at most 100 processes and 101 bursts per process; event execution is bounded by an explicit limit (maximum 100,000). The decision trace retains the latest 1,000 events. Result JSON and CSV indicate truncation; scenario JSON always retains the replayable input. Browser imports are limited to 1 MB. Memory labs accept up to 256 resident frames; reference experiments use 1–32 frames and up to 500 references. Actor scripts are bounded at 1,000 operations.

This is an educational abstraction, not real host OS management. TLB/two-level paging, a general thread scheduler, deadlock detection, filesystem and terminal remain outside the committed core. Unsafe Banker results do not establish an existing deadlock. GitHub Pages hosts the client app; there is no backend.

## Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs strict test type checks, coverage-enforced tests, production build and lint on Ubuntu, Windows and macOS with Node 22. A separate Chromium job exercises the production build under `/OS-Project/`. Coverage and browser reports are downloadable workflow artifacts retained for 14 days. All checks must pass before a main-branch push or manual run can deploy GitHub Pages; pull requests never deploy. See the repository Actions tab for actual hosted results.

## Integrated memory extension (E1)

Choose **Demand paging / thrashing** in the integrated preset selector. The 60-tick workload references pages 0,1,2 repeatedly. Compare frames / thrashing shows 60 faults and 16.7% productive utilization with one frame, versus 3 faults and 80.0% with three frames, under the stated five-tick clean page-in cost. Useful work is unchanged. The benchmark changes frame count only; it does not invent hardware measurements.

Choose **Memory admission and cleanup** to see a process wait in the FIFO job queue until another terminates and frees enough frames. Memory remains opt-in; the original CPU/disk examples are unchanged when disabled.

An optional `memory` object supplies `mode` (fixed/demand), `frames`, `pageSize`, `replacement` (FIFO/LRU), `pageInTicks` and `pageInCylinder`. Processes may declare `memoryPages` and `frameQuota`. Demand CPU bursts may supply `references`, one virtual page per productive tick; omitted references use page zero. Quotas reserve frames for the process lifetime and replacement is local. A fault blocks, uses the shared disk, and retries without double-counting the reference. Page-ins add `pageInTicks` to the existing seek/service formula. Pages are clean/read-only; dirty writeback is not yet implemented.

`cpu.contextSwitchCost` is optional. Initial dispatch and dispatch after an idle gap are free; direct changes to a different process incur the configured overhead, including faulting zero-work dispatches. The selected target waits in READY during the switch. CPU work, switch overhead and idle time sum to elapsed time. For each completed process, turnaround = productive CPU + READY wait + blocked time + job-queue wait.

The integrated view now includes reserved/resident frames, faults/hits/replacements, job waits and process-state timeline lanes. See [the extension roadmap](docs/EXTENSION_PLAN.md) for each extension's completion status.
## Expanded scheduling extension (E2)

The integrated model now offers eight CPU policies and six disk policies, with all 48 combinations run from fresh copies of the same input. New presets demonstrate **SRTF arrival preemption**, **Priority aging prevents starvation**, **MLFQ interactive arrival**, and **Disk sweep and wrap paths**.

SRTF and preemptive Priority retain the runner on ties; strictly better candidates preempt and cancel the old CPU event. Aging uses base priority minus floor(current READY wait / `cpu.agingInterval`), defaults to five ticks, and can produce negative effective priorities. The runner keeps its dispatch-time priority until service ends or it is preempted. The aging preset dispatches P2 at tick 6, before the long P1 finishes.

MLFQ defaults to quanta `[1,2,4]`, configurable as `cpu.mlfqQuanta`, with `cpu.boostInterval=20`. Full budget consumption demotes. Higher queues preempt; partial budgets survive preemption and page faults. Ordinary I/O resets the current-level budget without promotion. Under contention, periodic boosts reset all levels/budgets and requeue the runner. Queue level is shown in the process table. The ordinary Quantum field applies to Round Robin; MLFQ uses its queue-quanta field.

Disk `initialDirection` defaults to UP and is selectable for sweep policies. SCAN visits the physical endpoint before reversing; C-SCAN includes endpoint and wrap movement. LOOK/C-LOOK reverse/jump at pending request extremes. All legs count toward movement and service time. Active routes are non-preemptive. The head-path chart displays completed route waypoints, not fabricated intermediate timestamps, and retains the latest 200 points for large runs. Sweep travel stops when the final pending request is serviced.

See `docs/EXTENSION_PLAN.md` for the precise contracts. FCFS/SJF/Priority ranking is now shared by the legacy and integrated models through adapters; their distinct execution clocks remain separate.

## Learning and reproducible experiments (E3)

- **Time travel:** use Previous event, or Prepare replay slider to jump to any queue-event index. Replay rebuilds the exact CPU/disk/memory state, even beyond the 1,000-entry trace retention cap. Same-tick events remain distinct. An event-limited run has a labelled incomplete history.
- **Predict first:** try the FCFS-order or one-frame page-fault exercise. Submit a guess to reveal the actual engine result and an explanation. These lessons are independent of the active scenario.
- **Seeded comparisons:** choose an unsigned 32-bit seed, up to 100 workloads and up to 12 processes per workload. All eight CPU policies receive identical generated CPU/I/O scripts, arrivals and priorities; the selected disk policy and costs stay fixed. Memory is disabled for this study. Charts compare mean READY wait, turnaround and throughput. Limited runs produce N/A means; Stop comparison keeps a labelled partial sample. Repeating a seed and configuration reproduces the results.
- **Save & share:** Save in browser stores one workload locally; Load saved workload restores it. Create share link provides a selectable URL containing the complete scenario, loaded at event zero. Links are limited to 16,000 characters and validated before loading; use JSON export for larger workloads. Use the live simulator to create public links. Localhost links require another local copy of the app.

Saving and sharing are explicit. Playback, predictions and comparison results are not automatically stored. Existing process-state lanes distinguish I/O blocking from page faults and READY waits, while the disk chart shows physical routes.

## Verification and hosting (E4)

```sh
npm ci
npm run test:typecheck
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm run build
npm run lint
```

`test:coverage` includes the deterministic unit tests and fast-check properties. Each of the 48 policy pairs runs 20 generated workloads with assertions after every event; another 60 cases verify sharing and replay. Generators cover disabled/fixed/demand memory, FIFO/LRU, frame admission, context-switch costs, both sweep directions and CPU/I/O scripts. Seeds are fixed and fast-check prints a shrunk counterexample and replay path if a property fails. These 1,020 generated cases are represented by 49 property tests, not 1,020 separate unit tests.

Coverage measures all `src/simulation/**/*.ts`, including previously unimported files, and excludes React UI. Gates require statements/functions >=90%, branches >=85%, and lines >=95%. Open `coverage/index.html` for the local HTML report; `coverage/lcov.info` is available for other tooling. Chromium tests cover all four modes plus replay, paging, 48-pair comparisons, prediction, seeded-study stop/restart, local saving and URL sharing. Open the browser report with `npm run test:e2e:report`. Generated reports stay out of Git.

`npm run build:pages` builds assets for `/OS-Project/`; `npm run test:e2e` starts its own production preview on port 4174 and leaves the development server alone. For a manual Pages-style preview use `npm run build:pages` followed by `npm run preview -- --base=/OS-Project/`. GitHub Pages is configured to use **Settings → Pages → Source → GitHub Actions**. The workflow publishes only the verified `dist` directory. The first verified deployment and live browser checks are recorded in `docs/VALIDATION.md`.
