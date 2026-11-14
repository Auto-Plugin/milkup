// node_modules/.pnpm/@milkup+plugin-sdk@file+vendor+plugin-sdk.tgz/node_modules/@milkup/plugin-sdk/src/index.js
function definePlugin(plugin2) {
  return plugin2;
}

// src/outline-index.ts
var pageBytes = 64 * 1024;
var cachedPages = 24;
var recordsPerPage = 128;
var fanout = 32;
var encoder = new TextEncoder();
var Pages = class {
  constructor(store) {
    this.store = store;
  }
  cache = /* @__PURE__ */ new Map();
  async get(key2) {
    const hit = this.cache.get(key2);
    if (hit) {
      this.cache.delete(key2);
      this.cache.set(key2, hit);
      return hit.value;
    }
    const json = await this.store.get(key2);
    if (json === null) throw new Error("\u5927\u7EB2\u7D22\u5F15\u9875\u7F3A\u5931\uFF0C\u8BF7\u91CD\u8BD5\u5168\u6587\u626B\u63CF");
    await this.room();
    const value = JSON.parse(json);
    this.cache.set(key2, { value, dirty: false });
    return value;
  }
  async put(key2, value) {
    if (!this.cache.has(key2)) await this.room();
    this.cache.delete(key2);
    this.cache.set(key2, { value, dirty: true });
  }
  async prefetch(keys) {
    const missing = [...new Set(keys)].filter((key2) => !this.cache.has(key2));
    for (let start = 0; start < missing.length; start += 4) {
      const batch = missing.slice(start, start + 4);
      const values = await this.store.getMany(batch);
      for (let i = 0; i < batch.length; i++) {
        const json = values[i];
        if (json === null || json === void 0) throw new Error("\u5927\u7EB2\u7D22\u5F15\u9875\u7F3A\u5931\uFF0C\u8BF7\u91CD\u8BD5\u5168\u6587\u626B\u63CF");
        await this.room();
        this.cache.set(batch[i], { value: JSON.parse(json), dirty: false });
      }
    }
  }
  async flush() {
    let batch = [];
    let entries = [];
    let bytes = 0;
    const send = async () => {
      if (!batch.length) return;
      await this.store.setMany(batch);
      for (const entry of entries) entry.dirty = false;
      batch = [];
      entries = [];
      bytes = 0;
    };
    for (const [key2, entry] of this.cache) {
      if (!entry.dirty) continue;
      const value = JSON.stringify(entry.value);
      const size = encoder.encode(value).length;
      if (size > pageBytes) throw new Error("\u5927\u7EB2\u7D22\u5F15\u9875\u8D85\u8FC7 64 KiB \u4E0A\u9650");
      if (bytes + size > 256 * 1024 || batch.length === 32) await send();
      batch.push({ key: key2, value });
      entries.push(entry);
      bytes += size;
    }
    await send();
  }
  async room() {
    if (this.cache.size < cachedPages) return;
    await this.flush();
    for (let i = 0; i < 8; i++) this.cache.delete(this.cache.keys().next().value);
  }
};
var Labels = class {
  constructor(pages) {
    this.pages = pages;
  }
  page = -1;
  values = [];
  bytes = 2;
  async append(value) {
    const size = encoder.encode(JSON.stringify(value)).length;
    if (size + 2 > pageBytes) throw new Error("\u5927\u7EB2\u6807\u9898\u8D85\u8FC7\u9875\u9884\u7B97");
    if (this.page < 0 || this.values.length >= 256 || this.bytes + size + 1 > pageBytes) {
      this.page++;
      this.values = [];
      this.bytes = 2;
    }
    const slot = this.values.length;
    this.values.push(value);
    this.bytes += size + (slot ? 1 : 0);
    await this.pages.put(`t-${this.page}`, this.values);
    return [this.page, slot];
  }
  async get(page, slot) {
    const value = (await this.pages.get(`t-${page}`))[slot];
    if (value === void 0) throw new Error("\u5927\u7EB2\u6807\u9898\u8BB0\u5F55\u7F3A\u5931");
    return value;
  }
};
var empty = (epoch, level) => ({
  count: 0,
  depth: 6,
  depthCount: 0,
  minimum: 6,
  minimumCount: 0,
  lastLine: 0,
  epoch,
  ...level ? { children: [] } : { depths: [], lines: [], covers: [] }
});
var capacity = (level) => recordsPerPage * fanout ** level;
var key = (level, index) => `v-${level}-${index}`;
var summary = (node) => ({
  count: node.count,
  depth: node.depth,
  depthCount: node.depthCount,
  minimum: node.minimum,
  minimumCount: node.minimumCount,
  lastLine: node.lastLine,
  add: 0
});
var visible = (node, carry = 0) => node.minimum + carry === 0 ? node.minimumCount : 0;
var Visibility = class {
  constructor(pages) {
    this.pages = pages;
  }
  root = empty(1, 0);
  level = 0;
  epoch = 1;
  collapsed = false;
  get count() {
    return this.root.count;
  }
  get visibleCount() {
    this.current(this.root);
    return visible(this.root);
  }
  reset(collapsed) {
    if (this.epoch >= Number.MAX_SAFE_INTEGER) throw new Error("\u5927\u7EB2\u6298\u53E0\u7248\u672C\u5DF2\u8017\u5C3D\uFF0C\u8BF7\u91CD\u8BD5");
    this.epoch++;
    this.collapsed = collapsed;
    this.current(this.root);
  }
  current(node) {
    if (node.epoch === this.epoch) return node;
    node.epoch = this.epoch;
    if (node.children) {
      for (const child of node.children) {
        child.minimum = this.collapsed ? child.depth : 0;
        child.minimumCount = this.collapsed ? child.depthCount : child.count;
        child.add = 0;
      }
    } else node.covers = node.depths.map((depth) => this.collapsed ? depth : 0);
    this.refresh(node);
    return node;
  }
  async node(level, index) {
    return this.current(await this.pages.get(key(level, index)));
  }
  refresh(node) {
    const parts = node.children ?? node.depths.map((depth, i) => ({
      count: 1,
      depth,
      depthCount: 1,
      minimum: node.covers[i],
      minimumCount: 1,
      lastLine: node.lines[i]
    }));
    node.count = 0;
    node.depth = 6;
    node.depthCount = 0;
    node.minimum = Infinity;
    node.minimumCount = 0;
    for (const part of parts) {
      node.count += part.count;
      if (part.depth < node.depth) {
        node.depth = part.depth;
        node.depthCount = 0;
      }
      if (part.depth === node.depth) node.depthCount += part.depthCount;
      if (part.minimum < node.minimum) {
        node.minimum = part.minimum;
        node.minimumCount = 0;
      }
      if (part.minimum === node.minimum) node.minimumCount += part.minimumCount;
    }
    if (!node.count) node.minimum = 6;
    node.lastLine = parts.at(-1)?.lastLine ?? 0;
  }
  apply(node, delta) {
    if (!delta) return;
    if (node.children)
      for (const child of node.children) {
        child.minimum += delta;
        child.add += delta;
      }
    else node.covers = node.covers.map((cover) => cover + delta);
    this.refresh(node);
  }
  async append(depth, line, cover) {
    this.current(this.root);
    if (this.count === capacity(this.level)) {
      if (!Number.isSafeInteger(capacity(this.level + 1)))
        throw new Error("\u5927\u7EB2\u7D22\u5F15\u8303\u56F4\u8D85\u8FC7\u5B89\u5168\u6574\u6570\u4E0A\u9650");
      await this.pages.put(key(this.level, 0), this.root);
      const root = empty(this.epoch, ++this.level);
      root.children.push(summary(this.root));
      this.refresh(root);
      this.root = root;
    }
    await this.appendTo(this.root, this.level, 0, this.count, depth, line, cover);
  }
  async appendTo(node, level, index, ordinal, depth, line, cover) {
    if (!level) {
      node.depths.push(depth);
      node.lines.push(line);
      node.covers.push(cover);
    } else {
      const width = capacity(level - 1);
      const slot = Math.floor(ordinal / width) % fanout;
      const childIndex = index * fanout + slot;
      const prior = node.children[slot];
      const child = prior ? await this.node(level - 1, childIndex) : empty(this.epoch, level - 1);
      if (prior) this.apply(child, prior.add);
      await this.appendTo(child, level - 1, childIndex, ordinal, depth, line, cover);
      node.children[slot] = summary(child);
    }
    this.refresh(node);
    await this.pages.put(key(level, index), node);
  }
  async add(from, to, delta) {
    if (from >= to) return;
    await this.addTo(this.current(this.root), this.level, 0, from, to, delta);
  }
  async addTo(node, level, index, from, to, delta) {
    const start = index * capacity(level);
    if (!level) {
      for (let i = Math.max(0, from - start); i < Math.min(node.count, to - start); i++)
        node.covers[i] += delta;
    } else {
      const width = capacity(level - 1);
      for (let slot = 0; slot < node.children.length; slot++) {
        const entry = node.children[slot];
        const childStart = start + slot * width;
        if (to <= childStart || from >= childStart + entry.count) continue;
        if (from <= childStart && to >= childStart + entry.count) {
          entry.minimum += delta;
          entry.add += delta;
        } else {
          const childIndex = index * fanout + slot;
          const child = await this.node(level - 1, childIndex);
          this.apply(child, entry.add);
          await this.addTo(child, level - 1, childIndex, from, to, delta);
          node.children[slot] = summary(child);
        }
      }
    }
    this.refresh(node);
    await this.pages.put(key(level, index), node);
  }
  async select(visibleIndex) {
    if (visibleIndex < 0 || visibleIndex >= this.visibleCount) return void 0;
    let node = this.root, level = this.level, index = 0, carry = 0;
    while (level) {
      let slot = 0;
      for (; slot < node.children.length; slot++) {
        const count = visible(node.children[slot], carry);
        if (visibleIndex < count) break;
        visibleIndex -= count;
      }
      const entry = node.children[slot];
      carry += entry.add;
      index = index * fanout + slot;
      node = await this.node(--level, index);
    }
    for (let slot = 0; slot < node.count; slot++) {
      if (node.covers[slot] + carry !== 0) continue;
      if (!visibleIndex--) return index * recordsPerPage + slot;
    }
    throw new Error("\u5927\u7EB2\u53EF\u89C1\u5E8F\u53F7\u4E0D\u4E00\u81F4");
  }
  async rank(ordinal) {
    if (ordinal < 0 || ordinal >= this.count) return -1;
    let node = this.current(this.root), level = this.level, index = 0, carry = 0, rank = 0;
    while (level) {
      const slot2 = Math.floor(ordinal / capacity(level - 1)) % fanout;
      for (let i = 0; i < slot2; i++) rank += visible(node.children[i], carry);
      const entry = node.children[slot2];
      if (!visible(entry, carry)) return -1;
      carry += entry.add;
      index = index * fanout + slot2;
      node = await this.node(--level, index);
    }
    const slot = ordinal % recordsPerPage;
    if (node.covers[slot] + carry !== 0) return -1;
    for (let i = 0; i < slot; i++) if (node.covers[i] + carry === 0) rank++;
    return rank;
  }
  async atLine(line) {
    if (!this.count) return -1;
    let node = this.current(this.root), level = this.level, index = 0;
    while (level) {
      let slot = node.children.findIndex((child) => child.lastLine >= line);
      if (slot < 0) slot = node.children.length - 1;
      index = index * fanout + slot;
      node = await this.node(--level, index);
    }
    let low = 0, high = node.lines.length;
    while (low < high) {
      const middle = low + high >>> 1;
      if (node.lines[middle] <= line) low = middle + 1;
      else high = middle;
    }
    return index * recordsPerPage + low - 1;
  }
};
var OutlineIndex = class {
  constructor(store, version) {
    this.version = version;
    this.pages = new Pages(store);
    this.labels = new Labels(this.pages);
    this.visibility = new Visibility(this.pages);
  }
  pages;
  labels;
  visibility;
  stack = [];
  length = 0;
  lastSourceFrom = -1;
  get size() {
    return this.length;
  }
  get visibleSize() {
    return this.visibility.visibleCount;
  }
  flush() {
    return this.pages.flush();
  }
  folded(record) {
    return record[9] === this.visibility.epoch ? record[10] === 1 : this.visibility.collapsed;
  }
  async raw(ordinal) {
    const value = (await this.pages.get(`m-${Math.floor(ordinal / recordsPerPage)}`))[ordinal % recordsPerPage];
    if (!value) throw new Error("\u5927\u7EB2\u7ED3\u6784\u8BB0\u5F55\u7F3A\u5931");
    return value;
  }
  async set(ordinal, record, fresh = false) {
    const key2 = `m-${Math.floor(ordinal / recordsPerPage)}`;
    const page = fresh ? [] : await this.pages.get(key2);
    page[ordinal % recordsPerPage] = record;
    await this.pages.put(key2, page);
  }
  decode(ordinal, record) {
    return {
      ordinal,
      id: `${this.version}:${record[0]}`,
      from: record[0],
      line: record[1],
      level: record[2],
      ...record[3] < 0 ? {} : { parent: record[3] },
      ancestors: record[4],
      subtreeEnd: this.stack.some((entry) => entry.ordinal === ordinal) ? this.length : record[5],
      hasChildren: record[6] === 1,
      collapsed: this.folded(record)
    };
  }
  async get(ordinal) {
    return ordinal < 0 || ordinal >= this.length ? void 0 : this.decode(ordinal, await this.raw(ordinal));
  }
  async append(item) {
    if (item.from <= this.lastSourceFrom) return;
    while (this.stack.length && this.stack.at(-1).record[2] >= item.level)
      await this.close(this.stack.pop());
    const parent = this.stack.at(-1);
    const changedParent = parent && !parent.record[6] ? parent.ordinal : void 0;
    if (parent && !parent.record[6]) {
      parent.record[6] = 1;
      await this.set(parent.ordinal, parent.record);
    }
    const [titlePage, titleSlot] = await this.labels.append(
      item.label.slice(0, 4096).replace(/\s+/gu, " ").trim()
    );
    const ordinal = this.length;
    const record = [
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
      0
    ];
    await this.set(ordinal, record, ordinal % recordsPerPage === 0);
    await this.visibility.append(
      this.stack.length,
      item.line,
      this.stack.filter((entry) => this.folded(entry.record)).length
    );
    this.length++;
    this.stack.push({ ordinal, record });
    this.lastSourceFrom = item.from;
    return changedParent;
  }
  async close(entry) {
    entry.record[5] = this.length;
    await this.set(entry.ordinal, entry.record);
  }
  async finish() {
    while (this.stack.length) await this.close(this.stack.pop());
    await this.flush();
  }
  resetCollapsed(collapsed) {
    this.visibility.reset(collapsed);
  }
  async setCollapsed(ordinal, collapsed) {
    const record = await this.raw(ordinal);
    if (!record[6] || this.folded(record) === collapsed) return;
    const end = this.stack.some((entry) => entry.ordinal === ordinal) ? this.length : record[5];
    await this.visibility.add(ordinal + 1, end, collapsed ? 1 : -1);
    record[9] = this.visibility.epoch;
    record[10] = Number(collapsed);
    const open = this.stack.find((entry) => entry.ordinal === ordinal);
    if (open) {
      open.record[9] = record[9];
      open.record[10] = record[10];
    }
    await this.set(ordinal, record);
  }
  atLine(line) {
    return this.visibility.atLine(line);
  }
  rank(ordinal) {
    return this.visibility.rank(ordinal);
  }
  async rows(start, end) {
    if (end - start > 500) throw new Error("\u5927\u7EB2\u5448\u73B0\u8303\u56F4\u8D85\u8FC7 500 \u6761");
    const result = [];
    for (let begin = start; begin < end; begin += 16) {
      const ordinals = [];
      for (let i = begin; i < Math.min(end, begin + 16); i++) {
        const ordinal = await this.visibility.select(i);
        if (ordinal === void 0) throw new Error("\u5927\u7EB2\u53EF\u89C1\u8BB0\u5F55\u7F3A\u5931");
        ordinals.push(ordinal);
      }
      await this.pages.prefetch(
        ordinals.map((ordinal) => `m-${Math.floor(ordinal / recordsPerPage)}`)
      );
      const records = [];
      for (const ordinal of ordinals) records.push(await this.raw(ordinal));
      await this.pages.prefetch(records.map((record) => `t-${record[7]}`));
      for (let i = 0; i < ordinals.length; i++)
        result.push({
          ...this.decode(ordinals[i], records[i]),
          title: await this.labels.get(records[i][7], records[i][8]),
          visibleIndex: begin + i
        });
    }
    return result;
  }
};

// src/plugin.ts
var scanLines = 4096;
var maximumRows = 500;
var defaultRows = 160;
var rowHeight = 28;
var host;
var session;
var generation = 0;
var cleanupQueue = Promise.resolve();
var plugin = definePlugin({
  activate(context) {
    host = context.host;
    return {
      dispose: () => {
        host = void 0;
        return stopSession();
      }
    };
  },
  deactivate() {
    host = void 0;
    return stopSession();
  },
  commands: {
    "outline.gotoHeading": async (_context, input) => {
      const current = requireSession(input);
      await enqueue(current, async () => {
        const item = await requireHeading(current, input);
        if (!host?.ui) throw new Error("\u5927\u7EB2\u5BFC\u822A\u6682\u65F6\u4E0D\u53EF\u7528");
        const foldedAncestors = [];
        for (const ordinal of item.ancestors) {
          if ((await current.records.get(ordinal)).collapsed) foldedAncestors.push(ordinal);
        }
        if (foldedAncestors.length)
          await changeFold(current, async () => {
            for (const ordinal of foldedAncestors)
              await current.records.setCollapsed(ordinal, false);
          });
        await host.ui.revealLine(item.line);
        assertCurrent(current);
        current.activeLine = item.line;
        current.followActive = true;
        scheduleRefresh(current);
      });
    },
    "outline.toggleHeading": async (_context, input) => {
      const current = requireSession(input);
      await enqueue(current, async () => {
        const item = await requireHeading(current, input);
        if (!item.hasChildren) return;
        await changeFold(
          current,
          () => current.records.setCollapsed(item.ordinal, !item.collapsed)
        );
      });
    },
    "outline.collapseAll": async () => {
      const current = session;
      if (!current?.records) return;
      await enqueue(
        current,
        () => changeFold(current, async () => current.records.resetCollapsed(true), false)
      );
    },
    "outline.expandAll": async () => {
      const current = session;
      if (!current?.records) return;
      await enqueue(
        current,
        () => changeFold(current, async () => current.records.resetCollapsed(false), false)
      );
    },
    "outline.cancel": async () => {
      const current = session;
      if (!current || current.status !== "starting" && current.status !== "scanning") return;
      current.status = "cancelled";
      await current.scanner?.cancel().catch(() => void 0);
      try {
        await enqueue(current, async () => {
          await current.records?.flush();
        });
      } catch (error) {
        if (isCurrent(current)) {
          current.status = "failed";
          current.error = error instanceof Error ? error.message : "\u4E34\u65F6\u7D22\u5F15\u5199\u5165\u5931\u8D25";
        }
      }
      scheduleRefresh(current);
    },
    "outline.retry": async () => {
      const current = session;
      if (current)
        beginSession(current.documentId, current.version, current.activeLine, current.totalLines);
    }
  },
  renderers: { "outline-panel": (context) => renderPanel(context) }
});
var plugin_default = plugin;
function renderPanel(context) {
  const node = context.node;
  if (node?.phase === "dispose") {
    void stopSession();
    return "";
  }
  const documentId = node?.documentId ?? session?.documentId ?? "";
  const sameDocument = documentId === session?.documentId;
  const version = node?.documentVersion ?? (sameDocument ? session?.version ?? 0 : 0);
  const activeLine = positiveInteger(node?.viewport?.activeLine) ?? (sameDocument ? session?.activeLine ?? 1 : 1);
  if (!session || session.documentId !== documentId || session.version !== version) {
    beginSession(documentId, version, activeLine, positiveInteger(node?.documentLineCount) ?? 1);
  }
  const current = session;
  if (activeLine !== current.activeLine) {
    current.activeLine = activeLine;
    current.followActive = true;
    scheduleRefresh(current);
  }
  const viewport = node?.virtualViewport;
  if (viewport?.id === "outline" && viewport.userInitiated === true && // The host echoes the rendered slice after mounting. It is not a new scroll request.
  (viewport.fromIndex !== current.returnedStart || viewport.toIndex !== current.returnedEnd) && Number.isInteger(viewport.fromIndex) && Number.isInteger(viewport.toIndex)) {
    const from = Math.max(0, viewport.fromIndex);
    const count = Math.min(maximumRows, Math.max(1, viewport.toIndex - from));
    if (from !== current.fromIndex || count !== current.rowCount) {
      current.fromIndex = from;
      current.rowCount = count;
      if (viewport.userInitiated) {
        current.followActive = false;
        current.preparedFollow = false;
      }
      scheduleRefresh(current);
    }
  }
  const output = panel(current);
  current.returnedStart = current.rowStart;
  current.returnedEnd = current.rowEnd;
  return output;
}
function beginSession(documentId, version, activeLine, totalLines) {
  const cleaned = stopSession();
  const current = {
    documentId,
    version,
    generation: ++generation,
    alive: true,
    status: "starting",
    queue: Promise.resolve(),
    scannedLines: 0,
    totalLines,
    activeLine,
    activeOrdinal: -1,
    activeVisible: -1,
    followActive: true,
    preparedFollow: false,
    fromIndex: 0,
    rowCount: defaultRows,
    rows: [],
    rowsDirty: true,
    rowStart: 0,
    rowEnd: 0,
    returnedStart: 0,
    returnedEnd: 0,
    revision: 0,
    renderRequest: 0,
    rebuilding: false,
    error: ""
  };
  session = current;
  current.startTimer = setTimeout(() => {
    delete current.startTimer;
    void cleaned.then(() => {
      if (isCurrent(current) && current.status !== "cancelled") return buildIndex(current);
    });
  }, 120);
}
function stopSession() {
  const current = session;
  session = void 0;
  if (!current) return cleanupQueue;
  current.alive = false;
  if (current.startTimer !== void 0) clearTimeout(current.startTimer);
  if (current.refreshTimer !== void 0) clearTimeout(current.refreshTimer);
  const clean = async () => {
    await current.scanner?.cancel().catch(() => void 0);
    const store = await current.storeReady?.catch(() => void 0);
    await current.queue.catch(() => void 0);
    await store?.dispose().catch(() => void 0);
  };
  cleanupQueue = cleanupQueue.then(clean, clean);
  return cleanupQueue;
}
async function buildIndex(current) {
  try {
    if (!host?.storage?.createTemporaryStore || !host.document)
      throw new Error("\u5BBF\u4E3B\u4E0D\u652F\u6301\u5927\u7EB2\u6240\u9700\u7684\u4E34\u65F6\u7D22\u5F15\u5B58\u50A8");
    const document = host.document;
    current.storeReady = host.storage.createTemporaryStore();
    const store = await current.storeReady;
    if (!isCurrent(current)) return;
    current.store = store;
    current.records = new OutlineIndex(store, current.version);
    if (current.status === "cancelled") {
      scheduleRefresh(current);
      return;
    }
    current.status = "scanning";
    let fromLine = 1;
    while (isCurrent(current) && current.status === "scanning") {
      const toLine = fromLine + scanLines - 1;
      const scanner = document.scan({
        query: { kind: "markdownHeadings" },
        fromLine,
        toLine,
        windowSizeLines: 512,
        batchSize: 128,
        maxResults: scanLines + 1
      });
      current.scanner = scanner;
      let done = false;
      for await (const event of scanner) {
        if (!isCurrent(current) || current.status !== "scanning") return;
        current.totalLines = event.totalLineCount;
        if (event.type === "batch") {
          await enqueue(current, async () => {
            for (const item of event.items) {
              assertCurrent(current);
              if (item.kind === "heading") {
                const changedParent = await current.records.append(item);
                if (changedParent !== void 0 && current.rows.some((row) => row.ordinal === changedParent))
                  current.rowsDirty = true;
              }
            }
          });
        }
        current.scannedLines = Math.min(
          current.totalLines,
          Math.max(current.scannedLines, fromLine + event.scannedLineCount - 1)
        );
        scheduleRefresh(current);
        if (event.type === "done") {
          done = true;
          delete current.scanner;
          if (event.reason === "invalidated") {
            current.status = "invalidated";
            scheduleRefresh(current);
            return;
          }
          if (event.reason === "cancelled") {
            current.status = "cancelled";
            scheduleRefresh(current);
            return;
          }
          if (event.reason === "truncated")
            throw new Error("\u6807\u9898\u626B\u63CF\u8FBE\u5230\u5BBF\u4E3B\u9650\u5236\uFF0C\u5168\u6587\u7D22\u5F15\u5C1A\u672A\u5B8C\u6210");
          if (event.scannedLineCount <= 0 && fromLine <= event.totalLineCount)
            throw new Error("\u626B\u63CF\u672A\u53D6\u5F97\u8FDB\u5C55\uFF0C\u5168\u6587\u7D22\u5F15\u5C1A\u672A\u5B8C\u6210");
          break;
        }
      }
      if (!isCurrent(current) || current.status !== "scanning") return;
      if (!done) throw new Error("\u626B\u63CF\u88AB\u4E2D\u65AD\uFF0C\u5168\u6587\u7D22\u5F15\u5C1A\u672A\u5B8C\u6210");
      if (current.scannedLines >= current.totalLines) {
        await enqueue(current, async () => {
          await current.records.finish();
          if (current.status === "scanning") current.status = "complete";
          current.followActive = true;
        });
        scheduleRefresh(current);
        return;
      }
      await enqueue(current, () => current.records.flush());
      fromLine = current.scannedLines + 1;
      await yieldTask();
    }
  } catch (error) {
    if (!isCurrent(current) || current.status === "cancelled") return;
    current.status = "failed";
    current.error = error instanceof Error ? error.message : "\u4E34\u65F6\u7D22\u5F15\u5199\u5165\u5931\u8D25";
    await current.scanner?.cancel().catch(() => void 0);
    delete current.scanner;
    scheduleRefresh(current);
  }
}
async function changeFold(current, action, persist = true) {
  assertCurrent(current);
  current.rebuilding = true;
  current.rowsDirty = true;
  try {
    await action();
    if (persist) await current.records.flush();
    current.revision++;
    current.followActive = true;
  } catch (error) {
    if (isCurrent(current)) {
      current.status = "failed";
      current.error = `\u6298\u53E0\u89C6\u56FE\u66F4\u65B0\u5931\u8D25\uFF1A${error instanceof Error ? error.message : "\u4E34\u65F6\u7D22\u5F15\u4E0D\u53EF\u7528"}`;
    }
    throw error;
  } finally {
    current.rebuilding = false;
    scheduleRefresh(current);
  }
}
function scheduleRefresh(current) {
  if (!isCurrent(current)) return;
  current.renderRequest++;
  if (current.refreshTimer !== void 0) return;
  current.refreshTimer = setTimeout(() => {
    delete current.refreshTimer;
    const request = current.renderRequest;
    void enqueue(current, async () => {
      if (request !== current.renderRequest) return;
      await prepareRows(current, request);
      if (request !== current.renderRequest) return;
      await updatePanel(current);
    }).catch((error) => {
      if (!isCurrent(current)) return;
      current.status = "failed";
      current.error = error instanceof Error ? error.message : "\u5927\u7EB2\u8BFB\u53D6\u5931\u8D25";
      void updatePanel(current);
    });
  }, 0);
}
async function prepareRows(current, request) {
  const records = current.records;
  if (!records) return;
  const { activeLine, followActive, rowCount, fromIndex } = current;
  const activeOrdinal = current.status !== "complete" && activeLine > current.scannedLines ? -1 : await records.atLine(activeLine);
  const active = await records.get(activeOrdinal);
  let activeVisible = active ? await records.rank(active.ordinal) : -1;
  if (active && activeVisible < 0) {
    for (const ordinal of active.ancestors) {
      const ancestor = await records.get(ordinal);
      const rank = await records.rank(ordinal);
      if (rank >= 0 && ancestor.collapsed) {
        activeVisible = rank;
        break;
      }
    }
  }
  const count = Math.min(maximumRows, rowCount);
  let start = Math.min(fromIndex, Math.max(0, records.visibleSize - count));
  if (followActive && activeVisible >= 0) start = Math.max(0, activeVisible - Math.floor(count / 2));
  const end = Math.min(records.visibleSize, start + count);
  const rows = current.rowsDirty || start !== current.rowStart || end !== current.rowEnd ? await records.rows(start, end) : current.rows;
  if (!isCurrent(current) || request !== current.renderRequest) return;
  current.activeOrdinal = activeOrdinal;
  current.activeVisible = activeVisible;
  current.rows = rows;
  current.rowsDirty = false;
  current.preparedFollow = followActive;
  current.followActive = false;
  current.rowStart = start;
  current.rowEnd = end;
  current.fromIndex = start;
  current.revision++;
}
function panel(current) {
  const count = current.records?.size ?? 0;
  const state = current.status;
  const progress = state === "complete" ? `\u5168\u6587\u7D22\u5F15\u5B8C\u6210 \xB7 ${count} \u4E2A\u6807\u9898 \xB7 ${current.totalLines} \u884C` : `\u5168\u6587\u7D22\u5F15\u5C1A\u672A\u5B8C\u6210 \xB7 \u5DF2\u626B\u63CF ${current.scannedLines} / ${current.totalLines} \u884C \xB7 ${count} \u4E2A\u6807\u9898`;
  const children = [span([progress], "plugin-list-summary")];
  const controls = [];
  if (state === "starting" || state === "scanning")
    controls.push(commandButton("\u53D6\u6D88\u626B\u63CF", "outline.cancel"));
  else if (state !== "complete") controls.push(commandButton("\u91CD\u8BD5\u5168\u6587\u626B\u63CF", "outline.retry"));
  if (controls.length) children.push(span(controls, "plugin-tree-toolbar"));
  if (count)
    children.push(
      span(
        [
          commandButton("\u5168\u90E8\u5C55\u5F00", "outline.expandAll"),
          commandButton("\u5168\u90E8\u6298\u53E0", "outline.collapseAll")
        ],
        "plugin-tree-toolbar"
      )
    );
  if (current.rebuilding) children.push(span(["\u6B63\u5728\u66F4\u65B0\u6298\u53E0\u89C6\u56FE"], "plugin-list-summary"));
  if (state === "failed")
    children.push(span([`\u5927\u7EB2\u52A0\u8F7D\u5931\u8D25\uFF1A${current.error}`], "plugin-ui-state plugin-ui-state-error"));
  if (state === "cancelled")
    children.push(span(["\u626B\u63CF\u5DF2\u53D6\u6D88\uFF1B\u5F53\u524D\u663E\u793A\u5DF2\u7D22\u5F15\u90E8\u5206\uFF0C\u53EF\u91CD\u8BD5\u3002"], "plugin-list-summary"));
  if (state === "invalidated")
    children.push(span(["\u6587\u6863\u5DF2\u53D8\u5316\uFF1B\u65E7\u7D22\u5F15\u4E0D\u53EF\u5BFC\u822A\uFF0C\u8BF7\u91CD\u8BD5\u3002"], "plugin-list-summary"));
  if (!count && state === "complete")
    children.push(
      span(
        ["\u6587\u6863\u65E0\u6807\u9898\u3002\u6DFB\u52A0 H1\u2013H6 \u6216 Setext \u6807\u9898\u540E\u5C06\u5728\u6B64\u663E\u793A\u3002"],
        "plugin-ui-state plugin-ui-state-empty"
      )
    );
  children.push(
    span(
      current.rows.map((item) => treeRow(current, item)),
      "plugin-virtual-list",
      {
        role: "tree",
        "aria-label": "\u6587\u6863\u5927\u7EB2",
        "data-virtual-list": "outline",
        "data-virtual-total": String(current.records?.visibleSize ?? 0),
        "data-virtual-start": String(current.rowStart),
        "data-virtual-end": String(current.rowEnd),
        "data-virtual-item-height": String(rowHeight),
        "data-virtual-active": String(current.activeVisible),
        "data-virtual-follow-active": String(current.preparedFollow),
        "data-virtual-has-before": "false",
        "data-virtual-has-after": "false",
        "data-virtual-scroll-adjust": "0",
        "data-virtual-revision": String(current.revision)
      }
    )
  );
  current.preparedFollow = false;
  return span(children, "plugin-list-panel");
}
function treeRow(current, item) {
  const title = item.title || `\u7B2C ${item.line} \u884C`;
  const active = item.visibleIndex === current.activeVisible;
  const input = {
    documentId: current.documentId,
    version: current.version,
    generation: current.generation,
    ordinal: item.ordinal,
    id: item.id,
    line: item.line
  };
  const toggle = item.hasChildren ? {
    type: "element",
    tag: "button",
    text: item.collapsed ? "\u25B8" : "\u25BE",
    attributes: {
      class: "plugin-tree-toggle",
      "aria-label": `${item.collapsed ? "\u5C55\u5F00" : "\u6298\u53E0"} ${title}`,
      "aria-expanded": String(!item.collapsed)
    },
    action: { command: "outline.toggleHeading", input }
  } : span([], "plugin-tree-toggle");
  return span(
    [
      toggle,
      {
        type: "element",
        tag: "button",
        text: title,
        attributes: {
          class: `plugin-list-item${active ? " is-active" : ""}`,
          title: `${title}\uFF08\u7B2C ${item.line} \u884C\uFF09`,
          "aria-label": `\u8DF3\u8F6C\u5230 ${title}\uFF0C\u7B2C ${item.line} \u884C`,
          "aria-current": active ? "location" : "false"
        },
        action: { command: "outline.gotoHeading", input }
      }
    ],
    `plugin-tree-row plugin-list-level-${item.level}${active ? " is-active" : ""}`,
    {
      role: "treeitem",
      "aria-level": String(item.level),
      ...item.hasChildren ? { "aria-expanded": String(!item.collapsed) } : {}
    }
  );
}
function requireSession(input) {
  const value = input;
  const current = session;
  if (!current || !value || value.documentId !== current.documentId || value.version !== current.version || value.generation !== current.generation || current.status === "invalidated")
    throw new Error("\u5927\u7EB2\u6761\u76EE\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u4F7F\u7528\u5F53\u524D\u6587\u6863\u7684\u5927\u7EB2");
  assertCurrent(current);
  return current;
}
async function requireHeading(current, input) {
  assertCurrent(current);
  const value = input;
  if (!Number.isInteger(value.ordinal) || Number(value.ordinal) < 0) throw new Error("\u6807\u9898\u6807\u8BC6\u65E0\u6548");
  const item = await current.records?.get(Number(value.ordinal));
  assertCurrent(current);
  if (!item || item.id !== value.id) throw new Error("\u5927\u7EB2\u6761\u76EE\u5DF2\u8FC7\u671F");
  return item;
}
function enqueue(current, task) {
  const pending = current.queue.then(() => {
    assertCurrent(current);
    return task();
  });
  current.queue = pending.catch(() => void 0);
  return pending;
}
function isCurrent(current) {
  return current.alive && session === current;
}
function assertCurrent(current) {
  if (!isCurrent(current)) throw new Error("\u5927\u7EB2\u6587\u6863\u7248\u672C\u5DF2\u8FC7\u671F");
}
async function updatePanel(current) {
  if (isCurrent(current)) await host?.ui?.requestUpdate("outline-panel").catch(() => void 0);
}
function positiveInteger(value) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : void 0;
}
function yieldTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function commandButton(text, command) {
  return {
    type: "element",
    tag: "button",
    text,
    attributes: { "aria-label": text },
    action: { command }
  };
}
function span(children, className, attributes = {}) {
  return { type: "element", tag: "span", children, attributes: { class: className, ...attributes } };
}
export {
  plugin_default as default
};
