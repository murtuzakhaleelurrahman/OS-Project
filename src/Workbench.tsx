import { useState } from 'react'
import Laboratories from './App'
import { IntegratedPanel } from './components/IntegratedPanel'
import { ResourcePanel } from './components/ResourcePanel'
import { ActorPanel } from './components/ActorPanel'
import { MemoryPanel } from './components/MemoryPanel'
import { FileSystemPanel } from './components/FileSystemPanel'
import './Workbench.css'
import './Enhancements.css'

export default function Workbench() {
  const [view, setView] = useState<'system' | 'labs' | 'resources' | 'actors' | 'files'>('system')
  return <><nav className="workbench-nav" aria-label="Simulator modes"><a href="#" onClick={(event) => { event.preventDefault(); setView('system') }}>mOS<span> / learning workbench</span></a><div><button className={view === 'system' ? 'active' : ''} onClick={() => setView('system')}>Integrated system</button><button className={view === 'labs' ? 'active' : ''} onClick={() => setView('labs')}>Memory & algorithms</button><button className={view === 'actors' ? 'active' : ''} onClick={() => setView('actors')}>Concurrency</button><button className={view === 'resources' ? 'active' : ''} onClick={() => setView('resources')}>Resource safety</button><button className={view === 'files' ? 'active' : ''} onClick={() => setView('files')}>File system</button></div></nav><div hidden={view !== 'system'}><IntegratedPanel active={view === 'system'} /></div><div hidden={view !== 'resources'}><ResourcePanel /></div><div hidden={view !== 'actors'}><ActorPanel /></div><div hidden={view !== 'files'}><FileSystemPanel /></div><div hidden={view !== 'labs'}><MemoryPanel />{view === 'labs' && <details className="legacy-tools"><summary>Additional manual algorithm tools (earlier dashboard)</summary><div className="lab-banner">SEPARATE MANUAL TOOLS · These operations do not alter the integrated scenario.</div><Laboratories /></details>}</div><footer className="workbench-footer">Mini OS Dashboard · Educational simulation · Integrated times are logical ticks; memory addresses are bytes; concurrency traces use operation steps.</footer></>
}
