# Classroom presentation guide

1. **Problem and model:** explain why isolated algorithm calculations do not show subsystem interactions. Introduce one CPU, one disk and deterministic logical time.
2. **Architecture:** scenario → ordered event queue → handlers/state → snapshots → React. Explain completion/arrival/expiry/dispatch phases and why animation speed cannot change results.
3. **Integrated walkthrough:** advance the CPU + disk overlap preset one event at a time. At t=2 P1 blocks; P2 uses the CPU while disk service runs. At t=13 disk completion resumes P1; at t=14 it finishes.
4. **Scheduling comparison:** run the CPU oracle using FCFS and SJF, then compare all policy pairs. Explain priorities, RR quantum and tie rules.
5. **Memory:** allocate/free holes, demonstrate a failed allocation despite enough total free space, and show translation 2500 → 5572. Run the reference string to obtain 7/6/5 FIFO/LRU/Optimal faults.
6. **Concurrency:** show the six-operation lost update ending at 1, mutex protection ending at 2, then producer/consumer FIFO wakeups and occupancy limits.
7. **Resource safety:** display Need, Work and the safe sequence. Request P2's one unit and show rollback. Clarify that unsafe does not mean an existing deadlock.
8. **Reproducibility and validation:** export JSON/CSV, reload a workload, and show the automated numerical tests and model assumptions.
9. **Limits and future work:** educational disk costs, separate laboratories, bounded trace retention, no real OS control. Demonstrate the E1–E5 extensions; filesystem, multicore and real-time scheduling remain future phases.

## E3 classroom exercises

1. Complete the overlap example, prepare the replay slider, then jump to event zero and return to the final event. Explain why several events may share a logical tick and why event index differs from time.
2. Try each Predict first lesson before viewing the answer. FCFS serves P1, P2, P3; with one empty frame, cyclic references 0,1,2 fault on all 60 accesses.
3. Run seed 2026 with 100 workloads and five processes. Explain that all CPU policies receive identical inputs, memory is disabled in this batch experiment, and disk policy/costs remain fixed. Compare mean wait, turnaround and throughput; repeat the seed to reproduce the results.
4. Save a workload in the browser, change the preset and load the saved one. Create a share link and open it to reproduce the scenario at event zero. Localhost URLs require the same app to run locally; large scenarios can be shared as JSON files.

## E5 classroom exercises

1. In Resource safety, explain why Banker's unsafe state differs from an actual deadlock. In Wait-for graph detection, identify P1/P2 in the cycle and P3 waiting behind it. Load waiting chain and explain why waiting alone does not prove deadlock. Try editing a resource to two instances and observe the explicit rejection.
2. In Concurrency, step five philosophers until all hold one fork. Run to the circular wait at step 10. Use ordered forks, then run again: every philosopher eats once and all forks are released. Explain global resource ordering and why this finite demonstration is not a general starvation proof.
3. In Memory & algorithms, translate P1 address 2500 twice through the TLB. Explain the 220 ns miss and 120 ns hit, both giving physical address 5572. At assumed 80% hits, derive EMAT = 0.8×120 + 0.2×220 = 140 ns.
4. Remap P1 page 2 to free frame 4; the next access misses and gives physical address 4548. Unmap it and observe a page fault with no cache insertion. Explain why process tags prevent cross-process hits and why disk page-in time is outside this standalone formula.
