import { useState } from 'react'
import { serialEmat, TlbLaboratory, tlbConfiguration } from '../simulation/memory/TlbLaboratory'
import './AdvancedLabs.css'

const decimal = (value: number | null, suffix = '') => value === null ? 'N/A' : `${Number.isInteger(value) ? value : value.toFixed(2)}${suffix}`

export function TlbPanel() {
  const [lab, setLab] = useState(() => new TlbLaboratory())
  const [snapshot, setSnapshot] = useState(() => lab.snapshot())
  const [capacity, setCapacity] = useState('2'), [policy, setPolicy] = useState<'FIFO' | 'LRU'>('LRU')
  const [lookup, setLookup] = useState('20'), [memory, setMemory] = useState('100')
  const [pid, setPid] = useState('P1'), [address, setAddress] = useState('2500')
  const [page, setPage] = useState('2'), [frame, setFrame] = useState('4')
  const [percent, setPercent] = useState('80')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const selected = snapshot.spaces.some((space) => space.pid === pid) ? pid : snapshot.spaces[0]?.pid ?? ''
  const last = snapshot.trace.at(-1)
  const operate = (command: () => void, feedback = '') => {
    try { command(); setError(''); setNotice(feedback) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid operation'); setNotice('') }
    setSnapshot(lab.snapshot())
  }
  const numeric = (value: string) => { if (!value.trim()) throw new Error('Fill in all required numeric fields'); return Number(value) }
  let analytical: number | null = null
  try { analytical = serialEmat(numeric(percent) / 100, snapshot.configuration.lookupNs, snapshot.configuration.memoryNs) } catch { /* invalid drafts stay visible */ }
  return <section className="integrated-card"><p className="kicker">ADDRESS TRANSLATION / TLB & EFFECTIVE ACCESS TIME</p><h2>Cache the translation.</h2>
    <p className="integrated-hint">Independent lab: ASID-tagged TLB, single-level page table, serial lookup, {snapshot.configuration.pageSize}-byte pages and {snapshot.configuration.frames} physical frames. Equal virtual pages in different processes have different cache keys. Page faults are reported but do not perform disk page-ins here.</p>
    <div className="integrated-controls"><label>TLB entries<input type="number" min="1" max="32" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label><label>TLB policy<select value={policy} onChange={(event) => setPolicy(event.target.value as 'FIFO' | 'LRU')}><option>LRU</option><option>FIFO</option></select></label><label>TLB lookup ns<input type="number" min="0" value={lookup} onChange={(event) => setLookup(event.target.value)} /></label><label>Memory access ns<input type="number" min="1" value={memory} onChange={(event) => setMemory(event.target.value)} /></label><button onClick={() => { try {
      const next = new TlbLaboratory({ ...tlbConfiguration, capacity: numeric(capacity), policy, lookupNs: numeric(lookup), memoryNs: numeric(memory) })
      setLab(next); setSnapshot(next.snapshot()); setPid('P1'); setError(''); setNotice('Fresh TLB configuration applied; mappings and counters reset.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid configuration'); setNotice('') } }}>Apply & reset TLB</button></div>
    <p className="integrated-hint">Active: {snapshot.configuration.capacity} entries · {snapshot.configuration.policy} · lookup {snapshot.configuration.lookupNs} ns · memory {snapshot.configuration.memoryNs} ns. Draft changes apply when you press Apply.</p>
    <div className="integrated-controls"><label>TLB process<select value={selected} disabled={!selected} onChange={(event) => setPid(event.target.value)}>{snapshot.spaces.map((space) => <option key={space.pid}>{space.pid}</option>)}</select></label><label>TLB logical address<input type="number" min="0" value={address} onChange={(event) => setAddress(event.target.value)} /></label><button disabled={!selected} onClick={() => operate(() => { lab.access(selected, numeric(address)) })}>Translate through TLB</button><button className="quiet" onClick={() => operate(() => lab.flush(), 'TLB flushed; mappings and statistics retained.')}>Flush TLB</button><button className="quiet" onClick={() => operate(() => lab.reset(), 'Initial mappings restored; TLB and statistics reset.')}>Reset TLB experiment</button></div>
    {last && <div className="tlb-result" role="status"><strong>Last access #{last.attempt}: {last.outcome === 'FAULT' ? 'PAGE FAULT' : `TLB ${last.outcome}`}</strong><p>{last.pid} · address {last.address} · page {last.page} · offset {last.offset} · {last.physical === undefined ? 'page is not resident' : `physical address ${last.physical}`} · {last.costNs} ns{last.outcome === 'FAULT' ? ' to detect fault; page-in time excluded' : ''}.</p></div>}
    <div className="integrated-stats">{[['TLB hits', snapshot.hits], ['TLB misses', snapshot.misses], ['Page faults', snapshot.faults], ['Observed EMAT', decimal(snapshot.observedEmat, ' ns')]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="emat-formula">EMAT = h × (t + m) + (1 − h) × (t + 2m) = t + (2 − h)m</div>
    <div className="integrated-controls"><label>Assumed TLB hit percentage<input type="number" min="0" max="100" step="0.1" value={percent} onChange={(event) => setPercent(event.target.value)} /></label><p aria-live="polite">Analytical EMAT: {analytical === null ? 'Enter a hit percentage from 0 to 100.' : decimal(analytical, ' ns')}</p></div>
    <p className="integrated-hint">t = TLB lookup; m = one memory access. Hit: t+m; resident miss: t+2m. The analytical percentage is your assumption, separate from measured hits. Successful-translation hit ratio: {decimal(snapshot.hitRatio === null ? null : snapshot.hitRatio * 100, '%')}; formula using that ratio: {decimal(snapshot.formulaEmat, ' ns')}. Faults are TLB misses, incur t+m to detect, and are excluded from both observed EMAT and its hit ratio. No disk, cache overlap or multilevel page walk is included.</p>
    <div className="integrated-controls"><label>TLB virtual page<input type="number" min="0" value={page} onChange={(event) => setPage(event.target.value)} /></label><label>TLB target frame<input type="number" min="0" max="7" value={frame} onChange={(event) => setFrame(event.target.value)} /></label><button className="quiet" disabled={!selected} onClick={() => operate(() => lab.map(selected, numeric(page), numeric(frame)), 'Mapping updated; the cached entry for this page was invalidated. Translate again to see the new address.')}>Map / remap TLB page</button><button className="quiet" disabled={!selected} onClick={() => operate(() => lab.unmap(selected, numeric(page)), 'Page unmapped; its cached entry was invalidated.')}>Unmap TLB page</button><button className="quiet" disabled={!selected} onClick={() => operate(() => lab.free(selected), 'Address space freed; all its cached entries were invalidated.')}>Free TLB process</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="advanced-grid tlb-entries"><div><h3>Tagged TLB entries</h3><div className="table-wrap"><table><thead><tr><th>ASID / process</th><th>Page</th><th>Frame</th><th>Load order</th><th>Last used</th></tr></thead><tbody>{snapshot.entries.map((entry) => <tr key={`${entry.pid}/${entry.page}`}><td>{entry.pid}</td><td>{entry.page}</td><td>{entry.frame}</td><td>{entry.loaded}</td><td>{entry.used}</td></tr>)}</tbody></table></div></div><div><h3>Resident page tables</h3><div className="table-wrap"><table><thead><tr><th>Process</th><th>Page → frame</th></tr></thead><tbody>{snapshot.spaces.map((space) => <tr key={space.pid}><td>{space.pid}</td><td>{space.pages.map((mapped, index) => `${index}→${mapped ?? 'not resident'}`).join(', ')}</td></tr>)}</tbody></table></div></div></div>
    <details><summary>TLB access trace (latest {snapshot.trace.length} of {snapshot.attempts})</summary><div className="table-wrap"><table><thead><tr><th>#</th><th>Process</th><th>Logical</th><th>Outcome</th><th>Physical</th><th>Latency ns</th></tr></thead><tbody>{snapshot.trace.map((entry) => <tr key={entry.attempt}><td>{entry.attempt}</td><td>{entry.pid}</td><td>{entry.address}</td><td>{entry.outcome}</td><td>{entry.physical ?? 'fault'}</td><td>{entry.costNs}</td></tr>)}</tbody></table></div></details>
  </section>
}
