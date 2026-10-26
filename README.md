# Mini Operating System Dashboard

A browser-based educational OS simulator built with React, TypeScript and Vite. No backend is required. The integrated system models **one CPU and one disk** with a deterministic event queue. Memory, concurrency and resource-safety laboratories are explicitly separate experiments.

## Run

Use Node.js 22.12+ (the project was validated with 22.20.0).

```powershell
cd "D:\OS Project"
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1
```

Open the local URL printed in the terminal. For a production preview, run `npm.cmd run build` then `npm.cmd run preview`.

## What is implemented

- Integrated CPU scheduling: FCFS, non-preemptive SJF, non-preemptive Priority, Round Robin.
- Alternating CPU/I/O scripts, single-disk FCFS/SSTF, process blocking and resumption, ready/blocked-time accounting, and CPU Gantt chart.
- Stable event ordering: timestamp, completion/arrival/quantum/dispatch phase, insertion sequence. Logical time jumps to the next event. Play and next-event use identical handlers.
- First/Best/Worst Fit allocation, freeing and hole coalescing; configurable memory/page sizes, address translation, page faults and explicit page remapping.
- Independent FIFO/LRU/Optimal reference-string experiments with configurable frames and per-access history.
- Scripted lost-update, mutex-protected increment and bounded-buffer lessons with atomic mutex/semaphore commands and FIFO waiter transfer.
- Banker safety analysis and tentative requests committed only when safe; unsafe requests roll back.
- Presets, editable/importable versioned JSON, all eight CPU/disk policy comparisons, result/workload JSON and trace/metric CSV exports.
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

Disk service is `max(1, baseService + seekCost * abs(target - head))`; active service is not preempted. FCFS uses enqueue order; SSTF ties use enqueue order. Context-switch cost is zero. Only direct switches between different processes count as context switches; dispatch after an idle gap does not.

Waiting accumulates only in READY; blocked time only in BLOCKED. Turnaround = completion - arrival, response = first CPU start - arrival. CPU utilization = productive ticks / elapsed ticks; throughput is completed processes per tick. The completed horizon starts at zero and ends at final completion. Undefined ratios display N/A. Memory addresses are bytes; concurrency uses operation steps, independent of integrated ticks.

## Scenario format

The UI editor contains the complete schema. `schemaVersion` is 1. Each process has a unique `id`, non-negative integer `arrival` and `priority`, and a burst array that starts/ends with CPU and alternates CPU/I/O:

```json
{"id":"P1","arrival":0,"priority":1,"bursts":[{"kind":"cpu","duration":2},{"kind":"io","cylinder":10},{"kind":"cpu","duration":1}]}
```

CPU configuration supplies `algorithm` and a positive `quantum`. Disk configuration supplies `algorithm`, `cylinders`, `initialHead`, `baseService` and `seekCost`. `eventLimit` defaults to 20,000. Inputs are validated before simulation. Changing a policy resets to a fresh copy of the workload. Switching views preserves experiments and pauses integrated playback; refreshing the page resets them.

## Validation

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run lint
```

See [validation](docs/VALIDATION.md), [architecture and limitations](docs/ARCHITECTURE.md), [implementation phases](docs/IMPLEMENTATION_PLAN.md) and [presentation guide](docs/DEMONSTRATION.md). Exported examples are in `examples/`.

## Limits and future scope

Integrated scenarios accept at most 100 processes and 101 bursts per process; event execution is bounded by an explicit limit (maximum 100,000). The decision trace retains the latest 1,000 events. Result JSON and CSV indicate truncation; scenario JSON always retains the replayable input. Browser imports are limited to 1 MB. Memory labs accept up to 256 resident frames; reference experiments use 1–32 frames and up to 500 references. Actor scripts are bounded at 1,000 operations.

This is an educational abstraction, not real host OS management. Integrated demand paging, TLB/two-level paging, preemptive priority/SRTF, aging/MLFQ, a general thread scheduler, deadlock detection, filesystem and terminal remain outside the committed core. Unsafe Banker results do not establish an existing deadlock. No cloud hosting or backend is configured.
