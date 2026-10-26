# Proposal implementation plan

Primary repository: `D:\OS Project`. Baseline: commit `951e601`, 102 tests.
The source proposal is Mini_OS_Dashboard_Updated_Project_Proposal.pdf (12 October 2026).

Each phase is developed, tested, built and committed locally before the next phase.
Existing algorithm laboratories remain available. Optional extensions do not count toward core acceptance.

| Phase | Scope | Exit checks | Status |
| --- | --- | --- | --- |
| 1 | Versioned scenarios, event queue, deterministic CPU engine, integrated view, next event/play/reset | Phase ordering, invalid input, CPU oracle, replay and timer equivalence, bounded execution | Complete: 113 tests, build and lint pass |
| 2 | CPU/disk bursts, FCFS/SSTF service, blocking/resumption, ready/blocked accounting | P1 completes at 14, P2 at 6, blocked=11, CPU work=7; quantum boundary ordering; idle gaps | Complete: 118 tests, build and lint pass |
| 3 | Banker safety and resource requests | Dimension/value validation, reproducible safe sequence, unsafe request rollback | Complete: 122 tests, build and lint pass |
| 4 | Scripted synchronization actors, lost update, mutex, semaphores, bounded buffer | Counter=1 without protection, counter=2 with mutex; FIFO wakeup and capacity invariant | Complete: 127 tests, build and lint pass |
| 5 | Presets, fresh-input comparisons, scenario/result JSON and trace/metric CSV | Replay exported scenarios; same input across policies; exported assumptions and units | Planned |
| 6 | Memory lab configuration, navigation, documentation and acceptance | Paging 7/6/5 faults; translation 5572; allocation/free/coalescing; all tests/build/lint pass | Planned |

## Model contract

One CPU and one disk. Logical durations are integer ticks; CPU bursts are positive. Event order is timestamp, phase (completion, arrival, quantum expiry, dispatch), insertion sequence. Ready candidates use ready-entry time then process ID, with FIFO ordering for RR. Lower numeric priority wins. SJF and Priority are non-preemptive. Context-switch cost is zero. Integrated runs and memory/synchronization/resource laboratories are explicitly separate.

## Deferred extensions

Demand paging integrated with I/O, SRTF, preemptive priority, aging, MLFQ, TLB, two-level paging, general thread scheduling, deadlock detection, a filesystem and terminal.
