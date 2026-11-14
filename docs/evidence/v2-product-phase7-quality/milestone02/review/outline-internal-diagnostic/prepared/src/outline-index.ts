import type { Diagnostics } from './diagnostics'
import type { SdkDocumentScanHeading, SdkTemporaryStore } from '@milkup/plugin-sdk'

const pageBytes = 64 * 1024
const cachedPages = 24
const recordsPerPage = 128
const fanout = 32
const encoder = new TextEncoder()

/** One bounded cache shared by metadata, packed labels and visibility nodes. */
class Pages {
  private readonly cache = new Map<string, { value: unknown; dirty: boolean }>()
  constructor(private readonly store: SdkTemporaryStore, readonly diagnostics: Diagnostics) {}
  async get<T>(key: string): Promise<T> {
    const hit = this.cache.get(key)
    if (hit) {
      this.diagnostics.add('cache.hit')
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit.value as T
    }
    this.diagnostics.add('cache.miss')
    const json = await this.store.get(key)
    if (json === null) throw new Error('大纲索引页缺失，请重试全文扫描')
    await this.room()
    const value: unknown = JSON.parse(json)
    this.cache.set(key, { value, dirty: false })
    return value as T
  }
  async put(key: string, value: unknown): Promise<void> {
    this.diagnostics.add('cache.put')
    if (!this.cache.has(key)) await this.room()
    this.cache.delete(key)
    this.cache.set(key, { value, dirty: true })
  }
  async prefetch(keys: readonly string[]): Promise<void> {
    const missing = [...new Set(keys)].filter((key) => !this.cache.has(key))
    this.diagnostics.add('cache.prefetch.missing', missing.length)
    for (let start = 0; start < missing.length; start += 4) {
      const batch = missing.slice(start, start + 4)
      const values = await this.store.getMany(batch)
      for (let i = 0; i < batch.length; i++) {
        const json = values[i]
        if (json === null || json === undefined) throw new Error('大纲索引页缺失，请重试全文扫描')
        await this.room()
        this.cache.set(batch[i]!, { value: JSON.parse(json) as unknown, dirty: false })
      }
    }
  }
  async flush(): Promise<void> {
    const diagnosticEnd = this.diagnostics.start('pages.flush')
    try {
    let batch: { key: string; value: string }[] = []
    let entries: { value: unknown; dirty: boolean }[] = []
    let bytes = 0
    const send = async () => {
      if (!batch.length) return
      await this.store.setMany(batch)
      for (const entry of entries) entry.dirty = false
      batch = []
      entries = []
      bytes = 0
    }
    for (const [key, entry] of this.cache) {
      if (!entry.dirty) continue
      const diagnosticSerialization = performance.now()
      const value = JSON.stringify(entry.value)
      const size = encoder.encode(value).length
      this.diagnostics.duration('flush.serializeEncode', performance.now() - diagnosticSerialization)
      this.diagnostics.add('flush.pages.' + (key.startsWith('m-') ? 'metadata' : key.startsWith('t-') ? 'title' : 'visibility'))
      this.diagnostics.add('flush.utf8', size)
      if (size > pageBytes) throw new Error('大纲索引页超过 64 KiB 上限')
      if (bytes + size > 256 * 1024 || batch.length === 32) await send()
      batch.push({ key, value })
      entries.push(entry)
      bytes += size
    }
    await send()
    } finally { diagnosticEnd() }
  }
  private async room(): Promise<void> {
    if (this.cache.size < cachedPages) return
    this.diagnostics.add('cache.eviction.round')
    await this.flush()
    for (let i = 0; i < 8; i++) this.cache.delete(this.cache.keys().next().value!)
  }
}

// Labels are separate so an exceptional 4096-character label does not dictate
// the metadata page size for every ordinary heading in the document.
class Labels {
  private page = -1
  private values: string[] = []
  private bytes = 2
  constructor(private readonly pages: Pages) {}
  async append(value: string): Promise<readonly [number, number]> {
    const size = encoder.encode(JSON.stringify(value)).length
    if (size + 2 > pageBytes) throw new Error('大纲标题超过页预算')
    if (this.page < 0 || this.values.length >= 256 || this.bytes + size + 1 > pageBytes) {
      this.page++
      this.values = []
      this.bytes = 2
    }
    const slot = this.values.length
    this.values.push(value)
    this.bytes += size + (slot ? 1 : 0)
    await this.pages.put(`t-${this.page}`, this.values)
    return [this.page, slot]
  }
  async get(page: number, slot: number): Promise<string> {
    const value = (await this.pages.get<string[]>(`t-${page}`))[slot]
    if (value === undefined) throw new Error('大纲标题记录缺失')
    return value
  }
}

interface Summary {
  count: number
  depth: number
  depthCount: number
  minimum: number
  minimumCount: number
  lastLine: number
}
interface Child extends Summary {
  add: number
}
interface Node extends Summary {
  epoch: number
  children?: Child[]
  depths?: number[]
  lines?: number[]
  covers?: number[]
}
const empty = (epoch: number, level: number): Node => ({
  count: 0,
  depth: 6,
  depthCount: 0,
  minimum: 6,
  minimumCount: 0,
  lastLine: 0,
  epoch,
  ...(level ? { children: [] } : { depths: [], lines: [], covers: [] }),
})
const capacity = (level: number) => recordsPerPage * fanout ** level
const key = (level: number, index: number) => `v-${level}-${index}`
const summary = (node: Summary): Child => ({
  count: node.count,
  depth: node.depth,
  depthCount: node.depthCount,
  minimum: node.minimum,
  minimumCount: node.minimumCount,
  lastLine: node.lastLine,
  add: 0,
})
const visible = (node: Summary, carry = 0) => (node.minimum + carry === 0 ? node.minimumCount : 0)

/** Paged range-add/min-count tree; epoch reset selects expanded or depth-based cover. */
class Visibility {
  private root: Node = empty(1, 0)
  private level = 0
  epoch = 1
  collapsed = false
  constructor(private readonly pages: Pages) {}
  get count(): number {
    return this.root.count
  }
  get visibleCount(): number {
    this.current(this.root)
    return visible(this.root)
  }
  reset(collapsed: boolean): void {
    if (this.epoch >= Number.MAX_SAFE_INTEGER) throw new Error('大纲折叠版本已耗尽，请重试')
    this.epoch++
    this.collapsed = collapsed
    this.current(this.root)
  }
  private current(node: Node): Node {
    if (node.epoch === this.epoch) return node
    node.epoch = this.epoch
    if (node.children) {
      for (const child of node.children) {
        child.minimum = this.collapsed ? child.depth : 0
        child.minimumCount = this.collapsed ? child.depthCount : child.count
        child.add = 0
      }
    } else node.covers = node.depths!.map((depth) => (this.collapsed ? depth : 0))
    this.refresh(node)
    return node
  }
  private async node(level: number, index: number): Promise<Node> {
    return this.current(await this.pages.get<Node>(key(level, index)))
  }
  private refresh(node: Node): void {
    const parts: readonly Summary[] =
      node.children ??
      node.depths!.map((depth, i) => ({
        count: 1,
        depth,
        depthCount: 1,
        minimum: node.covers![i]!,
        minimumCount: 1,
        lastLine: node.lines![i]!,
      }))
    node.count = 0
    node.depth = 6
    node.depthCount = 0
    node.minimum = Infinity
    node.minimumCount = 0
    for (const part of parts) {
      node.count += part.count
      if (part.depth < node.depth) {
        node.depth = part.depth
        node.depthCount = 0
      }
      if (part.depth === node.depth) node.depthCount += part.depthCount
      if (part.minimum < node.minimum) {
        node.minimum = part.minimum
        node.minimumCount = 0
      }
      if (part.minimum === node.minimum) node.minimumCount += part.minimumCount
    }
    if (!node.count) node.minimum = 6
    node.lastLine = parts.at(-1)?.lastLine ?? 0
  }
  private apply(node: Node, delta: number): void {
    if (!delta) return
    if (node.children)
      for (const child of node.children) {
        child.minimum += delta
        child.add += delta
      }
    else node.covers = node.covers!.map((cover) => cover + delta)
    this.refresh(node)
  }
  async append(depth: number, line: number, cover: number): Promise<void> {
    this.current(this.root)
    if (this.count === capacity(this.level)) {
      if (!Number.isSafeInteger(capacity(this.level + 1)))
        throw new Error('大纲索引范围超过安全整数上限')
      await this.pages.put(key(this.level, 0), this.root)
      const root = empty(this.epoch, ++this.level)
      root.children!.push(summary(this.root))
      this.refresh(root)
      this.root = root
    }
    await this.appendTo(this.root, this.level, 0, this.count, depth, line, cover)
  }
  private async appendTo(
    node: Node,
    level: number,
    index: number,
    ordinal: number,
    depth: number,
    line: number,
    cover: number,
  ): Promise<void> {
    if (!level) {
      node.depths!.push(depth)
      node.lines!.push(line)
      node.covers!.push(cover)
    } else {
      const width = capacity(level - 1)
      const slot = Math.floor(ordinal / width) % fanout
      const childIndex = index * fanout + slot
      const prior = node.children![slot]
      const child = prior ? await this.node(level - 1, childIndex) : empty(this.epoch, level - 1)
      if (prior) this.apply(child, prior.add)
      await this.appendTo(child, level - 1, childIndex, ordinal, depth, line, cover)
      node.children![slot] = summary(child)
    }
    this.refresh(node)
    await this.pages.put(key(level, index), node)
  }
  async add(from: number, to: number, delta: number): Promise<void> {
    if (from >= to) return
    await this.addTo(this.current(this.root), this.level, 0, from, to, delta)
  }
  private async addTo(
    node: Node,
    level: number,
    index: number,
    from: number,
    to: number,
    delta: number,
  ): Promise<void> {
    const start = index * capacity(level)
    if (!level) {
      for (let i = Math.max(0, from - start); i < Math.min(node.count, to - start); i++)
        node.covers![i]! += delta
    } else {
      const width = capacity(level - 1)
      for (let slot = 0; slot < node.children!.length; slot++) {
        const entry = node.children![slot]!
        const childStart = start + slot * width
        if (to <= childStart || from >= childStart + entry.count) continue
        if (from <= childStart && to >= childStart + entry.count) {
          entry.minimum += delta
          entry.add += delta
        } else {
          const childIndex = index * fanout + slot
          const child = await this.node(level - 1, childIndex)
          this.apply(child, entry.add)
          await this.addTo(child, level - 1, childIndex, from, to, delta)
          node.children![slot] = summary(child)
        }
      }
    }
    this.refresh(node)
    await this.pages.put(key(level, index), node)
  }
  async selectRange(start: number, end: number): Promise<number[]> {
    const diagnosticEnd = this.pages.diagnostics.start('rows.selectRange')
    try {
    if (start < 0 || end > this.visibleCount || end - start > 16)
      throw new Error('大纲可见记录缺失')
    return await this.selectFrom(
      this.root,
      this.level,
      0,
      0,
      Array.from({ length: end - start }, (_, offset) => start + offset),
    )
    } finally { diagnosticEnd() }
  }
  private async selectFrom(
    node: Node,
    level: number,
    index: number,
    carry: number,
    ranks: number[],
  ): Promise<number[]> {
    if (!level) {
      const result: number[] = []
      let rank = 0
      for (let slot = 0; slot < node.count; slot++) {
        if (node.covers![slot]! + carry !== 0) continue
        if (rank++ === ranks[result.length]) result.push(index * recordsPerPage + slot)
      }
      if (result.length !== ranks.length) throw new Error('大纲可见序号不一致')
      return result
    }
    // At most sixteen requested rows; prefetch uses the existing four-page
    // batches and shared 24-page cache. No full-tree page directory is retained.
    const branches: { index: number; carry: number; ranks: number[] }[] = []
    let offset = 0
    for (const [slot, entry] of node.children!.entries()) {
      const count = visible(entry, carry)
      const selected = ranks.filter((rank) => rank >= offset && rank < offset + count)
      if (selected.length)
        branches.push({
          index: index * fanout + slot,
          carry: carry + entry.add,
          ranks: selected.map((rank) => rank - offset),
        })
      offset += count
    }
    await this.pages.prefetch(branches.map((branch) => key(level - 1, branch.index)))
    const result: number[] = []
    for (const branch of branches)
      result.push(
        ...(await this.selectFrom(
          await this.node(level - 1, branch.index),
          level - 1,
          branch.index,
          branch.carry,
          branch.ranks,
        )),
      )
    return result
  }
  async rank(ordinal: number): Promise<number> {
    const diagnosticEnd = this.pages.diagnostics.start('rows.rank')
    try {
    if (ordinal < 0 || ordinal >= this.count) return -1
    let node = this.current(this.root),
      level = this.level,
      index = 0,
      carry = 0,
      rank = 0
    while (level) {
      const slot = Math.floor(ordinal / capacity(level - 1)) % fanout
      for (let i = 0; i < slot; i++) rank += visible(node.children![i]!, carry)
      const entry = node.children![slot]!
      if (!visible(entry, carry)) return -1
      carry += entry.add
      index = index * fanout + slot
      node = await this.node(--level, index)
    }
    const slot = ordinal % recordsPerPage
    if (node.covers![slot]! + carry !== 0) return -1
    for (let i = 0; i < slot; i++) if (node.covers![i]! + carry === 0) rank++
    return rank
    } finally { diagnosticEnd() }
  }
  async atLine(line: number): Promise<number> {
    const diagnosticEnd = this.pages.diagnostics.start('rows.atLine')
    try {
    if (!this.count) return -1
    let node = this.current(this.root),
      level = this.level,
      index = 0
    while (level) {
      let slot = node.children!.findIndex((child) => child.lastLine >= line)
      if (slot < 0) slot = node.children!.length - 1
      index = index * fanout + slot
      node = await this.node(--level, index)
    }
    let low = 0,
      high = node.lines!.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (node.lines![middle]! <= line) low = middle + 1
      else high = middle
    }
    return index * recordsPerPage + low - 1
    } finally { diagnosticEnd() }
  }
}

// Compact fixed-width metadata, bounded to 128 records per page. No label text.
type RecordData = [
  from: number,
  line: number,
  level: number,
  parent: number,
  ancestors: number[],
  end: number,
  children: number,
  titlePage: number,
  titleSlot: number,
  foldEpoch: number,
  folded: number,
]
export interface HeadingMetadata {
  ordinal: number
  id: string
  from: number
  line: number
  level: number
  parent?: number
  ancestors: number[]
  subtreeEnd: number
  hasChildren: boolean
  collapsed: boolean
}
export interface Heading extends HeadingMetadata {
  title: string
  visibleIndex: number
}

export class OutlineIndex {
  private readonly pages: Pages
  private readonly labels: Labels
  private readonly visibility: Visibility
  private readonly stack: { ordinal: number; record: RecordData }[] = []
  private length = 0
  private lastSourceFrom = -1
  constructor(
    store: SdkTemporaryStore,
    private readonly version: number,
    private readonly diagnostics: Diagnostics,
  ) {
    this.pages = new Pages(store, diagnostics)
    this.labels = new Labels(this.pages)
    this.visibility = new Visibility(this.pages)
  }
  get size(): number {
    return this.length
  }
  get visibleSize(): number {
    return this.visibility.visibleCount
  }
  flush(): Promise<void> {
    return this.pages.flush()
  }
  private folded(record: RecordData): boolean {
    return record[9] === this.visibility.epoch ? record[10] === 1 : this.visibility.collapsed
  }
  private async raw(ordinal: number): Promise<RecordData> {
    const value = (await this.pages.get<RecordData[]>(`m-${Math.floor(ordinal / recordsPerPage)}`))[
      ordinal % recordsPerPage
    ]
    if (!value) throw new Error('大纲结构记录缺失')
    return value
  }
  private async set(ordinal: number, record: RecordData, fresh = false): Promise<void> {
    const key = `m-${Math.floor(ordinal / recordsPerPage)}`
    const page = fresh ? [] : await this.pages.get<RecordData[]>(key)
    page[ordinal % recordsPerPage] = record
    await this.pages.put(key, page)
  }
  private decode(ordinal: number, record: RecordData): HeadingMetadata {
    return {
      ordinal,
      id: `${this.version}:${record[0]}`,
      from: record[0],
      line: record[1],
      level: record[2],
      ...(record[3] < 0 ? {} : { parent: record[3] }),
      ancestors: record[4],
      subtreeEnd: this.stack.some((entry) => entry.ordinal === ordinal) ? this.length : record[5],
      hasChildren: record[6] === 1,
      collapsed: this.folded(record),
    }
  }
  async get(ordinal: number): Promise<HeadingMetadata | undefined> {
    return ordinal < 0 || ordinal >= this.length
      ? undefined
      : this.decode(ordinal, await this.raw(ordinal))
  }
  async append(item: SdkDocumentScanHeading): Promise<number | undefined> {
    if (item.from <= this.lastSourceFrom) return
    while (this.stack.length && this.stack.at(-1)!.record[2] >= item.level)
      await this.close(this.stack.pop()!)
    const parent = this.stack.at(-1)
    const changedParent = parent && !parent.record[6] ? parent.ordinal : undefined
    if (parent && !parent.record[6]) {
      parent.record[6] = 1
      await this.set(parent.ordinal, parent.record)
    }
    const [titlePage, titleSlot] = await this.labels.append(
      item.label.slice(0, 4096).replace(/\s+/gu, ' ').trim(),
    )
    const ordinal = this.length
    const record: RecordData = [
      item.from,
      item.line,
      item.level,
      parent?.ordinal ?? -1,
      this.stack.map((entry) => entry.ordinal),
      ordinal + 1,
      0,
      titlePage,
      titleSlot,
      0,
      0,
    ]
    await this.set(ordinal, record, ordinal % recordsPerPage === 0)
    await this.visibility.append(
      this.stack.length,
      item.line,
      this.stack.filter((entry) => this.folded(entry.record)).length,
    )
    this.length++
    this.stack.push({ ordinal, record })
    this.lastSourceFrom = item.from
    return changedParent
  }
  private async close(entry: { ordinal: number; record: RecordData }): Promise<void> {
    entry.record[5] = this.length
    await this.set(entry.ordinal, entry.record)
  }
  async finish(): Promise<void> {
    while (this.stack.length) await this.close(this.stack.pop()!)
    await this.flush()
  }
  resetCollapsed(collapsed: boolean): void {
    this.visibility.reset(collapsed)
  }
  async setCollapsed(ordinal: number, collapsed: boolean): Promise<void> {
    const record = await this.raw(ordinal)
    if (!record[6] || this.folded(record) === collapsed) return
    const end = this.stack.some((entry) => entry.ordinal === ordinal) ? this.length : record[5]
    await this.visibility.add(ordinal + 1, end, collapsed ? 1 : -1)
    record[9] = this.visibility.epoch
    record[10] = Number(collapsed)
    const open = this.stack.find((entry) => entry.ordinal === ordinal)
    if (open) {
      open.record[9] = record[9]
      open.record[10] = record[10]
    }
    await this.set(ordinal, record)
  }
  atLine(line: number): Promise<number> {
    return this.visibility.atLine(line)
  }
  rank(ordinal: number): Promise<number> {
    return this.visibility.rank(ordinal)
  }
  async rows(start: number, end: number): Promise<Heading[]> {
    const diagnosticEnd = this.diagnostics.start('rows.load')
    try {
    if (end - start > 500) throw new Error('大纲呈现范围超过 500 条')
    const result: Heading[] = []
    for (let begin = start; begin < end; begin += 16) {
      const ordinals = await this.visibility.selectRange(begin, Math.min(end, begin + 16))
      await this.pages.prefetch(
        ordinals.map((ordinal) => `m-${Math.floor(ordinal / recordsPerPage)}`),
      )
      const records: RecordData[] = []
      for (const ordinal of ordinals) records.push(await this.raw(ordinal))
      await this.pages.prefetch(records.map((record) => `t-${record[7]}`))
      for (let i = 0; i < ordinals.length; i++)
        result.push({
          ...this.decode(ordinals[i]!, records[i]!),
          title: await this.labels.get(records[i]![7], records[i]![8]),
          visibleIndex: begin + i,
        })
    }
    return result
    } finally { diagnosticEnd() }
  }
}

// diagnostic-end-of-index
