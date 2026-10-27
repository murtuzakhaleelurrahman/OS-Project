import type { IntegratedSnapshot } from '../simulation/integrated/IntegratedEngine'
import type { Scenario } from '../simulation/integrated/Scenario'

export function DiskPathChart({ scenario, snapshot }: { scenario: Scenario; snapshot: IntegratedSnapshot }) {
  const route = [scenario.disk.initialHead]
  for (const request of snapshot.disk.requests.filter((item) => item.completion !== undefined)
    .sort((a, b) => a.completion! - b.completion! || a.id - b.id)) route.push(...(request.path ?? [request.cylinder]))
  const offset = Math.max(0, route.length - 200)
  const visible = route.slice(offset)
  const x = (index: number) => 48 + index / Math.max(1, visible.length - 1) * 680
  const y = (cylinder: number) => 168 - cylinder / (scenario.disk.cylinders - 1) * 140
  return <div className="disk-path-chart">
    <h3>Disk head path</h3>
    <p className="integrated-hint">Completed service routes only. Horizontal axis: route waypoint, not time. Endpoint and circular-wrap travel count in movement and service cost.{offset > 0 && ' Showing the latest 200 waypoints.'}</p>
    <svg viewBox="0 0 760 210" role="img" aria-label="Disk head cylinder path across completed route waypoints" style={{ width: '100%', minWidth: 280, maxHeight: 280 }}>
      <line x1="48" x2="728" y1="168" y2="168" stroke="#8a9683" />
      <line x1="48" x2="48" y1="28" y2="168" stroke="#8a9683" />
      <text x="5" y="34" fontSize="11" fill="#58685e">{scenario.disk.cylinders - 1}</text>
      <text x="28" y="172" fontSize="11" fill="#58685e">0</text>
      <polyline points={visible.map((cylinder, index) => `${x(index)},${y(cylinder)}`).join(' ')} fill="none" stroke="#a84c31" strokeWidth="2" />
      {visible.map((cylinder, index) => <circle key={index} cx={x(index)} cy={y(cylinder)} r="3" fill="#315d49"><title>Waypoint {offset + index}: cylinder {cylinder}</title></circle>)}
      <text x="48" y="194" fontSize="11" fill="#58685e">Waypoint {offset}</text>
      <text x="660" y="194" fontSize="11" fill="#58685e">{offset + visible.length - 1}</text>
    </svg>
  </div>
}
