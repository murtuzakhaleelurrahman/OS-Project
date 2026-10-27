import { useState } from 'react'
import type { Scenario } from '../simulation/integrated/Scenario'

export function SchedulingOptions({ scenario, load }: { scenario: Scenario; load: (value: unknown) => void }) {
  const [error, setError] = useState('')
  const integer = (raw: string, field: 'agingInterval' | 'boostInterval') => {
    const current = scenario.cpu[field] ?? (field === 'agingInterval' ? 5 : 20)
    const value = Number(raw)
    if (value === current) return
    if (!Number.isSafeInteger(value) || value < 1 || value > 10000) { setError('Use an integer between 1 and 10000 ticks.'); return }
    setError('')
    load({ ...scenario, cpu: { ...scenario.cpu, [field]: value } })
  }
  const algorithm = scenario.cpu.algorithm
  return <>
    <div className="integrated-controls">
      {algorithm === 'AGING' && <label>Aging interval (ticks)
        <input type="number" min="1" defaultValue={scenario.cpu.agingInterval ?? 5}
          key={`aging-${scenario.cpu.agingInterval}`} onBlur={(event) => integer(event.currentTarget.value, 'agingInterval')} />
      </label>}
      {algorithm === 'MLFQ' && <>
        <label>MLFQ queue quanta
          <input style={{ width: 150 }} defaultValue={(scenario.cpu.mlfqQuanta ?? [1, 2, 4]).join(' ')}
            key={`queues-${scenario.cpu.mlfqQuanta?.join(',')}`} onBlur={(event) => {
              const quanta = event.currentTarget.value.trim().split(/[\s,]+/).map(Number)
              if (JSON.stringify(quanta) === JSON.stringify(scenario.cpu.mlfqQuanta ?? [1, 2, 4])) return
              if (quanta.length < 2 || quanta.length > 8 || quanta.some((value, index) => !Number.isSafeInteger(value) || value < 1 || value > 10000 || (index > 0 && value < quanta[index - 1]))) {
                setError('Use 2–8 positive non-decreasing queue quanta.'); return
              }
              setError(''); load({ ...scenario, cpu: { ...scenario.cpu, mlfqQuanta: quanta } })
            }} />
        </label>
        <label>Priority boost interval
          <input type="number" min="1" defaultValue={scenario.cpu.boostInterval ?? 20}
            key={`boost-${scenario.cpu.boostInterval}`} onBlur={(event) => integer(event.currentTarget.value, 'boostInterval')} />
        </label>
      </>}
      {['SCAN', 'C-SCAN', 'LOOK', 'C-LOOK'].includes(scenario.disk.algorithm) && <label>Initial disk direction
        <select value={scenario.disk.initialDirection ?? 'UP'} onChange={(event) => load({ ...scenario, disk: { ...scenario.disk, initialDirection: event.target.value } })}>
          <option>UP</option><option>DOWN</option>
        </select>
      </label>}
    </div>
    {error && <p role="alert" className="integrated-error">{error}</p>}
    <p className="integrated-hint">
      {algorithm === 'SRTF' && 'SRTF preempts only for a strictly shorter remaining CPU burst. Equal remaining times keep the runner.'}
      {algorithm === 'PREEMPTIVE_PRIORITY' && 'Preemptive Priority switches only for a strictly lower numeric priority. Equal priorities keep the runner.'}
      {algorithm === 'AGING' && `Effective READY priority = base − floor(current ready wait / ${scenario.cpu.agingInterval ?? 5}). It may become negative. The runner keeps its dispatch-time priority; aging resets after service.`}
      {algorithm === 'MLFQ' && 'New jobs enter queue 0. Exhausting a queue budget demotes; a higher queue preempts. Partial budgets survive preemption and page faults; ordinary I/O resets the budget. Under contention, periodic boosts return all processes to queue 0.'}
    </p>
  </>
}
