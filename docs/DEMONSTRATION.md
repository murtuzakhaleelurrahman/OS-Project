# Classroom presentation guide

1. **Problem and model:** explain why isolated algorithm calculations do not show subsystem interactions. Introduce one CPU, one disk and deterministic logical time.
2. **Architecture:** scenario → ordered event queue → handlers/state → snapshots → React. Explain completion/arrival/expiry/dispatch phases and why animation speed cannot change results.
3. **Integrated walkthrough:** advance the CPU + disk overlap preset one event at a time. At t=2 P1 blocks; P2 uses the CPU while disk service runs. At t=13 disk completion resumes P1; at t=14 it finishes.
4. **Scheduling comparison:** run the CPU oracle using FCFS and SJF, then compare all policy pairs. Explain priorities, RR quantum and tie rules.
5. **Memory:** allocate/free holes, demonstrate a failed allocation despite enough total free space, and show translation 2500 → 5572. Run the reference string to obtain 7/6/5 FIFO/LRU/Optimal faults.
6. **Concurrency:** show the six-operation lost update ending at 1, mutex protection ending at 2, then producer/consumer FIFO wakeups and occupancy limits.
7. **Resource safety:** display Need, Work and the safe sequence. Request P2's one unit and show rollback. Clarify that unsafe does not mean an existing deadlock.
8. **Reproducibility and validation:** export JSON/CSV, reload a workload, and show the automated numerical tests and model assumptions.
9. **Limits and future work:** educational disk costs, separate laboratories, bounded trace retention, no real OS control. Defer demand paging, preemption extensions, TLB, filesystem and deadlock detection.
