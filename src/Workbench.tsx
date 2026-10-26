import { useState } from 'react'
import Laboratories from './App'
import { IntegratedPanel } from './components/IntegratedPanel'
import { ResourcePanel } from './components/ResourcePanel'
import './Workbench.css'

export default function Workbench() {
  const [view, setView] = useState<'system' | 'labs' | 'resources'>('system')
  return <><nav className="workbench-nav" aria-label="Simulator modes"><a href="#" onClick={(event) => { event.preventDefault(); setView('system') }}>mOS<span> / learning workbench</span></a><div><button className={view === 'system' ? 'active' : ''} onClick={() => setView('system')}>Integrated system</button><button className={view === 'labs' ? 'active' : ''} onClick={() => setView('labs')}>Algorithm laboratories</button><button className={view === 'resources' ? 'active' : ''} onClick={() => setView('resources')}>Resource safety</button></div></nav>{view === 'system' ? <IntegratedPanel /> : view === 'resources' ? <ResourcePanel /> : <><div className="lab-banner">ALGORITHM LABORATORIES · These experiments are separate from the integrated scenario.</div><Laboratories /></>}<footer className="workbench-footer">Mini OS Dashboard · Educational simulation · All times are logical ticks unless stated otherwise.</footer></>
}
