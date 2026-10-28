import { integer } from '../shared/validation'

export const allocationModes = ['CONTIGUOUS', 'LINKED', 'INDEXED'] as const
export type AllocationMode = (typeof allocationModes)[number]
export const pointerBytes = 4

export function allocateFile(free: readonly boolean[], size: number, mode: AllocationMode, blockBytes: number) {
  integer(size, 'File bytes', 0, 65536); integer(blockBytes, 'Block bytes', 16, 4096)
  if (!allocationModes.includes(mode)) throw new Error('Unknown file allocation method')
  const payload = blockBytes - (mode === 'LINKED' ? pointerBytes : 0)
  const count = Math.ceil(size / payload)
  if (mode === 'INDEXED' && count > Math.floor(blockBytes / pointerBytes)) throw new Error(`One index block holds at most ${Math.floor(blockBytes / pointerBytes)} data pointers`)
  const available = free.flatMap((value, index) => value ? [index] : [])
  const needed = count + (mode === 'INDEXED' && count ? 1 : 0)
  if (available.length < needed) throw new Error(`Not enough free blocks: need ${needed}, have ${available.length}`)
  if (!count) return { data: [] as number[], index: undefined, payload }
  if (mode === 'CONTIGUOUS') {
    let run = 0
    for (let index = 0; index < free.length; index++) {
      run = free[index] ? run + 1 : 0
      if (run === count) return { data: Array.from({ length: count }, (_, offset) => index - count + 1 + offset), index: undefined, payload }
    }
    throw new Error(`Contiguous allocation needs ${count} adjacent free blocks; the disk is fragmented`)
  }
  const index = mode === 'INDEXED' ? available.shift() : undefined
  return { data: available.slice(0, count), index, payload }
}

export function canonicalPath(input: unknown): string {
  if (typeof input !== 'string' || input.length > 256 || !input.startsWith('/')) throw new Error('Use an absolute path of at most 256 characters')
  if (input === '/') return input
  const parts = input.slice(1).split('/')
  if (parts.length > 8 || parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(part) || part === '.' || part === '..')) throw new Error('Use 1–8 path segments, each 1–32 letters, digits, dots, underscores or hyphens; no empty, dot or parent segments')
  return input
}
export const parentPath = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
