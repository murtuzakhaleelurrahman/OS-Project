# Mini OS Dashboard Instructions

- Keep all simulated operating-system state inside `src/simulation`.
- React components may render snapshots and dispatch engine commands, but must not mutate simulation state directly.
- Preserve deterministic discrete-event behavior: one logical clock and no per-process timers.
- Keep algorithms pure and independently testable where practical.
- Use strict TypeScript and add focused unit tests for simulation behavior.
