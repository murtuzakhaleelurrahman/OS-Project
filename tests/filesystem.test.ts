import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { allocateFile, allocationModes, canonicalPath, type AllocationMode } from '../src/simulation/filesystem/Allocation'
import { FileSystem, fileSystemConfiguration, fragmentationDemo, type FsCommand } from '../src/simulation/filesystem/FileSystem'
import { integratedDiskPolicies } from '../src/simulation/integrated/DiskPolicy'

const create = (path: string, content: string, allocation: AllocationMode = 'CONTIGUOUS'): FsCommand => ({ kind: 'create', path, content, allocation })
const execute = (lab: FileSystem, command: FsCommand) => { lab.submit(command); lab.runAll(); return lab.snapshot().jobs.at(-1)! }
const bytes = (value: string) => [...new TextEncoder().encode(value)]

function assertStorage(lab: FileSystem, expected?: Map<string, string>): void {
  const snapshot = lab.snapshot()
  expect(snapshot.used + snapshot.reserved + snapshot.free).toBe(snapshot.configuration.blocks)
  expect(snapshot.used).toBe(snapshot.blocks.filter((block) => block.owner !== undefined).length)
  expect(snapshot.reserved).toBe(snapshot.blocks.filter((block) => block.reservedBy !== undefined).length)
  const owned = new Set<number>()
  for (const node of snapshot.nodes) {
    const ids = node.kind === 'directory' ? [node.block] : [...node.data, ...(node.index === undefined ? [] : [node.index])]
    for (const id of ids) { expect(owned.has(id)).toBe(false); owned.add(id); expect(snapshot.blocks[id].owner).toBe(node.path) }
    if (node.kind === 'file') {
      const actual = node.data.flatMap((id) => snapshot.blocks[id].bytes)
      expect(actual.length).toBe(node.size)
      if (expected) expect(actual).toEqual(bytes(expected.get(node.path)!))
      if (node.allocation === 'CONTIGUOUS') node.data.forEach((id, index) => expect(id).toBe(node.data[0] + index))
      if (node.allocation === 'LINKED') node.data.forEach((id, index) => expect(snapshot.blocks[id].next).toBe(node.data[index + 1]))
      if (node.index !== undefined) expect(snapshot.blocks[node.index].pointers).toEqual(node.data)
    }
  }
  expect(owned.size).toBe(snapshot.used)
  expect(snapshot.blocks.every((block) => block.reservedBy === undefined || block.owner === undefined)).toBe(true)
  expect(snapshot.jobs.filter((job) => job.status === 'RUNNING').length).toBeLessThanOrEqual(1)
  const scheduled = snapshot.requests.filter((request) => request.start !== undefined)
  let previous = snapshot.configuration.initialHead
  for (const [index, request] of scheduled.entries()) {
    if (index) expect(request.start).toBeGreaterThanOrEqual(scheduled[index - 1].completion!)
    let distance = 0
    for (const waypoint of request.path!) { distance += Math.abs(waypoint - previous); previous = waypoint }
    expect(request.movement).toBe(distance)
    expect(request.service).toBe(Math.max(1, snapshot.configuration.baseService + snapshot.configuration.seekCost * distance))
    expect(request.completion! - request.start!).toBe(request.service)
  }
  expect(snapshot.movement).toBe(snapshot.requests.filter((request) => request.done).reduce((sum, request) => sum + request.movement!, 0))
  expect(snapshot.time).toBe(snapshot.requests.filter((request) => request.done).reduce((sum, request) => sum + request.service!, 0))
}

describe('filesystem allocation and paths', () => {
  it('uses first-fit contiguous ranges, linked payload cost and a dedicated index block', () => {
    const free = [false, true, true, false, true, true, true]
    expect(allocateFile(free, 128, 'CONTIGUOUS', 64).data).toEqual([1, 2])
    expect(allocateFile(free, 128, 'LINKED', 64).data).toEqual([1, 2, 4])
    expect(allocateFile(free, 128, 'INDEXED', 64)).toMatchObject({ data: [2, 4], index: 1 })
    expect(free).toEqual([false, true, true, false, true, true, true])
  })
  it('rejects fragmentation, insufficient space, index overflow and invalid input', () => {
    expect(() => allocateFile([true, false, true], 128, 'CONTIGUOUS', 64)).toThrow('fragmented')
    expect(() => allocateFile([true], 128, 'LINKED', 64)).toThrow('Not enough')
    expect(() => allocateFile(Array(128).fill(true), 1025, 'INDEXED', 64)).toThrow('16 data pointers')
    expect(() => allocateFile([true], -1, 'CONTIGUOUS', 64)).toThrow()
    expect(() => allocateFile([true], 1, 'INVALID' as AllocationMode, 64)).toThrow()
    expect(() => allocateFile([true], 1, 'LINKED', 4)).toThrow()
    for (const mode of allocationModes) expect(allocateFile([], 0, mode, 64)).toMatchObject({ data: [], index: undefined })
  })
  it('requires canonical absolute paths', () => {
    for (const path of ['/', '/docs/a.txt', '/constructor']) expect(canonicalPath(path)).toBe(path)
    for (const path of [null, '', 'notes.txt', '/a/', '/a//b', '/a/../b', '/.', '/a b', '/a\\b', '/' + 'x'.repeat(33), '/' + Array(9).fill('a').join('/'), '/' + 'x'.repeat(257)]) expect(() => canonicalPath(path)).toThrow()
  })
})

describe('disk-backed filesystem transactions', () => {
  it.each(allocationModes)('%s: reserves first, commits after I/O and returns exact UTF-8', (mode) => {
    const lab = new FileSystem()
    const text = 'a'.repeat(63) + '🙂 café\n'.repeat(8)
    lab.submit(create('/hello.txt', text, mode))
    expect(lab.snapshot().nodes).toHaveLength(1)
    expect(lab.snapshot().reserved).toBeGreaterThan(0)
    lab.next(); expect(lab.snapshot().time).toBe(0); expect(lab.snapshot().active?.completion).toBeGreaterThan(0)
    while (lab.snapshot().pending) {
      if (lab.snapshot().jobs[0].status !== 'COMPLETE') expect(lab.snapshot().nodes).toHaveLength(1)
      assertStorage(lab); lab.next()
    }
    expect(lab.snapshot().reserved).toBe(0)
    const id = lab.submit({ kind: 'read', path: '/hello.txt' })
    expect(lab.snapshot().jobs.find((job) => job.id === id)?.resultText).toBeUndefined()
    lab.runAll()
    expect(lab.snapshot().jobs.at(-1)?.resultText).toBe(text)
    assertStorage(lab, new Map([['/hello.txt', text]]))
  })
  it.each(allocationModes)('%s: empty files need no data/index blocks but still do metadata I/O', (mode) => {
    const lab = new FileSystem()
    execute(lab, create('/empty', '', mode))
    expect(lab.snapshot().used).toBe(1)
    expect(execute(lab, { kind: 'read', path: '/empty' })).toMatchObject({ status: 'COMPLETE', resultText: '', resultBytes: [] })
    expect(execute(lab, { kind: 'read', path: '/empty', logicalBlock: 0 }).status).toBe('ERROR')
    expect(execute(lab, { kind: 'unlink', path: '/empty' }).status).toBe('COMPLETE')
  })
  it('queued mkdir/create/read operations see earlier committed transactions', () => {
    const lab = new FileSystem()
    lab.submit({ kind: 'mkdir', path: '/docs' }); lab.submit(create('/docs/notes', 'hello', 'INDEXED')); lab.submit({ kind: 'read', path: '/docs/notes' })
    expect(lab.snapshot().jobs.map((job) => job.status)).toEqual(['RUNNING', 'QUEUED', 'QUEUED'])
    lab.runAll()
    expect(lab.snapshot().jobs.every((job) => job.status === 'COMPLETE')).toBe(true)
    expect(lab.snapshot().jobs[2].resultText).toBe('hello')
    expect(execute(lab, { kind: 'rmdir', path: '/docs' }).error).toContain('not empty')
    execute(lab, { kind: 'unlink', path: '/docs/notes' }); execute(lab, { kind: 'rmdir', path: '/docs' })
    expect(lab.snapshot().used).toBe(1); assertStorage(lab)
  })
  it.each(allocationModes)('%s: copy-on-write retains old bytes until commit and deletion frees all blocks', (mode) => {
    const lab = new FileSystem(); execute(lab, create('/a', 'old'.repeat(25), mode))
    const before = lab.snapshot(), old = before.nodes.find((node) => node.path === '/a')!
    lab.submit({ kind: 'write', path: '/a', content: 'NEW'.repeat(50) })
    expect(lab.snapshot().nodes.find((node) => node.path === '/a')).toEqual(old)
    while (lab.snapshot().pending) {
      expect(lab.snapshot().nodes.find((node) => node.path === '/a')).toEqual(old)
      lab.next()
    }
    expect(execute(lab, { kind: 'read', path: '/a' }).resultText).toBe('NEW'.repeat(50))
    expect(execute(lab, { kind: 'unlink', path: '/a' }).status).toBe('COMPLETE')
    expect(lab.snapshot()).toMatchObject({ used: 1, reserved: 0, free: 31 }); assertStorage(lab)
  })
  it('a full disk rejects an overwrite atomically and preserves the old content', () => {
    const lab = new FileSystem({ ...fileSystemConfiguration, blocks: 8 })
    execute(lab, create('/full', 'a'.repeat(448)))
    const before = lab.snapshot()
    expect(execute(lab, { kind: 'write', path: '/full', content: 'x' }).status).toBe('ERROR')
    expect(lab.snapshot().nodes).toEqual(before.nodes); expect(lab.snapshot().blocks).toEqual(before.blocks)
    expect(execute(lab, { kind: 'read', path: '/full' }).resultText).toBe('a'.repeat(448))
  })
  it.each(allocationModes)('%s: fragmentation example distinguishes adjacent and scattered space', (mode) => {
    const lab = fragmentationDemo()
    expect(lab.snapshot()).toMatchObject({ free: 6, largestFreeRun: 3 })
    const result = execute(lab, create('/report', 'x'.repeat(256), mode))
    expect(result.status).toBe(mode === 'CONTIGUOUS' ? 'ERROR' : 'COMPLETE')
    if (mode === 'CONTIGUOUS') expect(result.error).toContain('fragmented')
    else expect(lab.snapshot().free).toBe(1)
    assertStorage(lab)
  })
  it.each(allocationModes)('%s: logical block 3 has the correct prerequisite reads', (mode) => {
    const lab = new FileSystem(); execute(lab, create('/random', 'x'.repeat(240), mode))
    const id = lab.submit({ kind: 'read', path: '/random', logicalBlock: 3 }); lab.runAll()
    const requests = lab.snapshot().requests.filter((request) => request.operation === id)
    expect(requests).toHaveLength(mode === 'LINKED' ? 5 : mode === 'INDEXED' ? 3 : 2)
    expect(lab.snapshot().jobs.at(-1)?.resultBytes?.length).toBe(mode === 'LINKED' ? 60 : 48)
    if (mode === 'LINKED' || mode === 'INDEXED') for (let index = 1; index < requests.length; index++) expect(requests[index].enqueued).toBeGreaterThanOrEqual(requests[index - 1].completion!)
  })
  it('moves whole directory subtrees without reallocating their blocks', () => {
    const lab = new FileSystem()
    execute(lab, { kind: 'mkdir', path: '/a' }); execute(lab, { kind: 'mkdir', path: '/a/b' }); execute(lab, create('/a/b/file', 'data', 'INDEXED'))
    const used = lab.snapshot().used
    expect(execute(lab, { kind: 'rename', path: '/a', to: '/moved' }).status).toBe('COMPLETE')
    expect(execute(lab, { kind: 'read', path: '/moved/b/file' }).resultText).toBe('data')
    expect(lab.snapshot().used).toBe(used)
    expect(lab.snapshot().blocks.some((block) => block.owner?.startsWith('/a'))).toBe(false)
    assertStorage(lab)
  })
  it('rejects invalid names, wrong node types, missing parents and rename collisions', () => {
    const lab = new FileSystem(); execute(lab, create('/a', 'old')); execute(lab, { kind: 'mkdir', path: '/dir' })
    const before = lab.snapshot()
    for (const command of [create('/a', 'duplicate'), create('/missing/a', 'x'), create('/a/child', 'x'), { kind: 'read', path: '/dir' }, { kind: 'unlink', path: '/dir' }, { kind: 'rmdir', path: '/a' }, { kind: 'rename', path: '/missing', to: '/new' }, { kind: 'rename', path: '/a', to: '/dir' }, { kind: 'rename', path: '/a', to: '/missing/new' }]) {
      expect(execute(lab, command as FsCommand).status).toBe('ERROR'); expect(lab.snapshot().nodes).toEqual(before.nodes); expect(lab.snapshot().blocks).toEqual(before.blocks)
    }
    for (const command of [null, {}, { kind: 'bogus', path: '/a' }, { kind: 'unlink', path: '/' }, { kind: 'rename', path: '/a', to: '/a/child' }, { kind: 'rename', path: '/a', to: '/' }, { kind: 'rename', path: '/a', to: '/a' }, { kind: 'create', path: '/b', content: 3, allocation: 'LINKED' }, { kind: 'create', path: '/b', content: 'x', allocation: 'bogus' }, { kind: 'read', path: '/a', logicalBlock: -1 }]) expect(() => lab.submit(command)).toThrow()
    expect(() => lab.submit(create('/huge', '🙂'.repeat(20000)))).toThrow('65536')
  })
  it('failed queued operations do not prevent later valid work', () => {
    const lab = new FileSystem()
    lab.submit(create('/a', 'first')); lab.submit(create('/a', 'duplicate')); lab.submit({ kind: 'read', path: '/a' }); lab.runAll()
    expect(lab.snapshot().jobs.map((job) => job.status)).toEqual(['COMPLETE', 'ERROR', 'COMPLETE'])
    expect(lab.snapshot().jobs.at(-1)?.resultText).toBe('first')
  })
  it('step and run-to-end match exactly, including queued dependencies and captured inputs', () => {
    const commands: FsCommand[] = [{ kind: 'mkdir', path: '/docs' }, create('/docs/a', 'α'.repeat(90), 'LINKED'), create('/index', 'b'.repeat(200), 'INDEXED'), { kind: 'write', path: '/docs/a', content: 'changed' }, { kind: 'read', path: '/docs/a' }, { kind: 'rename', path: '/docs', to: '/saved' }]
    const a = new FileSystem({ ...fileSystemConfiguration, algorithm: 'SCAN' }), b = new FileSystem(a.configuration)
    for (const command of commands) { a.submit(command); b.submit(command) }
    commands[0].path = '/mutated'
    a.runAll(); while (b.next()) { /* same handlers */ }
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.snapshot().nodes.some((node) => node.path === '/saved/a')).toBe(true)
    expect(a.snapshot().jobs[4].resultText).toBe('changed')
    expect(a.next()).toBe(false)
  })
  it('validates subtree depth before moving any directory', () => {
    const lab = new FileSystem()
    for (const path of ['/a', '/a/b', '/x', '/x/y', '/x/y/z', '/x/y/z/u', '/x/y/z/u/v', '/x/y/z/u/v/w', '/x/y/z/u/v/w/q']) execute(lab, { kind: 'mkdir', path })
    const before = lab.snapshot().nodes
    expect(execute(lab, { kind: 'rename', path: '/a', to: '/x/y/z/u/v/w/q/a' }).status).toBe('ERROR')
    expect(lab.snapshot().nodes).toEqual(before)
  })
  it('validates configuration, entry/operation limits, snapshots and a fresh reset', () => {
    for (const patch of [{ blocks: 1 }, { blockBytes: 8 }, { initialHead: 99 }, { baseService: -1 }, { seekCost: -1 }, { algorithm: 'BAD' }, { initialDirection: 'BAD' }]) expect(() => new FileSystem({ ...fileSystemConfiguration, ...patch } as typeof fileSystemConfiguration)).toThrow()
    const lab = new FileSystem(); lab.submit(create('/pending', 'data'))
    const snapshot = lab.snapshot(); snapshot.blocks[0].owner = 'corrupt'; snapshot.jobs[0].command.path = '/other'
    expect(lab.snapshot().blocks[0].owner).toBe('/'); expect(lab.snapshot().jobs[0].command.path).toBe('/pending')
    expect(new FileSystem().snapshot()).toMatchObject({ time: 0, used: 1, reserved: 0, free: 31, pending: 0 })
    const entries = new FileSystem()
    for (let index = 0; index < 128; index++) execute(entries, create(`/e${index}`, ''))
    expect(entries.snapshot().jobs.at(-1)?.error).toContain('128 entries')
    while (entries.snapshot().jobs.length < 256) execute(entries, { kind: 'read', path: '/e0' })
    expect(() => entries.submit({ kind: 'read', path: '/e0' })).toThrow('256 operations')
  })
})

describe('filesystem generated invariants', () => {
  for (const algorithm of integratedDiskPolicies) it(`${algorithm}: conserves allocations and matches a namespace oracle after every event`, () => {
    const script = fc.array(fc.record({ action: fc.constantFrom('create', 'write', 'read', 'unlink', 'rename'), file: fc.integer({ min: 0, max: 3 }), to: fc.integer({ min: 0, max: 3 }), content: fc.string({ maxLength: 60 }), allocation: fc.constantFrom(...allocationModes) }), { minLength: 1, maxLength: 12 })
    fc.assert(fc.property(script, (commands) => {
      const lab = new FileSystem({ ...fileSystemConfiguration, blocks: 12, algorithm, initialHead: 6, initialDirection: 'DOWN' })
      const expected = new Map<string, string>()
      for (const item of commands) {
        const path = `/p${item.file}`, to = `/p${item.to}`
        const command = item.action === 'create' ? create(path, item.content, item.allocation) : item.action === 'write' ? { kind: 'write', path, content: item.content } : item.action === 'rename' ? { kind: 'rename', path, to } : { kind: item.action, path }
        if (item.action === 'rename' && path === to) { expect(() => lab.submit(command)).toThrow(); continue }
        const before = lab.snapshot(); lab.submit(command)
        while (lab.snapshot().pending) { assertStorage(lab, expected); lab.next() }
        const result = lab.snapshot().jobs.at(-1)!
        if (result.status === 'COMPLETE') {
          if (item.action === 'create' || item.action === 'write') expected.set(path, item.content)
          else if (item.action === 'unlink') expected.delete(path)
          else if (item.action === 'rename') { expected.set(to, expected.get(path)!); expected.delete(path) }
          else expect(result.resultText).toBe(expected.get(path))
        } else { expect(lab.snapshot().nodes).toEqual(before.nodes); expect(lab.snapshot().blocks).toEqual(before.blocks) }
        expect(lab.snapshot().nodes.filter((node) => node.kind === 'file').map((node) => node.path).sort()).toEqual([...expected.keys()].sort())
        assertStorage(lab, expected)
      }
    }), { numRuns: 20, seed: 20261031 + integratedDiskPolicies.indexOf(algorithm) })
  }, 30_000)
})
