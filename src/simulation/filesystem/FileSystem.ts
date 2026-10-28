import { chooseDiskRequest, integratedDiskPolicies, type DiskDirection, type IntegratedDiskPolicy } from '../integrated/DiskPolicy'
import { integer } from '../shared/validation'
import { allocateFile, allocationModes, canonicalPath, parentPath, type AllocationMode } from './Allocation'

export interface FileSystemConfiguration {
  readonly blocks: number; readonly blockBytes: number; readonly algorithm: IntegratedDiskPolicy
  readonly initialHead: number; readonly initialDirection: DiskDirection; readonly baseService: number; readonly seekCost: number
}
export const fileSystemConfiguration: FileSystemConfiguration = { blocks: 32, blockBytes: 64, algorithm: 'FCFS', initialHead: 0, initialDirection: 'UP', baseService: 1, seekCost: 1 }
export type FsCommand =
  | { kind: 'mkdir'; path: string }
  | { kind: 'unlink'; path: string }
  | { kind: 'rmdir'; path: string }
  | { kind: 'create'; path: string; content: string; allocation: AllocationMode }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'read'; path: string; logicalBlock?: number }
  | { kind: 'rename'; path: string; to: string }
export interface FileNode { kind: 'file'; path: string; allocation: AllocationMode; size: number; data: number[]; index?: number }
export interface DirectoryNode { kind: 'directory'; path: string; block: number }
export type FsNode = FileNode | DirectoryNode
export interface FsBlock { id: number; owner?: string; role?: 'directory' | 'data' | 'index'; bytes: number[]; next?: number; pointers?: number[] }
export interface FsOperation { id: number; command: FsCommand; status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'ERROR'; submitted: number; started?: number; completed?: number; error?: string; resultText?: string; resultBytes?: number[] }
export interface FsRequest {
  id: number; operation: number; cylinder: number; label: string; access: 'READ' | 'WRITE'; enqueued: number
  start?: number; completion?: number; path?: number[]; movement?: number; service?: number; done: boolean
}
interface IoPhase { label: string; blocks: number[]; access: 'READ' | 'WRITE'; sequential?: boolean }
interface Plan { phases: IoPhase[]; reserved: number[]; commit: () => void }

function parseCommand(input: unknown): FsCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('File command must be an object')
  const value = input as Record<string, unknown>
  const path = canonicalPath(value.path)
  if (!['mkdir', 'create', 'write', 'read', 'unlink', 'rmdir', 'rename'].includes(value.kind as string)) throw new Error('Unknown filesystem operation')
  if (path === '/') throw new Error('The root directory is reserved; choose a file or child directory')
  const kind = value.kind as FsCommand['kind']
  if (kind === 'create' || kind === 'write') {
    if (typeof value.content !== 'string' || value.content.length > 65536 || new TextEncoder().encode(value.content).length > 65536) throw new Error('File content is limited to 65536 UTF-8 bytes')
    if (kind === 'write') return { kind, path, content: value.content }
    if (!allocationModes.includes(value.allocation as AllocationMode)) throw new Error('Unknown file allocation method')
    return { kind, path, content: value.content, allocation: value.allocation as AllocationMode }
  }
  if (kind === 'rename') {
    const to = canonicalPath(value.to)
    if (to === '/' || to === path || to.startsWith(path + '/')) throw new Error('Cannot move a path onto itself, the root or its own descendants')
    return { kind, path, to }
  }
  if (kind === 'read') return { kind, path, ...(value.logicalBlock === undefined ? {} : { logicalBlock: integer(value.logicalBlock, 'Logical data block', 0, 127) }) }
  return { kind, path }
}

/** A serialized transaction lab using the integrated disk-policy selector and service formula. */
export class FileSystem {
  readonly configuration: FileSystemConfiguration
  private nodes = new Map<string, FsNode>()
  private blocks: FsBlock[]
  private reserved = new Map<number, number>()
  private jobs: FsOperation[] = []
  private requests: FsRequest[] = []
  private current: { operation: FsOperation; plan: Plan; phase: number; cursor: number } | undefined
  private active: FsRequest | undefined
  private time = 0
  private head: number
  private direction: DiskDirection
  private movement = 0
  constructor(configuration: FileSystemConfiguration = fileSystemConfiguration) {
    integer(configuration.blocks, 'Disk blocks', 8, 128); integer(configuration.blockBytes, 'Block bytes', 16, 4096)
    integer(configuration.initialHead, 'Initial head', 0, configuration.blocks - 1)
    integer(configuration.baseService, 'Base service', 0, 100); integer(configuration.seekCost, 'Seek cost', 0, 100)
    if (!integratedDiskPolicies.includes(configuration.algorithm) || !['UP', 'DOWN'].includes(configuration.initialDirection)) throw new Error('Invalid disk policy or direction')
    this.configuration = Object.freeze({ ...configuration }); this.head = configuration.initialHead; this.direction = configuration.initialDirection
    this.blocks = Array.from({ length: configuration.blocks }, (_, id) => ({ id, bytes: [] }))
    this.blocks[0] = { id: 0, owner: '/', role: 'directory', bytes: [] }
    this.nodes.set('/', { kind: 'directory', path: '/', block: 0 })
  }
  submit(input: unknown): number {
    if (this.jobs.length >= 256) throw new Error('This experiment is limited to 256 operations; reset to start another')
    const command = parseCommand(input)
    const operation: FsOperation = { id: this.jobs.length + 1, command, status: 'QUEUED', submitted: this.time }
    this.jobs.push(operation)
    this.startNext()
    return operation.id
  }
  private directory(path: string): DirectoryNode {
    const node = this.nodes.get(path)
    if (!node || node.kind !== 'directory') throw new Error(`Directory not found: ${path}`)
    return node
  }
  private file(path: string): FileNode {
    const node = this.nodes.get(path)
    if (!node || node.kind !== 'file') throw new Error(`File not found: ${path}`)
    return node
  }
  private lookup(path: string): number[] {
    const parents: string[] = ['/']
    const parts = path.slice(1).split('/')
    for (let index = 1; index < parts.length; index++) parents.push('/' + parts.slice(0, index).join('/'))
    return parents.map((parent) => this.directory(parent).block)
  }
  private fileBlocks(file: FileNode): number[] { return [...file.data, ...(file.index === undefined ? [] : [file.index])] }
  private dataOrder(file: FileNode): number[] {
    if (file.allocation === 'INDEXED') return file.index === undefined ? [] : [...this.blocks[file.index].pointers!]
    if (file.allocation === 'CONTIGUOUS') return file.data.map((_, offset) => file.data[0] + offset)
    const result: number[] = []
    let next = file.data[0] as number | undefined
    while (next !== undefined) {
      if (result.includes(next) || result.length >= this.configuration.blocks) throw new Error('Corrupt linked allocation chain')
      result.push(next); next = this.blocks[next].next
    }
    return result
  }
  private freeBlocks(ids: number[]): void { ids.forEach((id) => { this.blocks[id] = { id, bytes: [] } }) }
  private plan(operation: FsOperation): Plan {
    const command = operation.command, path = command.path
    const parent = this.directory(parentPath(path))
    const lookup: IoPhase = { label: 'Directory lookup', blocks: this.lookup(path), access: 'READ', sequential: true }
    const commitPhase: IoPhase = { label: 'Commit directory metadata', blocks: [parent.block], access: 'WRITE' }
    const free = this.blocks.map((block) => block.owner === undefined && !this.reserved.has(block.id))
    const phases: IoPhase[] = [lookup]
    let reserved: number[] = []
    let commit: () => void
    if (command.kind === 'mkdir' || command.kind === 'create') {
      if (this.nodes.has(path)) throw new Error(`Path already exists: ${path}`)
      if (this.nodes.size >= 128) throw new Error('The filesystem supports at most 128 entries including root')
    }
    if (command.kind === 'mkdir') {
      const block = free.indexOf(true)
      if (block < 0) throw new Error('No free block for directory metadata')
      reserved = [block]; phases.push({ label: 'Initialize directory', blocks: [block], access: 'WRITE' }, commitPhase)
      commit = () => { this.blocks[block] = { id: block, owner: path, role: 'directory', bytes: [] }; this.nodes.set(path, { kind: 'directory', path, block }) }
    } else if (command.kind === 'create' || command.kind === 'write') {
      const old = command.kind === 'write' ? this.file(path) : undefined
      const allocation = command.kind === 'create' ? command.allocation : old!.allocation
      const bytes = [...new TextEncoder().encode(command.content)]
      const layout = allocateFile(free, bytes.length, allocation, this.configuration.blockBytes)
      reserved = [...layout.data, ...(layout.index === undefined ? [] : [layout.index])]
      if (layout.index !== undefined) phases.push({ label: 'Write index block', blocks: [layout.index], access: 'WRITE' })
      phases.push({ label: 'Write data blocks', blocks: layout.data, access: 'WRITE' }, commitPhase)
      commit = () => {
        if (old) this.freeBlocks(this.fileBlocks(old))
        layout.data.forEach((id, index) => { this.blocks[id] = { id, owner: path, role: 'data', bytes: bytes.slice(index * layout.payload, (index + 1) * layout.payload), ...(allocation === 'LINKED' && index + 1 < layout.data.length ? { next: layout.data[index + 1] } : {}) } })
        if (layout.index !== undefined) this.blocks[layout.index] = { id: layout.index, owner: path, role: 'index', bytes: [], pointers: [...layout.data] }
        this.nodes.set(path, { kind: 'file', path, allocation, size: bytes.length, data: [...layout.data], ...(layout.index === undefined ? {} : { index: layout.index }) })
      }
    } else if (command.kind === 'read') {
      const file = this.file(path), logical = command.logicalBlock
      if (logical !== undefined && logical >= file.data.length) throw new Error('Logical block is outside the file')
      if (file.index !== undefined) phases.push({ label: 'Read index block', blocks: [file.index], access: 'READ' })
      const ordered = this.dataOrder(file)
      const data = logical === undefined ? ordered : file.allocation === 'LINKED' ? ordered.slice(0, logical + 1) : [ordered[logical]]
      phases.push({ label: file.allocation === 'LINKED' ? 'Follow data links' : 'Read data blocks', blocks: data, access: 'READ', sequential: file.allocation === 'LINKED' })
      commit = () => {
        const selected = logical === undefined ? ordered : [ordered[logical]]
        operation.resultBytes = selected.flatMap((id) => this.blocks[id].bytes)
        if (logical === undefined) operation.resultText = new TextDecoder().decode(new Uint8Array(operation.resultBytes))
      }
    } else if (command.kind === 'unlink' || command.kind === 'rmdir') {
      const node = this.nodes.get(path)
      if (!node || (command.kind === 'unlink' ? node.kind !== 'file' : node.kind !== 'directory')) throw new Error(`${command.kind === 'unlink' ? 'File' : 'Directory'} not found: ${path}`)
      if (node.kind === 'directory') {
        if ([...this.nodes.keys()].some((key) => key.startsWith(path + '/'))) throw new Error('Directory is not empty')
        phases.push({ label: 'Inspect directory', blocks: [node.block], access: 'READ' })
      } else if (node.allocation === 'LINKED') phases.push({ label: 'Traverse links for deletion', blocks: this.dataOrder(node), access: 'READ', sequential: true })
      else if (node.index !== undefined) phases.push({ label: 'Read index for deletion', blocks: [node.index], access: 'READ' })
      phases.push(commitPhase)
      commit = () => { this.freeBlocks(node.kind === 'directory' ? [node.block] : this.fileBlocks(node)); this.nodes.delete(path) }
    } else {
      const node = this.nodes.get(path)
      if (!node) throw new Error(`Path not found: ${path}`)
      const targetParent = this.directory(parentPath(command.to))
      if (this.nodes.has(command.to)) throw new Error('Destination already exists')
      // Moving a directory can also deepen its children: validate every resulting path first.
      const moved = [...this.nodes.values()].filter((entry) => entry.path === path || entry.path.startsWith(path + '/'))
      const paths = moved.map((entry) => canonicalPath(command.to + entry.path.slice(path.length)))
      phases.push({ label: 'Destination lookup', blocks: this.lookup(command.to), access: 'READ', sequential: true }, { ...commitPhase, blocks: [...new Set([parent.block, targetParent.block])] })
      commit = () => {
        moved.forEach((entry, index) => { this.nodes.delete(entry.path); entry.path = paths[index]; this.nodes.set(entry.path, entry) })
        this.blocks.forEach((block) => { if (block.owner === path || block.owner?.startsWith(path + '/')) block.owner = command.to + block.owner.slice(path.length) })
      }
    }
    return { phases: phases.filter((phase) => phase.blocks.length), reserved, commit }
  }
  private startNext(): void {
    if (this.current) return
    for (const operation of this.jobs.filter((job) => job.status === 'QUEUED')) {
      operation.started = this.time
      try {
        const plan = this.plan(operation)
        operation.status = 'RUNNING'; plan.reserved.forEach((id) => this.reserved.set(id, operation.id))
        this.current = { operation, plan, phase: 0, cursor: 0 }; this.enqueuePhase(); return
      } catch (failure) { operation.status = 'ERROR'; operation.completed = this.time; operation.error = failure instanceof Error ? failure.message : 'Operation failed' }
    }
  }
  private enqueuePhase(): void {
    const current = this.current!, phase = current.plan.phases[current.phase]
    const ids = phase.sequential ? phase.blocks.slice(current.cursor, current.cursor + 1) : phase.blocks
    ids.forEach((cylinder) => this.requests.push({ id: this.requests.length + 1, operation: current.operation.id, cylinder, label: phase.label, access: phase.access, enqueued: this.time, done: false }))
  }
  next(): boolean {
    if (!this.current) return false
    if (!this.active) {
      const pending = this.requests.filter((request) => !request.done && request.start === undefined)
      const selected = chooseDiskRequest(pending, this.head, this.direction, this.configuration.algorithm, this.configuration.blocks)!
      const request = selected.request
      request.path = selected.path; request.movement = selected.distance
      request.start = this.time; request.service = Math.max(1, this.configuration.baseService + this.configuration.seekCost * selected.distance)
      request.completion = this.time + request.service; this.direction = selected.direction; this.active = request
      return true
    }
    const request = this.active
    this.time = request.completion!; this.head = request.cylinder; this.movement += request.movement!; request.done = true; this.active = undefined
    const current = this.current, phase = current.plan.phases[current.phase]
    if (phase.sequential && ++current.cursor < phase.blocks.length) this.enqueuePhase()
    else if (!this.requests.some((candidate) => candidate.operation === current.operation.id && !candidate.done)) {
      current.phase++; current.cursor = 0
      if (current.phase < current.plan.phases.length) this.enqueuePhase()
      else {
        current.plan.commit(); current.plan.reserved.forEach((id) => this.reserved.delete(id))
        current.operation.status = 'COMPLETE'; current.operation.completed = this.time; this.current = undefined; this.startNext()
      }
    }
    return true
  }
  runAll(): void { while (this.next()) { /* one serialized transaction and one disk at a time */ } }
  snapshot() {
    const used = this.blocks.filter((block) => block.owner !== undefined).length
    const free = this.blocks.map((block) => block.owner === undefined && !this.reserved.has(block.id))
    let largest = 0, run = 0
    free.forEach((value) => { run = value ? run + 1 : 0; largest = Math.max(largest, run) })
    return structuredClone({ configuration: this.configuration, time: this.time, head: this.head, direction: this.direction, movement: this.movement,
      used, reserved: this.reserved.size, free: free.filter(Boolean).length, largestFreeRun: largest,
      nodes: [...this.nodes.values()].sort((a, b) => a.path.localeCompare(b.path)),
      blocks: this.blocks.map((block) => ({ ...block, reservedBy: this.reserved.get(block.id) })), jobs: this.jobs, requests: this.requests,
      active: this.active, phase: this.current?.plan.phases[this.current.phase].label, pending: this.jobs.filter((job) => job.status === 'QUEUED' || job.status === 'RUNNING').length })
  }
}

export function fragmentationDemo(configuration: FileSystemConfiguration = fileSystemConfiguration): FileSystem {
  const lab = new FileSystem({ ...configuration, blocks: 12, blockBytes: 64, initialHead: Math.min(configuration.initialHead, 11) })
  for (const [name, size] of [['A', 192], ['B', 192], ['C', 192], ['D', 128]] as const) lab.submit({ kind: 'create', path: `/${name}.txt`, allocation: 'CONTIGUOUS', content: 'x'.repeat(size) })
  for (const name of ['A', 'C']) lab.submit({ kind: 'unlink', path: `/${name}.txt` })
  lab.runAll()
  return lab
}
