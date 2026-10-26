import { useState } from 'react'
import Laboratories from './App'
import { IntegratedPanel } from './components/IntegratedPanel'
import './Workbench.css'

export default function Workbench() {
  const [view, setView] = useState<'system' | 'labs'>('system')
  return <><nav className="workbench-nav" aria-label="Simulator modes"><a href="#" onClick={(event) => { event.preventDefault(); setView('system') }}>mOS<span> / learning workbench</span></a><div><button className={view === 'system' ? 'active' : ''} onClick={() => setView('system')}>Integrated system</button><button className={view === 'labs' ? 'active' : ''} onClick={() => setView('labs')}>Algorithm laboratories</button></div></nav>{view === 'system' ? <IntegratedPanel /> : <><div className="lab-banner">ALGORITHM LABORATORIES · These experiments are separate from the integrated scenario.</div><Laboratories /></>}<footer className="workbench-footer">Mini OS Dashboard · Educational simulation · All times are logical ticks unless stated otherwise.</footer></>
}
