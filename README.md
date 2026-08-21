# Mini Operating System Dashboard

Phase 1 establishes the deterministic simulation foundation for an educational mini operating system simulator. It is a frontend-only simulation and does not interact with host hardware, processes, memory, or filesystems.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. The dashboard demonstrates the shared logical clock and centralized event log through Start, Pause, Step, Fast-forward, and Reset controls.

## Test and build

```bash
npm test
npm run build
npm run lint
```

## Phase 1 architecture

- `SimulationClock` owns one logical tick counter and one optional timer.
- `EventSystem` stores structured events and supports subscriptions.
- `SimulationEngine` coordinates both systems and exposes immutable snapshots for React.
- React only subscribes to snapshots and dispatches engine commands; it does not own simulation state.

Process management, scheduling, memory, filesystem, synchronization, deadlock, disk scheduling, terminal commands, and scenarios are reserved for later phases.
