// plugins/footnotes/src/indexer.ts
function normalizeLabel(label) {
  const value = label.trim().normalize("NFC");
  return value.length > 0 && value.length <= 128 && !/[\s\u0000-\u001f\u007f\[\]\\]/u.test(value) ? value : void 0;
}
var FootnoteIndex = class {
  references = [];
  definitions = /* @__PURE__ */ new Map();
  duplicates = [];
  complete = false;
  outputRevision = 0;
  get revision() {
    return this.outputRevision;
  }
  partialReason;
  numbers = /* @__PURE__ */ new Map();
  maxEntries;
  maxBody;
  active;
  blank = false;
  fence;
  html;
  ticks = 0;
  entries = 0;
  constructor(options = {}) {
    this.maxEntries = options.maxEntries ?? 4096;
    this.maxBody = options.maxBody ?? 8192;
  }
  limit(reason) {
    if (this.partialReason === void 0 || this.complete) this.outputRevision++;
    this.partialReason ??= reason;
    this.complete = false;
  }
  reserve() {
    if (this.entries >= this.maxEntries) {
      this.limit("entry-limit");
      return false;
    }
    this.entries++;
    return true;
  }
  body(text3) {
    const active = this.active;
    if (!active) return;
    const value = active.body + (this.blank ? "\n\n" : "\n") + text3;
    this.blank = false;
    const body = value.slice(0, this.maxBody);
    const truncated = active.truncated || value.length > this.maxBody;
    if (body !== active.body || truncated !== active.truncated) this.outputRevision++;
    active.body = body;
    active.truncated = truncated;
  }
  consume(line) {
    if (this.partialReason) return;
    const text3 = line.text;
    if (this.fence) {
      const close = /^ {0,3}(`+|~+)[\t ]*$/.exec(text3);
      if (close && close[1][0] === this.fence.marker && close[1].length >= this.fence.length)
        this.fence = void 0;
      return;
    }
    if (this.html) {
      if (this.html === "blank" && !text3.trim()) this.html = void 0;
      else if (this.html !== "blank" && text3.toLowerCase().includes(this.html))
        this.html = void 0;
      return;
    }
    if (this.active) {
      if (!text3.trim()) {
        this.blank = true;
        return;
      }
      const continuation = /^(?: {4}|\t)(.*)$/.exec(text3);
      if (continuation) {
        this.body(continuation[1]);
        return;
      }
      this.active = void 0;
      this.blank = false;
    }
    if (/^ {0,3}(?:>|[-+*][\t ]|\d+[.)][\t ])/.test(text3)) {
      if (/`{3,}|~{3,}|<\/?[A-Za-z!]/.test(text3)) this.limit("nested-context");
      return;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text3);
    if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      this.fence = { marker: fence[1][0], length: fence[1].length };
      this.ticks = 0;
      return;
    }
    if (/^(?: {4}|\t)/.test(text3)) return;
    const html = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(text3);
    const end = html ? `</${html[1].toLowerCase()}>` : /^ {0,3}<!--/.test(text3) ? "-->" : /^ {0,3}<\?/.test(text3) ? "?>" : /^ {0,3}<!\[CDATA\[/.test(text3) ? "]]>" : /^ {0,3}<![A-Z]/.test(text3) ? ">" : /^ {0,3}<\/?[A-Za-z][\w-]*(?:[\t >\/]|$)/.test(text3) ? "blank" : void 0;
    if (end) {
      if (end === "blank" || !text3.toLowerCase().includes(end)) this.html = end;
      return;
    }
    if (/<\/?[A-Za-z!][^>]*>/.test(text3)) return;
    if (!this.ticks) {
      const definition2 = /^ {0,3}\[\^([^\]\r\n]{1,128})\]:[\t ]?(.*)$/.exec(text3);
      const key = definition2 && normalizeLabel(definition2[1]);
      if (definition2 && key) {
        if (!this.reserve()) return;
        const body = definition2[2];
        const def = {
          key,
          from: line.from,
          to: line.to,
          line: line.number,
          body: body.slice(0, this.maxBody),
          truncated: body.length > this.maxBody
        };
        if (this.definitions.has(key)) this.duplicates.push(def);
        else this.definitions.set(key, def);
        this.outputRevision++;
        this.active = def;
        return;
      }
    }
    for (let i = 0; i < text3.length; ) {
      if (text3[i] === "\\" && !this.ticks) {
        i += 2;
        continue;
      }
      if (text3[i] === "`") {
        let end2 = i + 1;
        while (text3[end2] === "`") end2++;
        const count2 = end2 - i;
        if (this.ticks === count2) this.ticks = 0;
        else if (!this.ticks) this.ticks = count2;
        i = end2;
        continue;
      }
      if (this.ticks) {
        i++;
        continue;
      }
      if (text3[i] === "[" || text3[i] === "!" && text3[i + 1] === "[") {
        const open = text3[i] === "!" ? i + 1 : i;
        let close = open + 1;
        for (; close < text3.length; close++) {
          if (text3[close] === "\\") close++;
          else if (text3[close] === "]") break;
        }
        if (close >= text3.length) return;
        if (text3[close + 1] === "(") {
          let end2 = close + 2;
          for (; end2 < text3.length; end2++) {
            if (text3[end2] === "\\") end2++;
            else if (text3[end2] === ")") break;
          }
          i = Math.min(text3.length, end2 + 1);
          continue;
        }
        if (text3[i] === "!" || text3[open + 1] !== "^") {
          i = close + 1;
          continue;
        }
      }
      if (text3[i] === "[" && text3[i + 1] === "^") {
        const close = text3.indexOf("]", i + 2);
        if (close > i && close - i <= 131) {
          const key = normalizeLabel(text3.slice(i + 2, close));
          if (key) {
            if (!this.reserve()) return;
            let number2 = this.numbers.get(key);
            if (number2 === void 0) {
              number2 = this.numbers.size + 1;
              this.numbers.set(key, number2);
            }
            this.outputRevision++;
            this.references.push({
              key,
              number: number2,
              from: line.from + i,
              to: line.from + close + 1,
              line: line.number
            });
            i = close + 1;
            continue;
          }
        }
      }
      i++;
    }
  }
  finish() {
    if (this.ticks) this.limit("incomplete-inline-code");
    const complete = !this.partialReason;
    if (complete !== this.complete) this.outputRevision++;
    this.complete = complete;
    this.active = void 0;
  }
};

// plugins/footnotes/src/presentation.ts
var text = (value) => ({ type: "text", text: value });
function safe(request, from, to) {
  return from >= request.from && to <= request.to && to > from && !request.protectedRanges.some((r) => r.from < to && r.to > from) && !request.blocks.some((b) => b.kind !== "text" && b.from < to && b.to > from);
}
function present(request, index) {
  if (!request.contextKnown) return { fragments: [], complete: false };
  const fragments = [];
  for (const ref of index.references) {
    if (fragments.length >= 128) break;
    if (!safe(request, ref.from, ref.to)) continue;
    const definition2 = index.definitions.get(ref.key);
    if (definition2) {
      fragments.push({
        from: ref.from,
        to: ref.to,
        layout: "inline",
        content: {
          type: "sup",
          children: [
            {
              type: "reference",
              label: String(ref.number),
              target: {
                documentId: request.documentId,
                version: request.version,
                from: definition2.from,
                to: definition2.to
              }
            }
          ]
        },
        accessibleText: `\u811A\u6CE8 ${ref.number}\uFF0C${ref.key}\uFF1A${definition2.body.slice(0, 256)}${definition2.truncated || definition2.body.length > 256 ? "\uFF08\u6458\u8981\u5DF2\u622A\u65AD\uFF09" : ""}`
      });
    } else {
      const message = index.complete ? `\u811A\u6CE8 ${ref.key} \u672A\u5B9A\u4E49` : `\u811A\u6CE8 ${ref.key} \u5C1A\u672A\u89E3\u6790\uFF0C\u7D22\u5F15\u672A\u5B8C\u6210${index.partialReason ? "\uFF08" + index.partialReason + "\uFF09" : ""}`;
      fragments.push({
        from: ref.from,
        to: ref.to,
        layout: "inline",
        content: text(request.source.slice(ref.from - request.from, ref.to - request.from)),
        accessibleText: message,
        status: "error",
        message
      });
    }
  }
  for (const def of [...index.definitions.values(), ...index.duplicates]) {
    if (fragments.length >= 128) break;
    if (def.from < request.from || def.to > request.to) continue;
    const raw = request.source.slice(def.from - request.from, def.to - request.from), close = raw.indexOf("]:");
    if (close < 0) continue;
    const end = def.from + close + 2;
    if (!safe(request, def.from, end)) continue;
    const references = index.references.filter((r) => r.key === def.key), number2 = references[0]?.number, duplicate = index.definitions.get(def.key) !== def;
    const children = [text(number2 === void 0 ? `\u811A\u6CE8 ${def.key}\uFF1A` : `[${number2}] `)];
    for (const [i, ref] of references.slice(0, 8).entries())
      children.push({
        type: "reference",
        label: `\u8FD4\u56DE\u5F15\u7528 ${i + 1}`,
        target: {
          documentId: request.documentId,
          version: request.version,
          from: ref.from,
          to: ref.to
        }
      });
    const message = duplicate ? `\u91CD\u590D\u811A\u6CE8 ${def.key}\uFF0C\u4F7F\u7528\u9996\u6B21\u5B9A\u4E49` : references.length > 8 ? `\u5171 ${references.length} \u5904\u5F15\u7528\uFF1B\u663E\u793A\u524D 8 \u4E2A\u8FD4\u56DE\u4F4D\u7F6E` : def.truncated ? "\u811A\u6CE8\u6458\u8981\u5DF2\u622A\u65AD\uFF0C\u5B8C\u6574\u6B63\u6587\u4FDD\u7559\u5728\u6E90\u6587\u4E2D" : void 0;
    fragments.push({
      from: def.from,
      to: end,
      layout: "inline",
      content: { type: "group", children },
      accessibleText: `${number2 === void 0 ? "\u672A\u5F15\u7528\u7684\u811A\u6CE8" : `\u811A\u6CE8 ${number2}`} ${def.key}\u3002${message ?? ""}`,
      ...message ? { status: duplicate ? "error" : "ready", message } : {}
    });
  }
  fragments.sort((a, b) => a.from - b.from || a.to - b.to);
  return { fragments, complete: index.complete && fragments.length < 128 };
}

// plugins/footnotes/src/controller.ts
function createFootnoteController(host, limits = {}) {
  let active = true, generation = 0, current, timer;
  const stop = () => {
    generation++;
    current?.abort.abort();
    if (timer !== void 0) clearTimeout(timer);
    timer = void 0;
  };
  async function scan(job, epoch) {
    let next = 1, chars = 0, lastUpdate = -Infinity, lastNotifiedRevision = job.index.revision;
    const maxChars = limits.maxChars ?? 8 * 1024 * 1024, maxLines = limits.maxLines ?? 2e5;
    const valid = () => active && current === job && generation === epoch && !job.abort.signal.aborted;
    const refresh = async (final = false) => {
      if (!valid() || job.index.revision === lastNotifiedRevision) return;
      const remaining = 250 - (Date.now() - lastUpdate);
      if (remaining > 0) {
        if (!final) return;
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(pending);
            job.abort.signal.removeEventListener("abort", done);
            resolve();
          };
          const pending = setTimeout(done, remaining);
          job.abort.signal.addEventListener("abort", done, { once: true });
        });
      }
      if (!valid() || job.index.revision === lastNotifiedRevision) return;
      const revision = job.index.revision;
      lastUpdate = Date.now();
      try {
        await host.invalidatePresentation({
          documentId: job.documentId,
          version: job.version,
          rendererId: "footnotes"
        });
        if (valid()) lastNotifiedRevision = revision;
      } catch {
      }
    };
    try {
      while (valid()) {
        if (next > maxLines || chars + 131072 > maxChars) {
          job.index.limit("scan-limit");
          break;
        }
        const page = await host.readWindow(
          {
            documentId: job.documentId,
            version: job.version,
            fromLine: next,
            lineCount: Math.min(256, maxLines - next + 1)
          },
          { signal: job.abort.signal }
        );
        if (!valid()) return;
        if (page.documentId !== job.documentId || page.version !== job.version || page.fromLine !== next || page.toLine < next || page.lines.length !== page.toLine - page.fromLine + 1)
          throw new Error("stale");
        chars += page.text.length;
        if (chars > maxChars) {
          job.index.limit("scan-limit");
          break;
        }
        for (const line of page.lines) job.index.consume(line);
        next = page.toLine + 1;
        if (page.completeEnd) {
          job.index.finish();
          break;
        }
        if (job.index.partialReason) break;
        await refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (!valid()) return;
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unavailable";
      job.index.limit(code);
    }
    await refresh(true);
  }
  return {
    render(request, options) {
      if (!active || options.signal.aborted) return { fragments: [], complete: false };
      if (!current || current.documentId !== request.documentId || current.version !== request.version) {
        stop();
        const job = {
          documentId: request.documentId,
          version: request.version,
          index: new FootnoteIndex(),
          abort: new AbortController()
        };
        current = job;
        const epoch = generation;
        timer = setTimeout(() => {
          timer = void 0;
          void scan(job, epoch);
        }, limits.delayMs ?? 80);
      }
      return present(request, current.index);
    },
    dispose() {
      if (!active) return;
      active = false;
      stop();
      current = void 0;
    }
  };
}

// packages/core/src/position/range.ts
function assertValidRange(range2, length2) {
  if (!Number.isInteger(range2.from) || !Number.isInteger(range2.to)) {
    throw new RangeError(`Range offsets must be integers: ${range2.from}-${range2.to}`);
  }
  if (range2.from < 0 || range2.to < range2.from) {
    throw new RangeError(`Invalid range: ${range2.from}-${range2.to}`);
  }
  if (length2 !== void 0 && range2.to > length2) {
    throw new RangeError(`Range ${range2.from}-${range2.to} exceeds document length ${length2}`);
  }
}

// packages/core/src/actions/builtin.ts
var openFileAction = {
  id: "file.open",
  title: "Open File",
  category: "file",
  permissions: ["file:read"],
  risk: "safe",
  inputSchema: filePathInputSchema(false),
  run: () => {
    throw new Error("file.open requires a host file adapter");
  }
};
var saveFileAsAction = {
  id: "file.saveAs",
  title: "Save File As",
  category: "file",
  permissions: ["file:write"],
  risk: "write",
  inputSchema: filePathInputSchema(false),
  run: () => {
    throw new Error("file.saveAs requires a host file adapter");
  }
};
function filePathInputSchema(required) {
  return {
    type: "object",
    properties: {
      path: { type: "string", required }
    }
  };
}

// packages/core/src/text/document.ts
var MemoryTextDocument = class _MemoryTextDocument {
  text;
  length;
  lineCount;
  lineStarts;
  constructor(text3 = "") {
    this.text = text3;
    this.length = text3.length;
    this.lineStarts = Object.freeze([...computeLineStarts(text3)]);
    this.lineCount = this.lineStarts.length;
    Object.freeze(this);
  }
  slice(from, to) {
    assertValidRange({ from, to }, this.length);
    return this.text.slice(from, to);
  }
  lineAt(pos) {
    if (!Number.isInteger(pos) || pos < 0 || pos > this.length) {
      throw new RangeError(`Invalid document position: ${pos}`);
    }
    const lineIndex = findLineIndex(this.lineStarts, pos);
    return this.line(lineIndex + 1);
  }
  line(number2) {
    if (!Number.isInteger(number2) || number2 < 1 || number2 > this.lineCount) {
      throw new RangeError(`Invalid line number: ${number2}`);
    }
    const index = number2 - 1;
    const from = this.lineStarts[index];
    if (from === void 0) {
      throw new RangeError(`Invalid line number: ${number2}`);
    }
    const nextLineStart = this.lineStarts[index + 1];
    const rawTo = nextLineStart === void 0 ? this.length : nextLineStart - 1;
    const to = rawTo > from && this.text.charCodeAt(rawTo - 1) === 13 ? rawTo - 1 : rawTo;
    return {
      number: number2,
      from,
      to,
      text: this.text.slice(from, to)
    };
  }
  apply(changes) {
    if (changes.empty) {
      return this;
    }
    let next = "";
    let offset = 0;
    for (const change of changes.changes) {
      assertValidRange(change, this.length);
      next += this.text.slice(offset, change.from);
      next += change.insert;
      offset = change.to;
    }
    next += this.text.slice(offset);
    return new _MemoryTextDocument(next);
  }
};
function computeLineStarts(text3) {
  const starts = [0];
  for (let index = 0; index < text3.length; index += 1) {
    if (text3.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}
function findLineIndex(lineStarts, pos) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    if (start === void 0) {
      break;
    }
    if (start === pos) {
      return mid;
    }
    if (start < pos) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, low - 1);
}

// packages/core/src/store/editor-document-source.ts
var MemoryDocumentSource = class {
  documentId;
  document;
  sourceVersion;
  constructor(config) {
    this.documentId = config.documentId;
    this.document = config.document ?? new MemoryTextDocument(config.text ?? "");
    this.sourceVersion = config.version ?? 0;
  }
  get version() {
    return this.sourceVersion;
  }
  get lineCount() {
    return this.document.lineCount;
  }
  get length() {
    return this.document.length;
  }
  async readLineWindow(fromLine, toLine, maxTextLength) {
    assertValidLineWindow(fromLine, toLine, this.document.lineCount);
    const start = this.document.line(fromLine).from;
    const end = this.document.line(toLine).to;
    if (maxTextLength !== void 0 && end - start > maxTextLength)
      throw new RangeError("Line window exceeds text budget");
    const lines = [];
    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      lines.push(this.document.line(lineNumber));
    }
    const first = lines[0];
    const last = lines.at(-1);
    if (!first || !last) {
      throw new RangeError(`Invalid line window: ${fromLine}-${toLine}`);
    }
    return Object.freeze({
      fromLine,
      toLine,
      from: first.from,
      to: last.to,
      text: this.document.slice(first.from, last.to),
      lines: Object.freeze(lines.map(freezeLine))
    });
  }
  async lineAtPosition(position) {
    return freezeLine(this.document.lineAt(position));
  }
  async positionAtLineOffset(lineNumber, offset) {
    const line = this.document.line(lineNumber);
    return line.from + clamp(Math.floor(offset), 0, line.to - line.from);
  }
  snapshot() {
    return Object.freeze({
      documentId: this.documentId,
      version: this.version,
      lineCount: this.lineCount,
      length: this.length
    });
  }
};
function assertValidLineWindow(fromLine, toLine, lineCount) {
  if (!Number.isInteger(fromLine) || !Number.isInteger(toLine) || fromLine < 1 || toLine < fromLine || toLine > lineCount) {
    throw new RangeError(`Invalid line window: ${fromLine}-${toLine}`);
  }
}
function freezeLine(line) {
  return Object.freeze({
    number: line.number,
    from: line.from,
    to: line.to,
    text: line.text
  });
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// packages/core/src/store/large-file-policy.ts
var MIB = 1024 * 1024;
var GIB = 1024 * MIB;
var DEFAULT_DOCUMENT_SCALE_THRESHOLDS = Object.freeze({
  performanceBytes: 128 * 1024
});

// packages/core/src/document-svg-image-geometry.ts
var IDENTITY = [1, 0, 0, 1, 0, 0];
var EMPTY_BOX = [0, 0, 0, 0];
var MAX_ENVELOPE_COORDINATE = 32768;
var MAX_DEPTH = 64;
var MAX_FONT_SIZE = 512;
var MAX_GLYPH_PIXELS = 2048;
var MAX_STROKE_WIDTH = 8192;
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}
function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
function pointBounds(x, y) {
  return [x, y, x, y];
}
function inflate(box2, x, y = x) {
  return box2 ? [box2[0] - x, box2[1] - y, box2[2] + x, box2[3] + y] : null;
}
function transformBounds(box2, matrix) {
  if (!box2) return null;
  let result = null;
  for (const x of [box2[0], box2[2]]) {
    for (const y of [box2[1], box2[3]]) {
      result = union(
        result,
        pointBounds(
          matrix[0] * x + matrix[2] * y + matrix[4],
          matrix[1] * x + matrix[3] * y + matrix[5]
        )
      );
    }
  }
  return result;
}
function trig(degrees) {
  const radians = degrees * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians)];
}
function transformMatrix(transform2) {
  switch (transform2.kind) {
    case "matrix":
      return transform2.values;
    case "translate":
      return [1, 0, 0, 1, transform2.x, transform2.y];
    case "scale":
      return [transform2.x, 0, 0, transform2.y, 0, 0];
    case "rotate": {
      const [cos, sin] = trig(transform2.degrees);
      return multiply(
        multiply([1, 0, 0, 1, transform2.cx, transform2.cy], [cos, sin, -sin, cos, 0, 0]),
        [1, 0, 0, 1, -transform2.cx, -transform2.cy]
      );
    }
    case "skewX":
      return [1, 0, Math.tan(transform2.degrees * Math.PI / 180), 1, 0, 0];
    case "skewY":
      return [1, Math.tan(transform2.degrees * Math.PI / 180), 0, 1, 0, 0];
  }
}
function viewportMatrix(box2, width, height, aspect = { align: "xMidYMid", fit: "meet" }) {
  const [x, y, viewWidth, viewHeight] = box2;
  const sx = width / viewWidth;
  const sy = height / viewHeight;
  if (aspect.align === "none") return [sx, 0, 0, sy, -x * sx, -y * sy];
  const scale = aspect.fit === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
  const ax = aspect.align.includes("xMin") ? 0 : aspect.align.includes("xMax") ? 1 : 0.5;
  const ay = aspect.align.includes("YMin") ? 0 : aspect.align.includes("YMax") ? 1 : 0.5;
  return [
    scale,
    0,
    0,
    scale,
    (width - viewWidth * scale) * ax - x * scale,
    (height - viewHeight * scale) * ay - y * scale
  ];
}
function arcBounds(x, y, rx0, ry0, degrees, endX, endY) {
  if (!rx0 || !ry0 || x === endX && y === endY)
    return union(pointBounds(x, y), pointBounds(endX, endY));
  const [cos, sin] = trig(degrees);
  const dx = (x - endX) / 2;
  const dy = (y - endY) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const factor = Math.max(1, Math.hypot(xp / rx0, yp / ry0));
  const rx = rx0 * factor;
  const ry = ry0 * factor;
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const numerator = Math.max(0, rx * rx * ry * ry - denominator);
  const coefficient = denominator ? Math.sqrt(numerator / denominator) : 0;
  const cxp = coefficient * rx * yp / ry;
  const cyp = -coefficient * ry * xp / rx;
  const ux = cos * cxp - sin * cyp;
  const uy = sin * cxp + cos * cyp;
  const mx = (x + endX) / 2;
  const my = (y + endY) / 2;
  const bx = Math.hypot(rx * cos, ry * sin);
  const by = Math.hypot(rx * sin, ry * cos);
  return union(
    [mx + ux - bx, my + uy - by, mx + ux + bx, my + uy + by],
    [mx - ux - bx, my - uy - by, mx - ux + bx, my - uy + by]
  );
}
function pathBounds(commands) {
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let previous = "";
  let control = null;
  let result = null;
  const add = (px, py) => {
    result = union(result, pointBounds(px, py));
  };
  for (const command of commands) {
    const operation = command[0].toUpperCase();
    const relative = operation !== command[0];
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command[0]) {
      case "Z":
      case "z":
        x = startX;
        y = startY;
        control = null;
        break;
      case "H":
      case "h":
        x = command[1] + ox;
        control = null;
        break;
      case "V":
      case "v":
        y = command[1] + oy;
        control = null;
        break;
      case "M":
      case "m":
      case "L":
      case "l":
        x = command[1] + ox;
        y = command[2] + oy;
        control = null;
        if (operation === "M") {
          startX = x;
          startY = y;
        }
        break;
      case "C":
      case "c":
        add(command[1] + ox, command[2] + oy);
        control = [command[3] + ox, command[4] + oy];
        add(control[0], control[1]);
        x = command[5] + ox;
        y = command[6] + oy;
        break;
      case "S":
      case "s": {
        const reflected = (previous === "C" || previous === "S") && control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
        add(reflected[0], reflected[1]);
        control = [command[1] + ox, command[2] + oy];
        add(control[0], control[1]);
        x = command[3] + ox;
        y = command[4] + oy;
        break;
      }
      case "Q":
      case "q":
        control = [command[1] + ox, command[2] + oy];
        add(control[0], control[1]);
        x = command[3] + ox;
        y = command[4] + oy;
        break;
      case "T":
      case "t": {
        const reflected = (previous === "Q" || previous === "T") && control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
        add(reflected[0], reflected[1]);
        control = reflected;
        x = command[1] + ox;
        y = command[2] + oy;
        break;
      }
      case "A":
      case "a": {
        const endX = command[6] + ox;
        const endY = command[7] + oy;
        result = union(result, arcBounds(x, y, command[1], command[2], command[3], endX, endY));
        x = endX;
        y = endY;
        control = null;
        break;
      }
    }
    add(x, y);
    previous = operation;
  }
  return result;
}
function documentSvgMarkerInstances(node3) {
  let vertices = 0;
  if (node3.kind === "line") vertices = 2;
  else if (node3.kind === "polyline" || node3.kind === "polygon") {
    vertices = node3.points?.length ?? 0;
    if (node3.kind === "polygon" && vertices > 0) vertices += 1;
  } else if (node3.kind === "path") {
    let active = false;
    for (const command of node3.commands ?? []) {
      const operation = command[0].toUpperCase();
      if (operation === "M") {
        vertices += 1;
        active = true;
      } else {
        if (!active) vertices += 1;
        vertices += 1;
        active = operation !== "Z";
      }
    }
  }
  const endpoint = vertices > 0 ? 1 : 0;
  return { markerStart: endpoint, markerMid: Math.max(0, vertices - 2), markerEnd: endpoint };
}
var INHERITED_KEYS = [
  "shapeRendering",
  "fill",
  "stroke",
  "fillOpacity",
  "strokeOpacity",
  "fillRule",
  "clipRule",
  "strokeWidth",
  "dashArray",
  "dashOffset",
  "lineCap",
  "lineJoin",
  "miterLimit",
  "visibility",
  "fontId",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "wordSpacing",
  "textAnchor",
  "dominantBaseline",
  "alignmentBaseline",
  "decoration",
  "whiteSpace",
  "textTransform"
];
function inheritProperty(target, source, key) {
  const value = source[key];
  if (value !== void 0) target[key] = value;
}
function cssLength(length2, font, basis) {
  if (length2.unit === "em") return length2.value * font;
  if (length2.unit === "percent") return length2.value * basis / 100;
  return length2.value;
}
function pixelArea(box2) {
  return box2 ? Math.max(0, Math.ceil(box2[2]) - Math.floor(box2[0])) * Math.max(0, Math.ceil(box2[3]) - Math.floor(box2[1])) : 0;
}
function maximumScale(matrix) {
  const norm1 = Math.max(
    Math.abs(matrix[0]) + Math.abs(matrix[1]),
    Math.abs(matrix[2]) + Math.abs(matrix[3])
  );
  const normInfinity = Math.max(
    Math.abs(matrix[0]) + Math.abs(matrix[2]),
    Math.abs(matrix[1]) + Math.abs(matrix[3])
  );
  return Math.sqrt(norm1 * normInfinity);
}
function requiresCompositing(style) {
  return style.opacity !== void 0 && style.opacity < 1 || style.mixBlendMode !== void 0 && style.mixBlendMode !== "normal" || style.isolation === "isolate";
}
function validateGeometryCost(image2, budget, limits, fail2) {
  const definitions = new Map(image2.definitions.map((definition3) => [definition3.id, definition3]));
  const invalid = (reason) => fail2(reason, "limit-exceeded");
  const unsupported = (reason) => fail2(reason, "unsupported-feature");
  function definition2(id2, kind) {
    const found = definitions.get(id2);
    if (!found || found.kind !== kind)
      fail2("missing or mismatched geometry definition", "invalid-output");
    return found;
  }
  function checkMatrix(matrix) {
    if (matrix.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_ENVELOPE_COORDINATE))
      invalid("composed viewport/transform");
  }
  function checkBounds(box2) {
    if (box2?.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_ENVELOPE_COORDINATE))
      invalid("geometry envelope");
  }
  function work(surface, blur = 0, instances = 1) {
    if (!Number.isFinite(surface) || surface < 0 || surface > limits.surfacePixels)
      invalid("intermediate surface");
    budget.work += instances * surface * (1 + blur / 4);
    if (!Number.isFinite(budget.work) || budget.work > limits.filterWork)
      invalid("aggregate render work");
  }
  const rootMap = viewportMatrix(image2.viewBox, image2.width, image2.height, image2.aspect);
  checkMatrix(rootMap);
  const [rasterX, rasterY, rasterWidth, rasterHeight] = image2.rasterBounds;
  work(
    (Math.ceil(rasterX + rasterWidth) - Math.floor(rasterX)) * (Math.ceil(rasterY + rasterHeight) - Math.floor(rasterY))
  );
  function styleFor(node3, parent, viewport) {
    const own = "style" in node3 && node3.style !== void 0 ? image2.styles[node3.style] : {};
    if (!own) fail2("missing geometry style", "invalid-output");
    const inherited = {};
    for (const key of INHERITED_KEYS) inheritProperty(inherited, parent.style, key);
    const style = { ...inherited, ...own };
    const font = node3.kind === "textBox" ? node3.fontSizePx : own.fontSize ? cssLength(own.fontSize, parent.font, parent.font) : parent.font;
    if (!Number.isFinite(font) || font < 0 || font > MAX_FONT_SIZE) invalid("resolved font size");
    const diagonal = Math.hypot(viewport[2], viewport[3]) / Math.SQRT2;
    const stroke = style.strokeWidth ? cssLength(style.strokeWidth, font, diagonal) : 1;
    if (!Number.isFinite(stroke) || stroke < 0 || stroke > MAX_STROKE_WIDTH)
      invalid("resolved stroke width");
    return { style, own, font, stroke };
  }
  function textStyles(node3, context, viewport, world) {
    for (const child of node3.children) {
      if (child.kind !== "tspan") continue;
      const next = styleFor(child, context, viewport);
      if (next.font * maximumScale(world) > MAX_GLYPH_PIXELS) invalid("tspan glyph pixel size");
      if (child.transforms?.length || child.transformOrigin || next.own.filter && next.own.filter.kind !== "none" || next.own.clipPath || requiresCompositing(next.own))
        unsupported("tspan geometry-dependent effects require text metrics");
      textStyles(child, next, viewport, world);
    }
  }
  function visit(node3, parent, viewport, world, depth = 1, instances = 1) {
    if (depth > MAX_DEPTH) invalid("geometry depth");
    const context = styleFor(node3, parent, viewport);
    const style = context.style;
    let baseLocal = IDENTITY;
    if ("transforms" in node3) {
      for (const transform2 of node3.transforms ?? [])
        baseLocal = multiply(baseLocal, transformMatrix(transform2));
    }
    const childWorld = multiply(world, baseLocal);
    checkMatrix(childWorld);
    let fill = null;
    let ink = null;
    let uncertain = false;
    let paintUncertain = false;
    const add = (result) => {
      fill = union(fill, result.fill);
      ink = union(ink, result.ink);
      uncertain ||= result.uncertain;
      paintUncertain ||= result.paintUncertain;
    };
    switch (node3.kind) {
      case "rect":
        fill = [node3.x, node3.y, node3.x + node3.width, node3.y + node3.height];
        break;
      case "circle":
        fill = [node3.cx - node3.r, node3.cy - node3.r, node3.cx + node3.r, node3.cy + node3.r];
        break;
      case "ellipse":
        fill = [node3.cx - node3.rx, node3.cy - node3.ry, node3.cx + node3.rx, node3.cy + node3.ry];
        break;
      case "line":
        fill = union(pointBounds(node3.x1, node3.y1), pointBounds(node3.x2, node3.y2));
        break;
      case "path":
        fill = pathBounds(node3.commands);
        break;
      case "polyline":
      case "polygon":
        for (const point of node3.points) fill = union(fill, pointBounds(point[0], point[1]));
        break;
      case "text":
        uncertain = true;
        paintUncertain = true;
        textStyles(node3, context, viewport, childWorld);
        break;
      case "textBox":
        uncertain = true;
        paintUncertain = true;
        fill = [node3.box[0], node3.box[1], node3.box[0] + node3.box[2], node3.box[1] + node3.box[3]];
        break;
    }
    if (fill) {
      const strokePresent = style.stroke && style.stroke.kind !== "none";
      const join = style.lineJoin === "miter" || style.lineJoin === void 0 ? style.miterLimit ?? 4 : 1;
      ink = inflate(fill, strokePresent ? context.stroke / 2 * join : 0);
    }
    if (node3.kind === "use") {
      const symbol = definition2(node3.ref, "symbol");
      const width = node3.width ?? symbol.width ?? viewport[2];
      const height = node3.height ?? symbol.height ?? viewport[3];
      if (symbol.viewBox && (symbol.viewBox[2] <= 0 || symbol.viewBox[3] <= 0))
        invalid("symbol viewBox");
      const mapping = symbol.viewBox ? viewportMatrix(symbol.viewBox, width, height) : IDENTITY;
      const local2 = multiply([1, 0, 0, 1, node3.x ?? 0, node3.y ?? 0], mapping);
      const transformedWorld = multiply(childWorld, local2);
      checkMatrix(transformedWorld);
      const result = visit(
        symbol,
        context,
        symbol.viewBox ?? viewport,
        transformedWorld,
        depth + 1,
        instances
      );
      add({
        fill: transformBounds(result.fill, local2),
        ink: transformBounds(result.ink, local2),
        uncertain: result.uncertain,
        paintUncertain: result.paintUncertain
      });
    }
    if (node3.kind === "group" || node3.kind === "symbol" || node3.kind === "marker" || node3.kind === "clipPath") {
      for (const child of node3.children)
        add(visit(child, context, viewport, childWorld, depth + 1, instances));
    }
    if (node3.kind === "textAlternative") {
      add(visit(node3.primary, context, viewport, childWorld, depth + 1, instances));
      add(visit(node3.fallback, context, viewport, childWorld, depth + 1, instances));
    }
    if (node3.kind === "line" || node3.kind === "path" || node3.kind === "polyline" || node3.kind === "polygon") {
      const multiplicity = documentSvgMarkerInstances(node3);
      for (const key of ["markerStart", "markerMid", "markerEnd"]) {
        const id2 = node3[key];
        if (!id2 || multiplicity[key] === 0) continue;
        const marker = definition2(id2, "marker");
        const markerViewport = marker.viewBox ?? [0, 0, marker.width, marker.height];
        const markerContext = styleFor(marker, rootContext, markerViewport);
        const unit = marker.units === "strokeWidth" ? context.stroke : 1;
        const mapping = marker.viewBox ? viewportMatrix(marker.viewBox, marker.width, marker.height) : IDENTITY;
        const markerScale = unit * maximumScale(mapping) * Math.SQRT2;
        const markerWorld = multiply(childWorld, [markerScale, 0, 0, markerScale, 0, 0]);
        checkMatrix(markerWorld);
        const result = visit(
          marker,
          rootContext,
          markerViewport,
          markerWorld,
          depth + 1,
          instances * multiplicity[key]
        );
        if (result.uncertain) unsupported("marker text bounds unavailable");
        const mapped = transformBounds(result.ink, mapping);
        const refX = cssLength(marker.refX, markerContext.font, markerViewport[2]);
        const refY = cssLength(marker.refY, markerContext.font, markerViewport[3]);
        const reference = transformBounds(pointBounds(refX, refY), mapping);
        if (!reference) return unsupported("empty marker reference");
        let radius = 0;
        if (mapped) {
          for (const x of [mapped[0], mapped[2]]) {
            for (const y of [mapped[1], mapped[3]])
              radius = Math.max(radius, Math.hypot(x - reference[0], y - reference[1]) * unit);
          }
        }
        ink = union(ink, inflate(fill, radius));
      }
    }
    let local = baseLocal;
    if ("transformOrigin" in node3 && node3.transformOrigin) {
      const kind = node3.transformBox ?? "view-box";
      if (uncertain && kind !== "view-box") unsupported("text bbox-dependent transform origin");
      const reference = kind === "view-box" ? [
        viewport[0],
        viewport[1],
        viewport[0] + viewport[2],
        viewport[1] + viewport[3]
      ] : kind === "stroke-box" ? ink : fill;
      if (!reference) return unsupported("empty geometry transform origin");
      const x = reference[0] + cssLength(node3.transformOrigin[0], context.font, reference[2] - reference[0]);
      const y = reference[1] + cssLength(node3.transformOrigin[1], context.font, reference[3] - reference[1]);
      local = multiply(multiply([1, 0, 0, 1, x, y], local), [1, 0, 0, 1, -x, -y]);
    }
    const total = multiply(world, local);
    checkMatrix(total);
    checkBounds(transformBounds(ink, total));
    if (uncertain && context.font * maximumScale(total) > MAX_GLYPH_PIXELS)
      invalid("resolved glyph pixel size");
    const filter2 = context.own.filter;
    if (filter2 && filter2.kind !== "none") {
      const definitionFilter = filter2.kind === "definition" ? definition2(filter2.ref, "dropShadowFilter") : void 0;
      const boundedIdentity = definitionFilter?.units === "userSpaceOnUse" && definitionFilter.primitiveUnits === "userSpaceOnUse" && definitionFilter.colorInterpolation === "sRGB" && definitionFilter.dx === 0 && definitionFilter.dy === 0 && definitionFilter.stdDeviation[0] === 0 && definitionFilter.stdDeviation[1] === 0 && definitionFilter.color[3] === 0;
      if (uncertain && !boundedIdentity)
        unsupported("text bbox-dependent filter requires trusted metrics");
      if (filter2.kind === "unresolved-local") {
        work(pixelArea(transformBounds(ink, total)), 0, instances);
      } else if (filter2.kind === "cssDropShadow") {
        let output = ink;
        for (const shadow of filter2.shadows) {
          const envelope = inflate(output, 3 * shadow.blur);
          const shifted = envelope ? [
            envelope[0] + shadow.dx,
            envelope[1] + shadow.dy,
            envelope[2] + shadow.dx,
            envelope[3] + shadow.dy
          ] : null;
          output = union(output, shifted);
          checkBounds(transformBounds(output, total));
          work(
            pixelArea(transformBounds(output, total)),
            shadow.blur * maximumScale(total),
            instances
          );
        }
        ink = output;
      } else {
        if (!definitionFilter) return unsupported("missing geometry filter definition");
        const bounds = fill ?? EMPTY_BOX;
        const width = bounds[2] - bounds[0];
        const height = bounds[3] - bounds[1];
        const objectUnits = definitionFilter.units === "objectBoundingBox";
        const resolve = (length2, axis, size) => objectUnits ? (length2.unit === "percent" ? length2.value / 100 : length2.value) * size : cssLength(length2, context.font, axis);
        if (objectUnits && definitionFilter.region.some(
          (length2) => length2.unit !== "user" && length2.unit !== "percent"
        ))
          unsupported("objectBoundingBox length unit");
        const x = resolve(definitionFilter.region[0], viewport[2], width) + (objectUnits ? bounds[0] : 0);
        const y = resolve(definitionFilter.region[1], viewport[3], height) + (objectUnits ? bounds[1] : 0);
        const rw = resolve(definitionFilter.region[2], viewport[2], width);
        const rh = resolve(definitionFilter.region[3], viewport[3], height);
        const region = [x, y, x + rw, y + rh];
        const bx = definitionFilter.stdDeviation[0] * (definitionFilter.primitiveUnits === "objectBoundingBox" ? width : 1);
        const by = definitionFilter.stdDeviation[1] * (definitionFilter.primitiveUnits === "objectBoundingBox" ? height : 1);
        if (Math.max(bx, by) > limits.blur) invalid("resolved filter blur");
        checkBounds(transformBounds(region, total));
        work(
          pixelArea(transformBounds(region, total)),
          Math.max(bx, by) * maximumScale(total),
          instances
        );
        const envelope = objectUnits ? inflate(bounds, Math.abs(x - bounds[0]) + rw, Math.abs(y - bounds[1]) + rh) : region;
        checkBounds(transformBounds(envelope, total));
        if (boundedIdentity) {
          ink = region;
          paintUncertain = false;
        } else {
          ink = union(ink, envelope);
        }
      }
    }
    if (requiresCompositing(context.own)) {
      if (paintUncertain) unsupported("text bbox-dependent compositing requires trusted metrics");
      work(pixelArea(transformBounds(ink, total)), 0, instances);
    }
    if (context.own.clipPath) {
      const clip = definition2(context.own.clipPath, "clipPath");
      if (uncertain && clip.units === "objectBoundingBox") unsupported("text bbox-dependent clip");
      const bounds = fill ?? EMPTY_BOX;
      const mapping = clip.units === "objectBoundingBox" ? [bounds[2] - bounds[0], 0, 0, bounds[3] - bounds[1], bounds[0], bounds[1]] : IDENTITY;
      const clipWorld = multiply(total, mapping);
      checkMatrix(clipWorld);
      visit(clip, context, viewport, clipWorld, depth + 1, instances);
    }
    return {
      fill: transformBounds(fill, local),
      ink: transformBounds(ink, local),
      uncertain,
      paintUncertain
    };
  }
  const defaults = { style: { fontId: "sans" }, own: {}, font: 16, stroke: 1 };
  const root = {
    kind: "group",
    ...image2.rootStyle === void 0 ? {} : { style: image2.rootStyle },
    children: image2.children
  };
  const rootContext = styleFor(root, defaults, image2.viewBox);
  visit(root, defaults, image2.viewBox, rootMap);
}

// packages/core/src/document-svg-image-codec.ts
var LIMITS = Object.freeze({
  bytes: 262144,
  nodes: 4096,
  depth: 64,
  images: 128,
  coordinate: 8192,
  surfacePixels: 16777216,
  filterWork: 268435456,
  blur: 32
});
var SvgProfileError = class extends Error {
  constructor(code, reason) {
    super(reason);
    this.code = code;
    this.name = "SvgProfileError";
    this.code = code;
  }
};
function fail(reason, code = "invalid-output") {
  throw new SvgProfileError(code, reason);
}
var coord = (v) => finite(v, -8192, 8192);
function finite(v, min = -8192, max = 8192) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail("number domain");
  return Object.is(v, -0) ? 0 : v;
}
function choice(values) {
  return (v) => {
    if (!values.includes(v)) fail("enum");
    return v;
  };
}
var integer = (v, min, max) => {
  const n = finite(v, min, max);
  if (!Number.isSafeInteger(n)) fail("integer");
  return n;
};
var fonts = [
  "sans",
  "arial-sans",
  "open-sans-sans",
  "trebuchet-verdana-arial-sans",
  "serif",
  "monospace"
];
var fontCss = {
  sans: "sans-serif",
  "arial-sans": "Arial, sans-serif",
  "open-sans-sans": '"Open Sans", sans-serif',
  "trebuchet-verdana-arial-sans": '"Trebuchet MS", Verdana, Arial, sans-serif',
  serif: "serif",
  monospace: "monospace"
};
function createDocumentOutputBudget() {
  return { nodes: 0, text: 0, expanded: 0, work: 0, canonicalBytes: 0 };
}
function charge(b, d, n = 1) {
  if (d > 64 || (b.nodes += n) > 4096) fail("node/depth budget", "limit-exceeded");
}
function plain(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("plain object required");
  const p = Object.getPrototypeOf(v);
  if (p !== Object.prototype && p !== null) fail("prototype");
  const ds = Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(ds).some((k) => typeof k !== "string" || !("value" in ds[k])))
    fail("accessor/symbol");
  return Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, d.value]));
}
function object(v, required, optional, b, d) {
  if (d > 64) fail("depth", "limit-exceeded");
  const p = plain(v), allowed = /* @__PURE__ */ new Set([...Object.keys(required), ...Object.keys(optional)]);
  for (const k of Object.keys(p))
    if (!allowed.has(k)) {
      if (/^(animation|transition)/i.test(k))
        fail("effective motion not admitted", "unsupported-animation");
      fail("unknown field " + k);
    }
  const out = {};
  for (const [k, parse] of Object.entries(required)) {
    if (!Object.hasOwn(p, k)) fail("missing " + k);
    out[k] = parse(p[k], b, d + 1);
  }
  for (const [k, parse] of Object.entries(optional))
    if (Object.hasOwn(p, k)) out[k] = parse(p[k], b, d + 1);
  return out;
}
function array(v, parse, b, d, max = 4096) {
  if (d > 64 || !Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > max)
    fail("array/depth budget", "limit-exceeded");
  const keys = Reflect.ownKeys(v);
  if (keys.length !== v.length + 1 || keys.some((k) => typeof k !== "string" || k !== "length" && !/^(0|[1-9][0-9]*)$/.test(k)))
    fail("sparse/custom array");
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, String(i));
    if (!desc || !("value" in desc)) fail("array accessor");
    out.push(parse(desc.value, b, d + 1));
  }
  return out;
}
var list = (parse, max = 4096) => (v, b, d) => array(v, parse, b, d, max);
function tuple(v, parsers, b, d) {
  const out = array(v, (x) => x, b, d, parsers.length);
  if (out.length !== parsers.length) fail("tuple arity");
  return out.map((x, i) => parsers[i](x, b, d + 1));
}
function text2(v, b) {
  const max = 4096;
  if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(v))
    fail("text domain");
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c >= 55296 && c <= 56319) {
      const n = v.charCodeAt(++i);
      if (!(n >= 56320 && n <= 57343)) fail("unpaired surrogate");
    } else if (c >= 56320 && c <= 57343) fail("unpaired surrogate");
  }
  b.text += v.length;
  if (b.text > 262144) fail("text budget", "limit-exceeded");
  return v;
}
var id = (v) => {
  if (typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(v)) fail("local ID");
  return v;
};
var styleId = (v) => integer(v, 0, 4095);
var length = (v, b, d) => object(v, { value: coord, unit: choice(["user", "px", "em", "percent"]) }, {}, b, d);
var positiveLength = (v, b, d) => {
  const x = length(v, b, d);
  finite(x.value, 0, 8192);
  return x;
};
var rgba = (v, b, d) => tuple(
  v,
  [
    (x) => finite(x, 0, 255),
    (x) => finite(x, 0, 255),
    (x) => finite(x, 0, 255),
    (x) => finite(x, 0, 1)
  ],
  b,
  d
);
var box = (v, b, d) => tuple(v, [coord, coord, (x) => finite(x, 0, 8192), (x) => finite(x, 0, 8192)], b, d);
function transform(v, b, d) {
  charge(b, d);
  const p = plain(v);
  switch (p.kind) {
    case "matrix":
      return object(
        p,
        {
          kind: choice(["matrix"]),
          values: (x, b2, d2) => tuple(
            x,
            [
              (x2) => finite(x2, -64, 64),
              (x2) => finite(x2, -64, 64),
              (x2) => finite(x2, -64, 64),
              (x2) => finite(x2, -64, 64),
              coord,
              coord
            ],
            b2,
            d2
          )
        },
        {},
        b,
        d
      );
    case "translate":
      return object(p, { kind: choice(["translate"]), x: coord, y: coord }, {}, b, d);
    case "scale":
      return object(
        p,
        { kind: choice(["scale"]), x: (x) => finite(x, -64, 64), y: (x) => finite(x, -64, 64) },
        {},
        b,
        d
      );
    case "rotate":
      return object(
        p,
        {
          kind: choice(["rotate"]),
          degrees: (x) => finite(x, -36e4, 36e4),
          cx: coord,
          cy: coord
        },
        {},
        b,
        d
      );
    case "skewX":
    case "skewY":
      return object(
        p,
        { kind: choice(["skewX", "skewY"]), degrees: (x) => finite(x, -80, 80) },
        {},
        b,
        d
      );
    default:
      fail("transform kind");
  }
}
function paint(v, b, d) {
  const p = plain(v);
  if (p.kind === "none") return object(p, { kind: choice(["none"]) }, {}, b, d);
  if (p.kind === "color") return object(p, { kind: choice(["color"]), rgba }, {}, b, d);
  return object(p, { kind: choice(["gradient"]), ref: id }, {}, b, d);
}
function filter(v, b, d) {
  const p = plain(v);
  if (p.kind === "unresolved-local")
    return object(p, { kind: choice(["unresolved-local"]) }, {}, b, d);
  if (p.kind === "none") return object(p, { kind: choice(["none"]) }, {}, b, d);
  if (p.kind === "definition") return object(p, { kind: choice(["definition"]), ref: id }, {}, b, d);
  return object(
    p,
    {
      kind: choice(["cssDropShadow"]),
      shadows: list((v2, b2, d2) => {
        charge(b2, d2);
        return object(
          v2,
          { dx: coord, dy: coord, blur: (x) => finite(x, 0, 32), color: rgba },
          {},
          b2,
          d2
        );
      }, 4)
    },
    {},
    b,
    d
  );
}
var styleParsers = {
  shapeRendering: choice(["auto", "optimizeSpeed", "crispEdges", "geometricPrecision"]),
  fill: paint,
  stroke: paint,
  fillOpacity: (x) => finite(x, 0, 1),
  strokeOpacity: (x) => finite(x, 0, 1),
  opacity: (x) => finite(x, 0, 1),
  fillRule: choice(["nonzero", "evenodd"]),
  clipRule: choice(["nonzero", "evenodd"]),
  strokeWidth: positiveLength,
  dashArray: list((v, b, d) => {
    charge(b, d);
    return positiveLength(v, b, d);
  }, 4096),
  dashOffset: length,
  lineCap: choice(["butt", "round", "square"]),
  lineJoin: choice(["miter", "round", "bevel"]),
  miterLimit: (x) => finite(x, 1, 64),
  display: choice(["inline", "none"]),
  visibility: choice(["visible", "hidden", "collapse"]),
  overflow: choice(["visible", "hidden"]),
  mixBlendMode: choice(["normal", "multiply"]),
  isolation: choice(["auto", "isolate"]),
  filter,
  clipPath: id,
  colorInterpolation: choice(["sRGB", "linearRGB"]),
  colorInterpolationFilters: choice(["sRGB", "linearRGB"]),
  fontId: choice(fonts),
  fontSize: positiveLength,
  fontWeight: choice([100, 200, 300, 400, 500, 600, 700, 800, 900]),
  fontStyle: choice(["normal", "italic", "oblique"]),
  letterSpacing: length,
  wordSpacing: length,
  textAnchor: choice(["start", "middle", "end"]),
  dominantBaseline: choice([
    "auto",
    "alphabetic",
    "central",
    "middle",
    "hanging",
    "text-before-edge",
    "text-after-edge"
  ]),
  alignmentBaseline: choice([
    "auto",
    "baseline",
    "alphabetic",
    "central",
    "middle",
    "hanging",
    "before-edge",
    "after-edge"
  ]),
  decoration: choice(["none", "underline", "overline", "line-through"]),
  whiteSpace: choice(["normal", "pre", "pre-wrap", "nowrap"]),
  textTransform: choice(["none", "uppercase", "lowercase", "capitalize"])
};
var parseStyle = (v, b, d) => {
  charge(b, d);
  return object(v, {}, styleParsers, b, d);
};
var common = {
  style: styleId,
  transforms: list(transform, 64),
  transformOrigin: (v, b, d) => tuple(v, [length, length], b, d),
  transformBox: choice(["fill-box", "stroke-box", "view-box"]),
  title: text2,
  description: text2
};
var marked = { ...common, markerStart: id, markerMid: id, markerEnd: id };
var dimensions = {
  x: coord,
  y: coord,
  width: (x) => finite(x, 0, 8192),
  height: (x) => finite(x, 0, 8192)
};
var textFields = {
  x: list(length, 4096),
  y: list(length, 4096),
  dx: list(length, 4096),
  dy: list(length, 4096)
};
function pathCommand(v, b, d) {
  charge(b, d);
  const a = array(v, (x) => x, b, d, 8), op = a[0];
  const arities = {
    M: 2,
    L: 2,
    T: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    A: 7,
    Z: 0
  };
  const n = arities[typeof op === "string" ? op.toUpperCase() : ""];
  if (n === void 0 || typeof op !== "string" || op.length !== 1 || a.length !== n + 1)
    fail("path command/arity");
  const out = [op, ...a.slice(1).map(coord)];
  if (op.toUpperCase() === "A") {
    finite(out[1], 0, 8192);
    finite(out[2], 0, 8192);
    choice([0, 1])(out[4]);
    choice([0, 1])(out[5]);
  }
  return out;
}
function pathCommands(v, b, d) {
  const a = array(v, pathCommand, b, d);
  if (a.length && a[0][0].toUpperCase() !== "M") fail("path must begin with moveto");
  let open = false;
  for (const c of a) {
    const k = c[0].toUpperCase();
    if (k === "M") open = true;
    else if (!open) fail("path requires subpath");
  }
  return a;
}
function textChild(v, b, d) {
  const p = plain(v);
  if (p.kind === "textRun") {
    charge(b, d);
    return object(p, { kind: choice(["textRun"]), text: text2 }, {}, b, d);
  }
  return textNode(p, b, d, "tspan");
}
function textNode(v, b, d, kind = "text") {
  charge(b, d);
  return object(
    v,
    { kind: choice([kind]), children: list(textChild) },
    { ...common, ...textFields, xmlSpace: choice(["default", "preserve"]) },
    b,
    d
  );
}
function textBox(v, b, d) {
  charge(b, d);
  return object(
    v,
    {
      kind: choice(["textBox"]),
      box,
      text: text2,
      color: rgba,
      fontId: choice(fonts),
      fontSizePx: (x) => finite(x, 1, 512),
      fontWeight: choice([100, 200, 300, 400, 500, 600, 700, 800, 900]),
      fontStyle: choice(["normal", "italic", "oblique"]),
      lineHeight: (v2, b2, d2) => v2 === "normal" ? v2 : object(v2, { px: (x) => finite(x, 0, 1024) }, {}, b2, d2),
      hAlign: choice(["start", "center", "end"]),
      vAlign: choice(["top", "middle", "bottom"]),
      whiteSpace: choice(["normal", "pre", "pre-wrap", "nowrap"]),
      overflowWrap: choice(["normal", "break-word"]),
      wordBreak: choice(["normal", "break-all", "keep-all"])
    },
    {
      ...common,
      background: rgba,
      outerBoxSizing: choice(["content-box", "border-box"]),
      innerBoxSizing: choice(["content-box", "border-box"]),
      textTransform: styleParsers.textTransform,
      letterSpacing: length,
      wordSpacing: length,
      decoration: styleParsers.decoration
    },
    b,
    d
  );
}
function node(v, b, d) {
  const p = plain(v);
  if (p.kind === "text") return textNode(p, b, d);
  if (p.kind === "textBox") return textBox(p, b, d);
  charge(b, d);
  switch (p.kind) {
    case "group":
      return object(p, { kind: choice(["group"]), children: list(node) }, common, b, d);
    case "rect":
      return object(
        p,
        { kind: choice(["rect"]), ...dimensions },
        { ...common, rx: (x) => finite(x, 0, 8192), ry: (x) => finite(x, 0, 8192) },
        b,
        d
      );
    case "circle":
      return object(
        p,
        { kind: choice(["circle"]), cx: coord, cy: coord, r: (x) => finite(x, 0, 8192) },
        common,
        b,
        d
      );
    case "ellipse":
      return object(
        p,
        {
          kind: choice(["ellipse"]),
          cx: coord,
          cy: coord,
          rx: (x) => finite(x, 0, 8192),
          ry: (x) => finite(x, 0, 8192)
        },
        common,
        b,
        d
      );
    case "line":
      return object(
        p,
        { kind: choice(["line"]), x1: coord, y1: coord, x2: coord, y2: coord },
        marked,
        b,
        d
      );
    case "path":
      return object(p, { kind: choice(["path"]), commands: pathCommands }, marked, b, d);
    case "polygon":
    case "polyline":
      return object(
        p,
        {
          kind: choice(["polygon", "polyline"]),
          points: list((v2, b2, d2) => {
            charge(b2, d2);
            return tuple(v2, [coord, coord], b2, d2);
          })
        },
        marked,
        b,
        d
      );
    case "use":
      return object(p, { kind: choice(["use"]), ref: id }, { ...common, ...dimensions }, b, d);
    case "textAlternative":
      return object(
        p,
        {
          kind: choice(["textAlternative"]),
          primary: textBox,
          fallback: (v2, b2, d2) => textNode(v2, b2, d2)
        },
        common,
        b,
        d
      );
    default:
      fail("unsupported node kind", "unsupported-feature");
  }
}
var units = choice(["userSpaceOnUse", "objectBoundingBox"]);
function definition(v, b, d) {
  charge(b, d);
  const p = plain(v), base = { id };
  switch (p.kind) {
    case "clipPath":
      return object(
        p,
        { ...base, kind: choice(["clipPath"]), units, children: list(node) },
        { transforms: list(transform, 64) },
        b,
        d
      );
    case "marker":
      return object(
        p,
        {
          ...base,
          kind: choice(["marker"]),
          width: (x) => finite(x, 0, 8192),
          height: (x) => finite(x, 0, 8192),
          refX: length,
          refY: length,
          units: choice(["strokeWidth", "userSpaceOnUse"]),
          orient: (v2, b2, d2) => typeof v2 === "string" ? choice(["auto", "auto-start-reverse"])(v2) : object(v2, { degrees: (x) => finite(x, -36e4, 36e4) }, {}, b2, d2),
          children: list(node)
        },
        { viewBox: box, style: styleId },
        b,
        d
      );
    case "linearGradient":
      return object(
        p,
        {
          ...base,
          kind: choice(["linearGradient"]),
          units,
          x1: length,
          y1: length,
          x2: length,
          y2: length,
          spread: choice(["pad", "reflect", "repeat"]),
          stops: list((v2, b2, d2) => {
            charge(b2, d2);
            return object(v2, { offset: (x) => finite(x, 0, 1), color: rgba }, {}, b2, d2);
          }, 4096)
        },
        { transforms: list(transform, 64) },
        b,
        d
      );
    case "dropShadowFilter":
      return object(
        p,
        {
          ...base,
          kind: choice(["dropShadowFilter"]),
          units,
          primitiveUnits: units,
          region: (v2, b2, d2) => tuple(v2, [length, length, positiveLength, positiveLength], b2, d2),
          colorInterpolation: choice(["sRGB", "linearRGB"]),
          dx: coord,
          dy: coord,
          stdDeviation: (v2, b2, d2) => tuple(v2, [(x) => finite(x, 0, 32), (x) => finite(x, 0, 32)], b2, d2),
          color: rgba
        },
        {},
        b,
        d
      );
    case "symbol":
      return object(
        p,
        { ...base, kind: choice(["symbol"]), children: list(node) },
        {
          viewBox: box,
          width: (x) => finite(x, 0, 8192),
          height: (x) => finite(x, 0, 8192),
          style: styleId
        },
        b,
        d
      );
    default:
      fail("definition kind", "unsupported-feature");
  }
}
function image(v, b, d) {
  charge(b, d);
  charge(b, d + 2, 2);
  const p = object(
    v,
    {
      type: choice(["svg-image"]),
      profile: choice(["bounded-svg-v1"]),
      width: (x) => finite(x, 1, 8192),
      height: (x) => finite(x, 1, 8192),
      rasterBounds: box,
      viewBox: box,
      aspect: (v2, b2, d2) => object(
        v2,
        {
          align: choice([
            "none",
            "xMinYMin",
            "xMidYMin",
            "xMaxYMin",
            "xMinYMid",
            "xMidYMid",
            "xMaxYMid",
            "xMinYMax",
            "xMidYMax",
            "xMaxYMax"
          ]),
          fit: choice(["meet", "slice"])
        },
        {},
        b2,
        d2
      ),
      styles: list(parseStyle),
      definitions: list(definition),
      children: list(node),
      motion: (v2) => {
        if (v2 !== "static") fail("effective animation not supported", "unsupported-animation");
        return "static";
      }
    },
    { title: text2, description: text2, rootStyle: styleId },
    b,
    d
  );
  if (p.viewBox[2] <= 0 || p.viewBox[3] <= 0 || p.width * p.height > LIMITS.surfacePixels)
    fail("surface", "limit-exceeded");
  const [rasterX, rasterY, rasterWidth, rasterHeight] = p.rasterBounds;
  if (rasterWidth <= 0 || rasterHeight <= 0 || rasterX > 0 || rasterY > 0 || rasterX + rasterWidth < p.width || rasterY + rasterHeight < p.height)
    fail("raster region must contain the root viewport");
  const pixelWidth = Math.ceil(rasterX + rasterWidth) - Math.floor(rasterX);
  const pixelHeight = Math.ceil(rasterY + rasterHeight) - Math.floor(rasterY);
  if (pixelWidth > LIMITS.coordinate || pixelHeight > LIMITS.coordinate || pixelWidth * pixelHeight > LIMITS.surfacePixels)
    fail("raster surface", "limit-exceeded");
  function chargeGenerated(n, depth) {
    const generated = fixedElements(n);
    if (generated.count) charge(b, depth + generated.height - 1, generated.count);
    for (const child of childNodes(n)) chargeGenerated(child, depth + 1);
  }
  chargeGenerated(p, d + 1);
  for (const definition2 of p.definitions) chargeGenerated(definition2, d + 3);
  validateReferences(p, b, d + 2);
  if (b.nodes > 4096) fail("aggregate expanded nodes", "limit-exceeded");
  validateGeometryCost(p, b, LIMITS, fail);
  return p;
}
function childNodes(n) {
  return n.children ?? (n.kind === "textAlternative" ? [n.primary, n.fallback] : []);
}
function effectivePaint(n, img, inherited) {
  const own = n.style === void 0 ? {} : img.styles[n.style];
  if (!own) fail("style index");
  return {
    ...inherited,
    ...own.fill === void 0 ? {} : { fill: own.fill },
    ...own.stroke === void 0 ? {} : { stroke: own.stroke }
  };
}
function refsFor(n, img, effective) {
  const refs = [];
  if (n.kind === "use") refs.push([n.ref, "symbol", 1]);
  const markers = documentSvgMarkerInstances({
    kind: n.kind ?? "",
    ...n.commands ? { commands: n.commands } : {},
    ...n.points ? { points: n.points } : {}
  });
  for (const k of ["markerStart", "markerEnd", "markerMid"])
    if (n[k]) refs.push([n[k], "marker", markers[k]]);
  if (n.style !== void 0) {
    if (n.style >= img.styles.length) fail("style index");
    const own = img.styles[n.style];
    if (own.clipPath) refs.push([own.clipPath, "clipPath", 1]);
    if (own.filter?.kind === "definition") refs.push([own.filter.ref, "dropShadowFilter", 1]);
  }
  if (["rect", "circle", "ellipse", "line", "path", "polyline", "polygon", "textRun"].includes(
    n.kind ?? ""
  )) {
    for (const key of ["fill", "stroke"]) {
      if (key === "fill" && n.kind === "line") continue;
      const paint2 = effective[key];
      if (paint2?.kind === "gradient") refs.push([paint2.ref, "linearGradient", 1]);
    }
  }
  return refs;
}
function styleRefs(s) {
  const r = [];
  for (const k of ["fill", "stroke"]) {
    const paint2 = s[k];
    if (paint2?.kind === "gradient") r.push([paint2.ref, "linearGradient", 1]);
  }
  if (s.clipPath) r.push([s.clipPath, "clipPath", 1]);
  if (s.filter?.kind === "definition") r.push([s.filter.ref, "dropShadowFilter", 1]);
  return r;
}
function fixedElements(n) {
  const labels = Number(n.title !== void 0) + Number(n.description !== void 0);
  if (n.kind === "textBox") return { count: labels + 2, height: 3 };
  if (n.kind === "dropShadowFilter") return { count: labels + 1, height: 2 };
  return { count: labels, height: labels ? 2 : 1 };
}
function baseCost(n) {
  return 1 + fixedElements(n).count + (n.commands?.length ?? 0) + (n.points?.length ?? 0) + (n.transforms?.length ?? 0) + (n.stops?.length ?? 0);
}
function validateReferences(img, b, startingDepth) {
  const beforeExpanded = b.expanded;
  function structuralCost(n) {
    return baseCost(n) + childNodes(n).reduce((sum, child) => sum + structuralCost(child), 0);
  }
  const structural = img.definitions.reduce((sum, n) => sum + structuralCost(n), 0) + img.children.reduce((sum, n) => sum + structuralCost(n), 0);
  const defs = /* @__PURE__ */ new Map();
  for (const d of img.definitions) {
    if (defs.has(d.id)) fail("duplicate definition");
    defs.set(d.id, d);
  }
  const active = /* @__PURE__ */ new Set(), memo = /* @__PURE__ */ new Map();
  const check = (id2, kind) => {
    const d = defs.get(id2);
    if (!d || d.kind !== kind) fail("missing/wrong reference");
    return d;
  };
  for (const s of img.styles) for (const [id2, kind] of styleRefs(s)) check(id2, kind);
  if (img.rootStyle !== void 0 && img.rootStyle >= img.styles.length) fail("root style index");
  function cost(n, depth, inherited) {
    const effective = effectivePaint(n, img, inherited);
    if (depth > 64) fail("expanded depth", "limit-exceeded");
    let count2 = baseCost(n), height = fixedElements(n).height;
    for (const c of childNodes(n)) {
      const x = cost(c, depth + 1, effective);
      count2 += x.count;
      if (count2 > 4096) fail("expanded cost", "limit-exceeded");
      height = Math.max(height, 1 + x.height);
    }
    for (const [id2, kind, times] of refsFor(n, img, effective)) {
      check(id2, kind);
      const x = defCost(id2, depth + 1, kind === "marker" ? rootPaint : effective);
      count2 += x.count * times;
      if (count2 > 4096) fail("expanded cost", "limit-exceeded");
      height = Math.max(height, 1 + x.height);
    }
    if (count2 > 4096 || depth + height - 1 > 64) fail("expanded cost/depth", "limit-exceeded");
    return { count: count2, height };
  }
  function defCost(id2, depth, inherited) {
    const key = JSON.stringify([
      id2,
      inherited.fill?.kind === "gradient" ? inherited.fill.ref : null,
      inherited.stroke?.kind === "gradient" ? inherited.stroke.ref : null
    ]);
    if (depth > 64) fail("reference depth", "limit-exceeded");
    if (active.has(id2)) fail("reference cycle");
    const cached = memo.get(key);
    if (cached) {
      if (depth + cached.height - 1 > 64) fail("reference depth", "limit-exceeded");
      return cached;
    }
    active.add(id2);
    const c = cost(defs.get(id2), depth, inherited);
    active.delete(id2);
    memo.set(key, c);
    return c;
  }
  const rootStyle = img.rootStyle === void 0 ? {} : img.styles[img.rootStyle];
  const rootPaint = {
    ...rootStyle.fill === void 0 ? {} : { fill: rootStyle.fill },
    ...rootStyle.stroke === void 0 ? {} : { stroke: rootStyle.stroke }
  };
  const addExpanded = (count2) => {
    b.expanded += count2;
    if (b.expanded > 4096) fail("aggregate expansion", "limit-exceeded");
  };
  for (const d of img.definitions) addExpanded(defCost(d.id, startingDepth + 1, rootPaint).count);
  for (const n of img.children) addExpanded(cost(n, startingDepth + 1, rootPaint).count);
  if (img.rootStyle !== void 0)
    for (const [id2, kind] of styleRefs(img.styles[img.rootStyle]).filter(
      ([, kind2]) => kind2 !== "linearGradient"
    )) {
      check(id2, kind);
      addExpanded(defCost(id2, startingDepth + 1, rootPaint).count);
    }
  b.nodes += Math.max(0, b.expanded - beforeExpanded - structural);
  if (b.expanded > 4096 || b.nodes > 4096) fail("aggregate expansion", "limit-exceeded");
}
function freeze(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function checkInputBudget(value) {
  let bytes = 0;
  const active = /* @__PURE__ */ new Set(), encoder = new TextEncoder();
  const add = (s) => {
    if (s.length > LIMITS.bytes) fail("input bytes", "limit-exceeded");
    bytes += encoder.encode(s).byteLength;
    if (bytes > LIMITS.bytes) fail("input bytes", "limit-exceeded");
  };
  function walk(v, depth) {
    if (depth > 64) fail("input depth", "limit-exceeded");
    if (v === null || typeof v === "boolean") {
      add(String(v));
      return;
    }
    if (typeof v === "string") {
      if (v.length > LIMITS.bytes) fail("input text bytes", "limit-exceeded");
      add(JSON.stringify(v));
      return;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail("nonfinite input");
      add(String(v));
      return;
    }
    if (typeof v !== "object" || active.has(v)) fail("non-data/cycle");
    active.add(v);
    const isArray = Array.isArray(v);
    if (isArray && Object.getPrototypeOf(v) !== Array.prototype) fail("array prototype");
    const p = isArray ? v : plain(v);
    const keys = Reflect.ownKeys(p).filter((k) => !(isArray && k === "length"));
    if (keys.length > 4096) fail("input collection", "limit-exceeded");
    if (isArray && (keys.length !== v.length || keys.some((k, i) => k !== String(i))))
      fail("array shape");
    add(isArray ? "[" : "{");
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], desc = Object.getOwnPropertyDescriptor(p, k);
      if (typeof k !== "string" || !desc || !("value" in desc)) fail("accessor/symbol");
      if (i) add(",");
      if (!isArray) {
        add(JSON.stringify(k));
        add(":");
      }
      walk(desc.value, depth + 1);
    }
    add(isArray ? "]" : "}");
    active.delete(v);
  }
  walk(value, 0);
}
function copyDocumentSvgImage(value, b, depth) {
  checkInputBudget(value);
  const copied = freeze(image(value, b, depth));
  const canonical = serializeDocumentSvgImage(copied);
  b.canonicalBytes += new TextEncoder().encode(canonical).byteLength;
  if (b.canonicalBytes > LIMITS.bytes) fail("aggregate canonical SVG bytes", "limit-exceeded");
  return copied;
}
var escape = (v) => String(v).replace(
  /[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]
);
var attr = (k, v) => v === void 0 ? "" : " " + k + '="' + escape(v) + '"';
var len = (l) => String(l.value) + { user: "", px: "px", em: "em", percent: "%" }[l.unit];
var color = (c) => "rgba(" + c.join(",") + ")";
function serializeDocumentSvgImage(img, options = {}) {
  const prefix = options.idPrefix ?? "svgprofile";
  id(prefix);
  const ids = new Map(img.definitions.map((d, i) => [d.id, prefix + "-d" + i]));
  const ref = (x) => ids.get(x) ?? fail("serializer missing ref");
  const paint2 = (s) => s.kind === "none" ? "none" : s.kind === "color" ? color(s.rgba) : "url(#" + ref(s.ref) + ")";
  function transformText(t) {
    if (t.kind === "matrix") return "matrix(" + t.values.join(" ") + ")";
    if (t.kind === "translate" || t.kind === "scale") return t.kind + "(" + t.x + " " + t.y + ")";
    if (t.kind === "rotate") return "rotate(" + t.degrees + " " + t.cx + " " + t.cy + ")";
    return t.kind + "(" + t.degrees + ")";
  }
  const filterText = (f) => f.kind === "unresolved-local" ? "url(#" + prefix + "-unresolved-filter)" : f.kind === "none" ? "none" : f.kind === "definition" ? "url(#" + ref(f.ref) + ")" : f.shadows.map(
    (s) => "drop-shadow(" + s.dx + "px " + s.dy + "px " + s.blur + "px " + color(s.color) + ")"
  ).join(" ");
  const styleNames = {
    shapeRendering: "shape-rendering",
    fillOpacity: "fill-opacity",
    strokeOpacity: "stroke-opacity",
    fillRule: "fill-rule",
    clipRule: "clip-rule",
    strokeWidth: "stroke-width",
    dashArray: "stroke-dasharray",
    dashOffset: "stroke-dashoffset",
    lineCap: "stroke-linecap",
    lineJoin: "stroke-linejoin",
    miterLimit: "stroke-miterlimit",
    mixBlendMode: "mix-blend-mode",
    colorInterpolation: "color-interpolation",
    colorInterpolationFilters: "color-interpolation-filters",
    fontId: "font-family",
    fontSize: "font-size",
    fontWeight: "font-weight",
    fontStyle: "font-style",
    letterSpacing: "letter-spacing",
    wordSpacing: "word-spacing",
    textAnchor: "text-anchor",
    dominantBaseline: "dominant-baseline",
    alignmentBaseline: "alignment-baseline",
    decoration: "text-decoration",
    whiteSpace: "white-space",
    textTransform: "text-transform",
    clipPath: "clip-path"
  };
  function styleText(s) {
    return Object.entries(s).map(([k, v]) => {
      const name = styleNames[k] ?? k;
      const val = k === "fill" || k === "stroke" ? paint2(v) : k === "filter" ? filterText(v) : k === "clipPath" ? "url(#" + ref(v) + ")" : k === "fontId" ? fontCss[v] : k === "dashArray" ? v.length ? v.map(len).join(" ") : "none" : v && typeof v === "object" && "unit" in v ? len(v) : String(v);
      return name + ":" + val;
    }).join(";");
  }
  function commonAttrs(n) {
    let s = n.style === void 0 ? "" : styleText(img.styles[n.style]);
    if (n.transformOrigin)
      s += (s ? ";" : "") + "transform-origin:" + n.transformOrigin.map(len).join(" ");
    if (n.transformBox) s += (s ? ";" : "") + "transform-box:" + n.transformBox;
    return (s ? attr("style", s) : "") + (n.transforms?.length ? attr("transform", n.transforms.map(transformText).join(" ")) : "");
  }
  const title = (n) => (n.title === void 0 ? "" : "<title>" + escape(n.title) + "</title>") + (n.description === void 0 ? "" : "<desc>" + escape(n.description) + "</desc>");
  const bounded = (value) => {
    if (new TextEncoder().encode(value).byteLength > LIMITS.bytes)
      fail("canonical SVG byte budget", "limit-exceeded");
    return value;
  };
  function joinRendered(values, renderValue) {
    let output = "", bytes = 0;
    for (const value of values) {
      const part = renderValue(value);
      bytes += new TextEncoder().encode(part).byteLength;
      if (bytes > LIMITS.bytes) fail("canonical SVG byte budget", "limit-exceeded");
      output += part;
    }
    return output;
  }
  const tag = (name, a, body = "") => bounded("<" + name + a + ">" + body + "</" + name + ">");
  function textAttrs(n) {
    let a = commonAttrs(n);
    for (const k of ["x", "y", "dx", "dy"])
      if (n[k]) a += attr(k, n[k].map(len).join(" "));
    if (n.xmlSpace) a += attr("xml:space", n.xmlSpace);
    return a;
  }
  function render(n) {
    if (n.kind === "textRun") return escape(n.text);
    if (n.kind === "text" || n.kind === "tspan")
      return tag(
        n.kind,
        textAttrs(n),
        title(n) + joinRendered(n.children, render)
      );
    const common2 = commonAttrs(n), children = joinRendered(n.children ?? [], render);
    if (n.kind === "group") return tag("g", common2, title(n) + children);
    if (n.kind === "textAlternative")
      return tag("switch", common2, title(n) + render(n.primary) + render(n.fallback));
    if (n.kind === "textBox") {
      const [x, y, width, height] = n.box;
      const outer = "display:table;width:100%;height:100%;margin:0;padding:0;border:0;box-sizing:" + (n.outerBoxSizing ?? "content-box") + (n.background ? ";background-color:" + color(n.background) : "");
      const inner = "display:table-cell;margin:0;padding:0;border:0;box-sizing:" + (n.innerBoxSizing ?? "content-box") + ";text-align:" + n.hAlign + ";vertical-align:" + n.vAlign + ";color:" + color(n.color) + ";font-family:" + fontCss[n.fontId] + ";font-size:" + n.fontSizePx + "px;font-weight:" + n.fontWeight + ";font-style:" + n.fontStyle + ";line-height:" + (n.lineHeight === "normal" ? "normal" : n.lineHeight.px + "px") + ";white-space:" + n.whiteSpace + ";overflow-wrap:" + n.overflowWrap + ";word-break:" + n.wordBreak + (n.textTransform ? ";text-transform:" + n.textTransform : "") + (n.letterSpacing ? ";letter-spacing:" + len(n.letterSpacing) : "") + (n.wordSpacing ? ";word-spacing:" + len(n.wordSpacing) : "") + (n.decoration ? ";text-decoration:" + n.decoration : "");
      return tag(
        "foreignObject",
        common2 + attr("x", x) + attr("y", y) + attr("width", width) + attr("height", height),
        title(n) + tag(
          "div",
          attr("xmlns", "http://www.w3.org/1999/xhtml") + attr("style", outer),
          tag("div", attr("style", inner), escape(n.text))
        )
      );
    }
    let a = common2;
    for (const k of [
      "x",
      "y",
      "width",
      "height",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "x1",
      "y1",
      "x2",
      "y2"
    ])
      if (n[k] !== void 0) a += attr(k, n[k]);
    if (n.commands) a += attr("d", n.commands.map((c) => c[0] + c.slice(1).join(" ")).join(" "));
    if (n.points) a += attr("points", n.points.map((p) => p.join(",")).join(" "));
    for (const k of ["markerStart", "markerMid", "markerEnd"])
      if (n[k])
        a += attr(
          { markerStart: "marker-start", markerMid: "marker-mid", markerEnd: "marker-end" }[k],
          "url(#" + ref(n[k]) + ")"
        );
    if (n.kind === "use") a += attr("href", "#" + ref(n.ref));
    return tag(n.kind, a, title(n));
  }
  function def(d) {
    let a = attr("id", ref(d.id));
    if ("style" in d && d.style !== void 0) a += attr("style", styleText(img.styles[d.style]));
    if ("viewBox" in d && d.viewBox) a += attr("viewBox", d.viewBox.join(" "));
    if ("transforms" in d && d.transforms?.length)
      a += attr(
        d.kind === "linearGradient" ? "gradientTransform" : "transform",
        d.transforms.map(transformText).join(" ")
      );
    if (d.kind === "clipPath")
      return tag("clipPath", a + attr("clipPathUnits", d.units), joinRendered(d.children, render));
    if (d.kind === "symbol")
      return tag(
        "symbol",
        a + attr("width", d.width) + attr("height", d.height),
        joinRendered(d.children, render)
      );
    if (d.kind === "marker")
      return tag(
        "marker",
        a + attr("markerWidth", d.width) + attr("markerHeight", d.height) + attr("refX", len(d.refX)) + attr("refY", len(d.refY)) + attr("markerUnits", d.units) + attr("orient", typeof d.orient === "string" ? d.orient : d.orient.degrees),
        joinRendered(d.children, render)
      );
    if (d.kind === "linearGradient") {
      a += attr("gradientUnits", d.units) + attr("spreadMethod", d.spread);
      for (const k of ["x1", "y1", "x2", "y2"]) a += attr(k, len(d[k]));
      return tag(
        "linearGradient",
        a,
        d.stops.map((s) => tag("stop", attr("offset", s.offset) + attr("stop-color", color(s.color)))).join("")
      );
    }
    for (const [i, k] of ["x", "y", "width", "height"].entries()) a += attr(k, len(d.region[i]));
    return tag(
      "filter",
      a + attr("filterUnits", d.units) + attr("primitiveUnits", d.primitiveUnits) + attr("color-interpolation-filters", d.colorInterpolation),
      tag(
        "feDropShadow",
        attr("dx", d.dx) + attr("dy", d.dy) + attr("stdDeviation", d.stdDeviation.join(" ")) + attr("flood-color", color(d.color))
      )
    );
  }
  const svg = tag(
    "svg",
    attr("xmlns", "http://www.w3.org/2000/svg") + attr("width", img.width) + attr("height", img.height) + attr("viewBox", img.viewBox.join(" ")) + (img.rootStyle === void 0 ? "" : attr("style", styleText(img.styles[img.rootStyle]))) + attr(
      "preserveAspectRatio",
      img.aspect.align + (img.aspect.align === "none" ? "" : " " + img.aspect.fit)
    ),
    title(img) + tag("defs", "", joinRendered(img.definitions, def)) + joinRendered(img.children, render)
  );
  const [rasterX, rasterY, rasterWidth, rasterHeight] = img.rasterBounds;
  const outerLeft = Math.floor(rasterX), outerTop = Math.floor(rasterY);
  const outerWidth = Math.ceil(rasterX + rasterWidth) - outerLeft, outerHeight = Math.ceil(rasterY + rasterHeight) - outerTop;
  const wrapped = tag(
    "svg",
    attr("xmlns", "http://www.w3.org/2000/svg") + attr("width", outerWidth) + attr("height", outerHeight) + attr("viewBox", `${outerLeft} ${outerTop} ${outerWidth} ${outerHeight}`) + attr("preserveAspectRatio", "none"),
    svg
  );
  if (new TextEncoder().encode(wrapped).byteLength > LIMITS.bytes)
    fail("canonical SVG byte budget", "limit-exceeded");
  return wrapped;
}

// packages/core/src/document-presentation.ts
var DOCUMENT_PRESENTATION_LIMITS = Object.freeze({
  inputUtf16: 65536,
  inputLines: 256,
  outputBytes: 262144,
  nodes: 4096,
  depth: 64,
  fragments: 128,
  timeoutMs: 2e3,
  queue: 2
});
var DocumentPresentationError = class extends Error {
  constructor(code) {
    super(`Document presentation: ${code}`);
    this.code = code;
    this.name = "DocumentPresentationError";
  }
};
function record(value, keys, fail2) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail2();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail2();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).some((key) => !keys.includes(key) || !("value" in descriptors[key])))
    return fail2();
  return value;
}
function integer2(value, min, max, fail2) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    return fail2();
  return value;
}
function number(value, min, max, fail2) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    return fail2();
  return value;
}
function string(value, max, fail2) {
  if (typeof value !== "string" || value.length > max) return fail2();
  return value;
}
function boolean(value, fail2) {
  if (typeof value !== "boolean") return fail2();
  return value;
}
function choice2(value, values, fail2) {
  if (typeof value !== "string" || !values.includes(value)) return fail2();
  return value;
}
function array2(value, max, copy, fail2) {
  if (!Array.isArray(value) || value.length > max) return fail2();
  return Object.freeze(value.map(copy));
}
function range(value, min, max, fail2) {
  const v = record(value, ["from", "to"], fail2);
  const from = integer2(v.from, min, max, fail2);
  return Object.freeze({ from, to: integer2(v.to, from, max, fail2) });
}
function copyDocumentPresentationRequest(value) {
  const fail2 = () => {
    throw new DocumentPresentationError("invalid-input");
  };
  const v = record(
    value,
    [
      "documentId",
      "version",
      "from",
      "to",
      "source",
      "fromLine",
      "toLine",
      "completeStart",
      "completeEnd",
      "contextKnown",
      "protectedRanges",
      "blocks",
      "selection",
      "theme",
      "target",
      "width"
    ],
    fail2
  );
  const documentId = string(v.documentId, 512, fail2);
  if (!documentId) fail2();
  const from = integer2(v.from, 0, Number.MAX_SAFE_INTEGER, fail2);
  const to = integer2(v.to, from, Number.MAX_SAFE_INTEGER, fail2);
  const source = string(v.source, DOCUMENT_PRESENTATION_LIMITS.inputUtf16, fail2);
  if (source.length !== to - from || source.split("\n").length > DOCUMENT_PRESENTATION_LIMITS.inputLines)
    fail2();
  const fromLine = integer2(v.fromLine, 1, Number.MAX_SAFE_INTEGER, fail2);
  const toLine = integer2(
    v.toLine,
    fromLine,
    fromLine + DOCUMENT_PRESENTATION_LIMITS.inputLines - 1,
    fail2
  );
  const selection = record(v.selection, ["anchor", "head"], fail2);
  return Object.freeze({
    documentId,
    version: integer2(v.version, 0, Number.MAX_SAFE_INTEGER, fail2),
    from,
    to,
    source,
    fromLine,
    toLine,
    completeStart: boolean(v.completeStart, fail2),
    completeEnd: boolean(v.completeEnd, fail2),
    contextKnown: boolean(v.contextKnown, fail2),
    protectedRanges: array2(v.protectedRanges, 4096, (item) => range(item, from, to, fail2), fail2),
    blocks: array2(
      v.blocks,
      256,
      (item) => {
        const b = record(item, ["from", "to", "kind", "complete", "info", "contentRanges"], fail2);
        const r = range({ from: b.from, to: b.to }, from, to, fail2);
        return Object.freeze({
          ...r,
          kind: choice2(b.kind, ["text", "fence", "code", "unknown"], fail2),
          complete: boolean(b.complete, fail2),
          ...b.info === void 0 ? {} : { info: string(b.info, 256, fail2) },
          contentRanges: array2(b.contentRanges, 256, (r2) => range(r2, r.from, r.to, fail2), fail2)
        });
      },
      fail2
    ),
    selection: Object.freeze({
      anchor: integer2(selection.anchor, 0, Number.MAX_SAFE_INTEGER, fail2),
      head: integer2(selection.head, 0, Number.MAX_SAFE_INTEGER, fail2)
    }),
    theme: choice2(v.theme, ["light", "dark"], fail2),
    target: choice2(v.target, ["screen", "export"], fail2),
    width: number(v.width, 1, 8192, fail2)
  });
}
var tones = ["foreground", "muted", "accent", "background", "border"];
var mathTags = [
  "math",
  "mrow",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mspace",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mover",
  "munder",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mstyle"
];
function count(budget, depth, fail2) {
  if (++budget.nodes > DOCUMENT_PRESENTATION_LIMITS.nodes || depth > DOCUMENT_PRESENTATION_LIMITS.depth)
    fail2();
}
function boundedText(value, budget, fail2, max = 65536) {
  const text3 = string(value, max, fail2);
  budget.text += text3.length;
  if (budget.text > DOCUMENT_PRESENTATION_LIMITS.outputBytes) fail2();
  return text3;
}
function mathNode(value, budget, depth, fail2) {
  count(budget, depth, fail2);
  const v = record(value, ["tag", "text", "children", "attributes"], fail2);
  const tag = choice2(v.tag, mathTags, fail2);
  const attrs = {};
  if (v.attributes !== void 0) {
    const allowed = tag === "math" ? ["display"] : tag === "mstyle" ? ["scriptLevel", "displayStyle", "mathvariant"] : tag === "mtable" ? ["rowSpacingEm", "columnSpacingEm", "columnAlign"] : tag === "mspace" ? ["widthEm"] : tag === "mo" ? ["stretchy", "fence", "separator", "lspaceEm", "rspaceEm"] : tag === "mover" || tag === "munder" ? ["accent"] : tag === "mi" || tag === "mn" || tag === "mtext" ? ["mathvariant"] : [];
    const a = record(v.attributes, allowed, fail2);
    for (const [key, val] of Object.entries(a)) {
      if (["stretchy", "fence", "separator", "accent", "displayStyle"].includes(key))
        attrs[key] = boolean(val, fail2);
      else if (key === "display") attrs[key] = choice2(val, ["inline", "block"], fail2);
      else if (key === "mathvariant")
        attrs[key] = choice2(
          val,
          [
            "normal",
            "bold",
            "italic",
            "bold-italic",
            "double-struck",
            "script",
            "fraktur",
            "monospace"
          ],
          fail2
        );
      else if (key === "scriptLevel") attrs[key] = integer2(val, 0, 4, fail2);
      else if (key === "columnAlign")
        attrs[key] = array2(val, 32, (x) => choice2(x, ["left", "center", "right"], fail2), fail2);
      else if (key === "rowSpacingEm" || key === "columnSpacingEm")
        attrs[key] = array2(val, 32, (x) => number(x, 0, 20, fail2), fail2);
      else attrs[key] = number(val, key === "widthEm" ? 0 : -20, 20, fail2);
    }
  }
  const text3 = v.text === void 0 ? void 0 : boundedText(v.text, budget, fail2);
  const children = v.children === void 0 ? void 0 : array2(v.children, 4096, (x) => mathNode(x, budget, depth + 1, fail2), fail2);
  if (text3 !== void 0 && !["mi", "mn", "mo", "mtext"].includes(tag)) fail2();
  if (text3 !== void 0 && children?.length) fail2();
  const arity = {
    mfrac: 2,
    mroot: 2,
    msup: 2,
    msub: 2,
    msubsup: 3,
    mover: 2,
    munder: 2,
    munderover: 3
  };
  if (arity[tag] !== void 0 && children?.length !== arity[tag]) fail2();
  if (tag === "mtable" && children?.some((c) => c.tag !== "mtr")) fail2();
  if (tag === "mtr" && children?.some((c) => c.tag !== "mtd")) fail2();
  return Object.freeze({
    tag,
    ...text3 === void 0 ? {} : { text: text3 },
    ...children ? { children } : {},
    ...v.attributes === void 0 ? {} : { attributes: Object.freeze(attrs) }
  });
}
function primitive(value, budget, depth, fail2) {
  count(budget, depth, fail2);
  const raw = record(
    value,
    [
      "type",
      "x",
      "y",
      "width",
      "height",
      "radius",
      "cx",
      "cy",
      "rx",
      "ry",
      "x1",
      "y1",
      "x2",
      "y2",
      "points",
      "stroke",
      "fill",
      "strokeWidth",
      "text",
      "tone",
      "fontSize",
      "anchor"
    ],
    fail2
  );
  const type = choice2(raw.type, ["rect", "ellipse", "line", "polyline", "polygon", "text"], fail2);
  const keys = {
    rect: ["x", "y", "width", "height", "radius"],
    ellipse: ["cx", "cy", "rx", "ry"],
    line: ["x1", "y1", "x2", "y2"],
    polyline: ["points"],
    polygon: ["points"],
    text: ["x", "y", "text", "tone", "fontSize", "anchor"]
  };
  const v = record(
    value,
    ["type", ...keys[type], ...type === "text" ? [] : ["stroke", "fill", "strokeWidth"]],
    fail2
  );
  const out = { type };
  for (const key of keys[type]) {
    if (v[key] === void 0 && ["radius", "tone", "fontSize", "anchor"].includes(key)) continue;
    if (key === "points")
      out[key] = array2(
        v[key],
        1024,
        (p) => {
          count(budget, depth + 1, fail2);
          const r = record(p, ["x", "y"], fail2);
          return Object.freeze({
            x: number(r.x, -8192, 8192, fail2),
            y: number(r.y, -8192, 8192, fail2)
          });
        },
        fail2
      );
    else if (key === "text") out[key] = boundedText(v[key], budget, fail2, 4096);
    else if (key === "tone") out[key] = choice2(v[key], tones, fail2);
    else if (key === "anchor") out[key] = choice2(v[key], ["start", "middle", "end"], fail2);
    else
      out[key] = number(
        v[key],
        key === "fontSize" ? 8 : ["width", "height", "radius", "rx", "ry"].includes(key) ? 0 : -8192,
        key === "fontSize" ? 72 : 8192,
        fail2
      );
  }
  if (v.stroke !== void 0) out.stroke = choice2(v.stroke, tones, fail2);
  if (v.fill !== void 0) out.fill = choice2(v.fill, [...tones, "none"], fail2);
  if (v.strokeWidth !== void 0) out.strokeWidth = number(v.strokeWidth, 0, 32, fail2);
  return Object.freeze(out);
}
function node2(value, budget, depth, fail2, request) {
  if (value && typeof value === "object" && Object.getOwnPropertyDescriptor(value, "type")?.value === "svg-image") {
    try {
      return copyDocumentSvgImage(value, budget, depth);
    } catch {
      return fail2();
    }
  }
  count(budget, depth, fail2);
  const v = record(
    value,
    ["type", "text", "children", "label", "target", "tree", "width", "height"],
    fail2
  );
  const type = choice2(
    v.type,
    ["text", "group", "emphasis", "code", "sup", "sub", "reference", "math", "vector"],
    fail2
  );
  if (type === "text") {
    record(v, ["type", "text"], fail2);
    return Object.freeze({ type, text: boundedText(v.text, budget, fail2) });
  }
  if (type === "reference") {
    record(v, ["type", "label", "target"], fail2);
    const t = record(v.target, ["documentId", "version", "from", "to"], fail2);
    const from = integer2(t.from, 0, Number.MAX_SAFE_INTEGER, fail2);
    const target = Object.freeze({
      documentId: string(t.documentId, 512, fail2),
      version: integer2(t.version, 0, Number.MAX_SAFE_INTEGER, fail2),
      from,
      to: integer2(t.to, from, Number.MAX_SAFE_INTEGER, fail2)
    });
    if (request && (target.documentId !== request.documentId || target.version !== request.version))
      fail2();
    return Object.freeze({ type, label: boundedText(v.label, budget, fail2, 4096), target });
  }
  if (type === "math") {
    record(v, ["type", "tree"], fail2);
    const tree = mathNode(v.tree, budget, depth + 1, fail2);
    if (tree.tag !== "math") fail2();
    return Object.freeze({ type, tree });
  }
  if (type === "vector") {
    record(v, ["type", "width", "height", "children"], fail2);
    return Object.freeze({
      type,
      width: number(v.width, 1, 8192, fail2),
      height: number(v.height, 1, 8192, fail2),
      children: array2(v.children, 4096, (p) => primitive(p, budget, depth + 1, fail2), fail2)
    });
  }
  record(v, ["type", "children"], fail2);
  return Object.freeze({
    type,
    children: array2(v.children, 4096, (c) => node2(c, budget, depth + 1, fail2, request), fail2)
  });
}
function outputSize(value, fail2) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > DOCUMENT_PRESENTATION_LIMITS.outputBytes)
    fail2();
}
function copyDocumentPresentationResult(value, request, declaration) {
  const fail2 = () => {
    throw new DocumentPresentationError("invalid-output");
  };
  const declarations = declaration === void 0 ? void 0 : "contexts" in declaration ? [declaration] : declaration;
  const v = record(value, ["fragments", "complete"], fail2), budget = createDocumentOutputBudget();
  let end = request.from;
  const fragments = array2(
    v.fragments,
    128,
    (item) => {
      const f = record(
        item,
        ["from", "to", "layout", "content", "accessibleText", "status", "message"],
        fail2
      );
      const r = range({ from: f.from, to: f.to }, request.from, request.to, fail2);
      if (!request.contextKnown || r.from === r.to || r.from < end) fail2();
      end = r.to;
      const overlaps = (a) => r.from < a.to && r.to > a.from;
      const fence = request.blocks.find(
        (b) => b.kind === "fence" && b.complete && r.from === b.from && r.to === b.to && declarations?.some(
          (d) => d.contexts.includes("fence") && d.fenceLanguages?.includes((b.info ?? "").trim().split(/\s+/)[0] ?? "")
        )
      );
      if (!fence) {
        if (declarations && !declarations.some((d) => d.contexts.includes("text"))) fail2();
        if (request.protectedRanges.some(overlaps) || request.blocks.some((b) => b.kind !== "text" && overlaps(b)))
          fail2();
      }
      const layout = choice2(f.layout, ["inline", "block"], fail2);
      if (fence && layout !== "block") fail2();
      return Object.freeze({
        ...r,
        layout,
        content: node2(f.content, budget, 1, fail2, request),
        accessibleText: boundedText(f.accessibleText, budget, fail2, 8192),
        ...f.status === void 0 ? {} : { status: choice2(f.status, ["ready", "error"], fail2) },
        ...f.message === void 0 ? {} : { message: boundedText(f.message, budget, fail2, 1e3) }
      });
    },
    fail2
  );
  const result = Object.freeze({ fragments, complete: boolean(v.complete, fail2) });
  outputSize(result, fail2);
  canonicalSize(
    fragments.map((fragment) => fragment.content),
    fail2
  );
  return result;
}
function canonicalSize(nodes, fail2) {
  let bytes = 0;
  const context = { image: 0 };
  for (const node3 of nodes) {
    bytes += new TextEncoder().encode(serializeValidatedNode(node3, context)).byteLength;
    if (bytes > DOCUMENT_PRESENTATION_LIMITS.outputBytes) fail2();
  }
}
function serializeValidatedNode(validated, context) {
  const escape2 = (text3) => text3.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
  const math = (n) => {
    const attrs = Object.entries(n.attributes ?? {}).map(([k, v]) => {
      const names = {
        scriptLevel: "scriptlevel",
        displayStyle: "displaystyle",
        rowSpacingEm: "rowspacing",
        columnSpacingEm: "columnspacing",
        columnAlign: "columnalign",
        widthEm: "width",
        lspaceEm: "lspace",
        rspaceEm: "rspace"
      };
      const formatted = Array.isArray(v) ? v.map((x) => typeof x === "number" ? `${x}em` : x).join(" ") : k.endsWith("Em") ? `${v}em` : String(v);
      return ` ${names[k] ?? k}="${escape2(formatted)}"`;
    }).join("");
    return `<${n.tag}${n.tag === "math" ? ' xmlns="http://www.w3.org/1998/Math/MathML"' : ""}${attrs}>${escape2(n.text ?? "")}${(n.children ?? []).map(math).join("")}</${n.tag}>`;
  };
  const vector = (p) => {
    const attrs = [];
    let text3 = "";
    for (const [key, value] of Object.entries(p)) {
      if (key === "type") continue;
      if (key === "text") {
        text3 = escape2(String(value));
        continue;
      }
      if (key === "tone") {
        attrs.push(`fill="currentColor"`);
        continue;
      }
      if (key === "fill" || key === "stroke") {
        attrs.push(`${key}="${value === "none" ? "none" : "currentColor"}"`);
        continue;
      }
      if (key === "radius") {
        attrs.push(`rx="${value}"`);
        continue;
      }
      if (key === "points") {
        attrs.push(
          `points="${value.map((p2) => `${p2.x},${p2.y}`).join(" ")}"`
        );
        continue;
      }
      const name = { strokeWidth: "stroke-width", fontSize: "font-size", anchor: "text-anchor" }[key] ?? key;
      attrs.push(`${name}="${escape2(String(value))}"`);
    }
    return `<${p.type} ${attrs.join(" ")}>${text3}</${p.type}>`;
  };
  const render = (n) => {
    if (n.type === "svg-image")
      return serializeDocumentSvgImage(n, {
        idPrefix: `${context.prefix ?? "document-svg"}-${context.image++}`
      });
    if (n.type === "text") return escape2(n.text);
    if (n.type === "math") return math(n.tree);
    if (n.type === "vector")
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n.width} ${n.height}" width="${n.width}" height="${n.height}">${n.children.map(vector).join("")}</svg>`;
    if (n.type === "reference")
      return `<span data-source-from="${n.target.from}" data-source-to="${n.target.to}">${escape2(n.label)}</span>`;
    const tag = n.type === "group" ? "span" : n.type === "emphasis" ? "em" : n.type;
    return `<${tag}>${n.children.map(render).join("")}</${tag}>`;
  };
  return render(validated);
}
function copyDocumentPresentationAggregate(value, request, declarations) {
  return copyDocumentPresentationResult(value, request, declarations);
}

// packages/markdown/src/cst/node.ts
function createNode(node3) {
  assertNodeRange(node3);
  return Object.freeze({
    type: node3.type,
    from: node3.from,
    to: node3.to,
    status: node3.status,
    ...node3.markerRanges ? { markerRanges: freezeRanges(node3.markerRanges) } : {},
    ...node3.contentRanges ? { contentRanges: freezeRanges(node3.contentRanges) } : {},
    ...node3.children ? { children: Object.freeze([...node3.children]) } : {},
    ...node3.data ? { data: Object.freeze({ ...node3.data }) } : {}
  });
}
function assertNodeRange(node3) {
  if (!Number.isInteger(node3.from) || !Number.isInteger(node3.to)) {
    throw new RangeError(`Node ${node3.type} range offsets must be integers`);
  }
  if (node3.from < 0 || node3.to < node3.from) {
    throw new RangeError(`Invalid ${node3.type} node range: ${node3.from}-${node3.to}`);
  }
}
function freezeRanges(ranges) {
  return Object.freeze(
    ranges.map((range2) => {
      if (!Number.isInteger(range2.from) || !Number.isInteger(range2.to)) {
        throw new RangeError(`Range offsets must be integers: ${range2.from}-${range2.to}`);
      }
      if (range2.from < 0 || range2.to < range2.from) {
        throw new RangeError(`Invalid range: ${range2.from}-${range2.to}`);
      }
      return Object.freeze({ ...range2 });
    })
  );
}

// packages/markdown/src/extensions/safe.ts
function compileMarkdownSyntaxPattern(extension) {
  if (extension.pattern.length > 256) {
    throw new Error(`Markdown syntax pattern is too long: ${extension.id}`);
  }
  if (/\(\?[<!=]|\\[1-9]|\([^)]*(?:\*|\+|\{\d+,?\d*\})[^)]*\)(?:\*|\+|\{)/.test(extension.pattern)) {
    throw new Error(`Markdown syntax pattern uses unsafe features: ${extension.id}`);
  }
  const flags = extension.flags ?? "";
  if (!/^[imu]*$/.test(flags)) {
    throw new Error(`Markdown syntax flags are invalid: ${extension.id}`);
  }
  return new RegExp(extension.pattern, flags);
}
function runMarkdownExtensionSafely(context, run) {
  try {
    return Object.freeze({
      ok: true,
      value: run()
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      error,
      context: Object.freeze({ ...context })
    });
  }
}

// packages/markdown/src/block/lines.ts
function scanLines(source) {
  const lines = [];
  let pos = 0;
  let number2 = 1;
  while (pos < source.length) {
    const newline = source.indexOf("\n", pos);
    const hasNewline = newline !== -1;
    const lineBreakStart = hasNewline ? newline : source.length;
    const to = hasNewline ? newline + 1 : source.length;
    const contentTo = lineBreakStart > pos && source.charCodeAt(lineBreakStart - 1) === 13 ? lineBreakStart - 1 : lineBreakStart;
    lines.push(
      Object.freeze({
        number: number2,
        from: pos,
        contentTo,
        to,
        text: source.slice(pos, contentTo)
      })
    );
    pos = to;
    number2 += 1;
  }
  return Object.freeze(lines);
}

// packages/markdown/src/block/parser.ts
function parseMarkdown(source, options = {}) {
  try {
    return {
      source,
      root: createNode({
        type: "document",
        from: 0,
        to: source.length,
        status: "valid",
        children: parseBlocks(source, options.syntaxExtensions ?? [])
      })
    };
  } catch {
    return {
      source,
      root: createNode({
        type: "document",
        from: 0,
        to: source.length,
        status: "fallback",
        children: source.length > 0 ? [
          createNode({
            type: "fallbackText",
            from: 0,
            to: source.length,
            status: "fallback",
            contentRanges: [{ from: 0, to: source.length }]
          })
        ] : []
      })
    };
  }
}
function parseBlocks(source, extensions) {
  const lines = scanLines(source);
  const nodes = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) {
      break;
    }
    if (isBlankLine(line)) {
      nodes.push(parseBlankLine(line));
      index += 1;
      continue;
    }
    const extensionBlock = parseExtensionBlock(line, extensions);
    if (extensionBlock) {
      nodes.push(extensionBlock);
      index += 1;
      continue;
    }
    const htmlBlock = parseHtmlBlock(lines, index);
    if (htmlBlock) {
      nodes.push(htmlBlock.node);
      index = htmlBlock.nextIndex;
      continue;
    }
    const fencedCode = parseFencedCode(lines, index);
    if (fencedCode) {
      nodes.push(fencedCode.node);
      index = fencedCode.nextIndex;
      continue;
    }
    const indentedCode = parseIndentedCode(lines, index);
    if (indentedCode) {
      nodes.push(indentedCode.node);
      index = indentedCode.nextIndex;
      continue;
    }
    const blockquote = parseBlockquote(lines, index);
    if (blockquote) {
      nodes.push(blockquote.node);
      index = blockquote.nextIndex;
      continue;
    }
    const thematicBreak = parseThematicBreak(line);
    if (thematicBreak) {
      nodes.push(thematicBreak);
      index += 1;
      continue;
    }
    const heading = parseAtxHeading(line);
    if (heading) {
      nodes.push(heading);
      index += 1;
      continue;
    }
    const table = parseTable(lines, index);
    if (table) {
      nodes.push(table.node);
      index = table.nextIndex;
      continue;
    }
    const list2 = parseList(lines, index);
    if (list2) {
      nodes.push(list2.node);
      index = list2.nextIndex;
      continue;
    }
    const previous = nodes.at(-1);
    const allowSetext = !previous || !["unorderedList", "orderedList", "blockquote"].includes(previous.type);
    const paragraph = collectParagraph(lines, index, extensions, allowSetext);
    const setext = allowSetext ? parseSetextHeading(paragraph, lines[index + paragraph.length]) : void 0;
    nodes.push(setext ?? parseParagraph(source, paragraph, extensions));
    index += paragraph.length + (setext ? 1 : 0);
  }
  return Object.freeze(nodes);
}
function parseExtensionBlock(line, extensions) {
  for (const extension of extensions) {
    if (!extension.block) {
      continue;
    }
    const result = runMarkdownExtensionSafely(
      { extensionName: extension.id, hook: "block" },
      () => compileMarkdownSyntaxPattern(extension).exec(line.text)
    );
    const match = result.ok ? result.value : void 0;
    if (!match) {
      continue;
    }
    const from = line.from + match.index;
    const to = from + match[0].length;
    return createNode({
      type: extension.nodeType,
      from,
      to,
      status: "valid",
      contentRanges: [{ from, to }],
      data: { extensionId: extension.id }
    });
  }
  return void 0;
}
function isBlankLine(line) {
  return line.text.trim().length === 0;
}
function parseBlankLine(line) {
  return createNode({
    type: "blankLine",
    from: line.from,
    to: line.to,
    status: "valid",
    contentRanges: []
  });
}
function parseAtxHeading(line) {
  const match = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line.text);
  if (!match) {
    return void 0;
  }
  const indent = match[1]?.length ?? 0;
  const marker = match[2];
  if (!marker) {
    return void 0;
  }
  const markerFrom = line.from + indent;
  const markerTo = markerFrom + marker.length;
  const contentFrom = findHeadingContentStart(line.text, markerTo - line.from);
  const content = line.text.slice(contentFrom);
  const closing = /(?:^|[ \t]+)(#+)[ \t]*$/.exec(content);
  const contentEnd = closing ? contentFrom + closing.index : line.text.length;
  const trimmedContentEnd = line.text.slice(0, contentEnd).replace(/[ \t]+$/, "").length;
  const contentRange = {
    from: line.from + contentFrom,
    to: line.from + Math.max(contentFrom, trimmedContentEnd)
  };
  const closingRange = closing ? {
    from: line.from + contentFrom + closing.index + closing[0].indexOf("#"),
    to: line.from + contentFrom + closing.index + closing[0].indexOf("#") + closing[1].length
  } : void 0;
  return createNode({
    type: "heading",
    from: line.from,
    to: line.to,
    status: "valid",
    markerRanges: [{ from: markerFrom, to: markerTo }, ...closingRange ? [closingRange] : []],
    contentRanges: contentRange.from <= contentRange.to ? [contentRange] : [],
    data: { level: marker.length }
  });
}
function parseSetextHeading(lines, underline) {
  const first = lines[0];
  const last = lines.at(-1);
  const match = underline && /^ {0,3}(=+|-+)[ \t]*$/.exec(underline.text);
  if (!first || !last || !underline || !match) return void 0;
  const contentFrom = first.from + (first.text.match(/^[ \t]*/)?.[0].length ?? 0);
  const contentTo = last.from + last.text.replace(/[ \t]+$/, "").length;
  const markerFrom = underline.from + underline.text.indexOf(match[1]);
  return createNode({
    type: "heading",
    from: first.from,
    to: underline.to,
    status: "valid",
    markerRanges: [{ from: markerFrom, to: markerFrom + match[1].length }],
    contentRanges: [{ from: contentFrom, to: contentTo }],
    data: { level: match[1][0] === "=" ? 1 : 2, style: "setext" }
  });
}
function htmlBlockEnd(text3, inParagraph) {
  const special = /^ {0,3}<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(text3);
  if (special) return new RegExp(`</${special[1]}>`, "i");
  if (/^ {0,3}<!--/.test(text3)) return /-->/;
  if (/^ {0,3}<\?/.test(text3)) return /\?>/;
  if (/^ {0,3}<!\[CDATA\[/.test(text3)) return /\]\]>/;
  if (/^ {0,3}<![A-Z]/.test(text3)) return />/;
  if (/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i.test(
    text3
  ))
    return "blank";
  if (!inParagraph && /^ {0,3}(?:<\/[a-zA-Z][\w-]*[ \t]*>|<[a-zA-Z][\w-]*(?:[ \t]+[a-zA-Z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>)[ \t]*$/.test(
    text3
  ))
    return "blank";
  return void 0;
}
function parseHtmlBlock(lines, index) {
  const first = lines[index];
  if (!first) return void 0;
  const end = htmlBlockEnd(first.text, false);
  if (!end) return void 0;
  let nextIndex = index;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (end === "blank" && isBlankLine(line)) break;
    nextIndex += 1;
    if (end !== "blank" && end.test(line.text)) break;
  }
  const last = lines[nextIndex - 1] ?? first;
  return {
    node: createNode({
      type: "fallbackText",
      from: first.from,
      to: last.to,
      status: "valid",
      contentRanges: [{ from: first.from, to: last.to }],
      data: { block: "html" }
    }),
    nextIndex
  };
}
function parseFencedCode(lines, startIndex) {
  const opener = lines[startIndex];
  if (!opener) {
    return void 0;
  }
  const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(opener.text);
  if (!opening) {
    return void 0;
  }
  const indent = opening[1]?.length ?? 0;
  const fence = opening[2];
  const info = opening[3]?.trim() ?? "";
  if (!fence) {
    return void 0;
  }
  const fenceChar = fence[0];
  if (!fenceChar || fenceChar === "`" && info.includes("`")) {
    return void 0;
  }
  const fenceLength = fence.length;
  const openingMarkerFrom = opener.from + indent;
  const openingMarkerTo = openingMarkerFrom + fenceLength;
  let closingLine;
  let closingMarkerFrom;
  let closingMarkerTo;
  let nextIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      break;
    }
    const closing = matchClosingFence(line, fenceChar, fenceLength);
    if (closing) {
      closingLine = line;
      closingMarkerFrom = line.from + closing.indent;
      closingMarkerTo = closingMarkerFrom + closing.length;
      nextIndex = index + 1;
      break;
    }
  }
  const lastLine = closingLine ?? lines[lines.length - 1] ?? opener;
  const contentFrom = opener.to;
  const contentTo = closingLine ? closingLine.from : lastLine.to;
  const markerRanges = closingMarkerFrom !== void 0 && closingMarkerTo !== void 0 ? [
    { from: openingMarkerFrom, to: openingMarkerTo },
    { from: closingMarkerFrom, to: closingMarkerTo }
  ] : [{ from: openingMarkerFrom, to: openingMarkerTo }];
  return {
    node: createNode({
      type: "fencedCode",
      from: opener.from,
      to: lastLine.to,
      status: closingLine ? "valid" : "incomplete",
      markerRanges,
      contentRanges: [{ from: contentFrom, to: contentTo }],
      data: { fenceChar, fenceLength, info }
    }),
    nextIndex
  };
}
function matchClosingFence(line, fenceChar, fenceLength) {
  const escaped = fenceChar === "`" ? "`" : "~";
  const pattern = new RegExp(`^( {0,3})(${escaped}{${fenceLength},})[ \\t]*$`);
  const match = pattern.exec(line.text);
  if (!match) {
    return void 0;
  }
  return {
    indent: match[1]?.length ?? 0,
    length: match[2]?.length ?? fenceLength
  };
}
function parseIndentedCode(lines, startIndex) {
  const first = lines[startIndex];
  if (!first || !isIndentedCodeLine(first)) {
    return void 0;
  }
  const codeLines = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (!line || !isIndentedCodeLine(line)) {
      break;
    }
    codeLines.push(line);
    nextIndex += 1;
  }
  const last = codeLines[codeLines.length - 1] ?? first;
  return {
    node: createNode({
      type: "indentedCode",
      from: first.from,
      to: last.to,
      status: "valid",
      markerRanges: codeLines.map((line) => ({
        from: line.from,
        to: line.from + indentedCodePrefixLength(line.text)
      })),
      contentRanges: codeLines.map((line) => ({
        from: line.from + indentedCodePrefixLength(line.text),
        to: line.contentTo
      }))
    }),
    nextIndex
  };
}
function isIndentedCodeLine(line) {
  return /^(?: {4}| {0,3}\t)/.test(line.text);
}
function indentedCodePrefixLength(text3) {
  return /^(?: {4}| {0,3}\t)/.exec(text3)?.[0].length ?? 0;
}
function parseBlockquote(lines, startIndex) {
  const first = parseBlockquoteLine(lines[startIndex]);
  if (!first) {
    return void 0;
  }
  const children = [first];
  let nextIndex = startIndex + 1;
  while (nextIndex < lines.length) {
    const child = parseBlockquoteLine(lines[nextIndex]);
    if (!child) {
      break;
    }
    children.push(child);
    nextIndex += 1;
  }
  const last = children[children.length - 1] ?? first;
  return {
    node: createNode({
      type: "blockquote",
      from: first.from,
      to: last.to,
      status: "valid",
      markerRanges: children.flatMap((child) => child.markerRanges ?? []),
      contentRanges: children.flatMap((child) => child.contentRanges ?? []),
      children
    }),
    nextIndex
  };
}
function parseBlockquoteLine(line) {
  if (!line) {
    return void 0;
  }
  const match = /^( {0,3})>(?:[ \t]?)(.*)$/.exec(line.text);
  if (!match) {
    return void 0;
  }
  const indent = match[1]?.length ?? 0;
  const markerFrom = line.from + indent;
  const markerTo = markerFrom + 1;
  const contentFrom = findBlockquoteContentStart(line.text, markerTo - line.from);
  return createNode({
    type: "blockquoteLine",
    from: line.from,
    to: line.to,
    status: "valid",
    markerRanges: [{ from: markerFrom, to: markerTo }],
    contentRanges: [{ from: line.from + contentFrom, to: line.contentTo }]
  });
}
function findBlockquoteContentStart(text3, markerEnd) {
  let pos = markerEnd;
  if (text3[pos] === " " || text3[pos] === "	") {
    pos += 1;
  }
  return pos;
}
function parseThematicBreak(line) {
  const match = /^( {0,3})((?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.exec(line.text);
  if (!match) {
    return void 0;
  }
  const indent = match[1]?.length ?? 0;
  return createNode({
    type: "thematicBreak",
    from: line.from,
    to: line.to,
    status: "valid",
    markerRanges: [{ from: line.from + indent, to: line.contentTo }]
  });
}
function parseList(lines, startIndex) {
  const first = parseListItem(lines[startIndex]);
  if (!first) {
    return void 0;
  }
  const items = [first.node];
  let nextIndex = startIndex + 1;
  while (nextIndex < lines.length) {
    const item = parseListItem(lines[nextIndex]);
    if (!item || item.kind !== first.kind) {
      break;
    }
    items.push(item.node);
    nextIndex += 1;
  }
  const last = items[items.length - 1] ?? first.node;
  return {
    node: createNode({
      type: first.kind === "ordered" ? "orderedList" : "unorderedList",
      from: first.node.from,
      to: last.to,
      status: "valid",
      children: items,
      data: first.kind === "ordered" ? { start: first.start ?? 1 } : {}
    }),
    nextIndex
  };
}
function parseListItem(line) {
  if (!line || isBlankLine(line) || parseThematicBreak(line)) {
    return void 0;
  }
  const unordered = /^( {0,3})([-+*])(?:[ \t]+|$)(.*)$/.exec(line.text);
  if (unordered) {
    const indent2 = unordered[1]?.length ?? 0;
    const marker = unordered[2];
    if (!marker) {
      return void 0;
    }
    const markerFrom2 = line.from + indent2;
    const markerTo2 = markerFrom2 + marker.length;
    const contentFrom2 = findListContentStart(line.text, markerTo2 - line.from);
    return {
      kind: "unordered",
      node: createNode({
        type: "listItem",
        from: line.from,
        to: line.to,
        status: "valid",
        markerRanges: [{ from: markerFrom2, to: markerTo2 }],
        contentRanges: [{ from: line.from + contentFrom2, to: line.contentTo }],
        data: { marker }
      })
    };
  }
  const ordered = /^( {0,3})(\d{1,9})([.)])(?:[ \t]+|$)(.*)$/.exec(line.text);
  if (!ordered) {
    return void 0;
  }
  const indent = ordered[1]?.length ?? 0;
  const numberText = ordered[2];
  const delimiter = ordered[3];
  if (!numberText || !delimiter) {
    return void 0;
  }
  const markerFrom = line.from + indent;
  const markerTo = markerFrom + numberText.length + delimiter.length;
  const contentFrom = findListContentStart(line.text, markerTo - line.from);
  return {
    kind: "ordered",
    start: Number.parseInt(numberText, 10),
    node: createNode({
      type: "listItem",
      from: line.from,
      to: line.to,
      status: "valid",
      markerRanges: [{ from: markerFrom, to: markerTo }],
      contentRanges: [{ from: line.from + contentFrom, to: line.contentTo }],
      data: { number: Number.parseInt(numberText, 10), delimiter }
    })
  };
}
function findListContentStart(text3, markerEnd) {
  let pos = markerEnd;
  while (pos < text3.length && (text3[pos] === " " || text3[pos] === "	")) {
    pos += 1;
  }
  return pos;
}
function findHeadingContentStart(text3, markerEnd) {
  let pos = markerEnd;
  while (pos < text3.length && (text3[pos] === " " || text3[pos] === "	")) {
    pos += 1;
  }
  return pos;
}
function parseTable(lines, startIndex) {
  const header = parseTableRow(lines[startIndex]);
  const delimiterLine = lines[startIndex + 1];
  const delimiter = parseTableDelimiterRow(delimiterLine);
  if (!header || !delimiter || header.cells.length < 2 || header.cells.length !== delimiter.alignments.length) {
    return void 0;
  }
  const rows = [header.node];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const row = parseTableRow(lines[nextIndex]);
    if (!row || row.cells.length === 0) {
      break;
    }
    rows.push(row.node);
    nextIndex += 1;
  }
  const last = rows[rows.length - 1] ?? header.node;
  return {
    node: createNode({
      type: "table",
      from: header.node.from,
      to: Math.max(last.to, delimiterLine.to),
      status: "valid",
      children: rows,
      data: {
        alignments: delimiter.alignments
      }
    }),
    nextIndex
  };
}
function parseTableRow(line) {
  if (!line || !line.text.includes("|")) {
    return void 0;
  }
  const cells = splitTableCells(line);
  if (cells.length === 0) {
    return void 0;
  }
  const children = cells.map(
    (cell) => createNode({
      type: "tableCell",
      from: cell.from,
      to: cell.to,
      status: "valid",
      contentRanges: [{ from: cell.from, to: cell.to }]
    })
  );
  return {
    cells: children,
    line,
    node: createNode({
      type: "tableRow",
      from: line.from,
      to: line.to,
      status: "valid",
      children,
      contentRanges: children.flatMap((cell) => cell.contentRanges ?? [])
    })
  };
}
function parseTableDelimiterRow(line) {
  const row = parseTableRow(line);
  if (!row) {
    return void 0;
  }
  const parsedAlignments = row.cells.map((cell) => parseTableDelimiterCell(row.line, cell));
  if (parsedAlignments.some((alignment) => alignment === false)) {
    return void 0;
  }
  return {
    alignments: parsedAlignments.map(
      (alignment) => alignment === true || alignment === false ? void 0 : alignment
    )
  };
}
function parseTableDelimiterCell(line, cell) {
  const text3 = line.text.slice(cell.from - line.from, cell.to - line.from).trim();
  if (!/^:?-{3,}:?$/.test(text3)) {
    return false;
  }
  const left = text3.startsWith(":");
  const right = text3.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  if (left) {
    return "left";
  }
  return true;
}
function splitTableCells(line) {
  const ranges = [];
  const text3 = line.text;
  const startsWithPipe = text3.trimStart().startsWith("|");
  const lastPipe = text3.trimEnd().length - 1;
  const endsWithPipe = text3[lastPipe] === "|" && !isEscapedPipe(text3, lastPipe);
  const start = startsWithPipe ? text3.indexOf("|") + 1 : 0;
  const end = endsWithPipe ? text3.lastIndexOf("|") : text3.length;
  let cellStart = start;
  let pos = start;
  while (pos <= end) {
    const atCellEnd = pos === end;
    const char = text3[pos];
    const escaped = isEscapedPipe(text3, pos);
    if (atCellEnd || char === "|" && !escaped) {
      ranges.push(trimTableCellRange(line.from + cellStart, line.from + pos, text3, line.from));
      cellStart = pos + 1;
    }
    pos += 1;
  }
  return Object.freeze(ranges);
}
function isEscapedPipe(text3, position) {
  let slashes = 0;
  for (let i = position - 1; i >= 0 && text3[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}
function trimTableCellRange(from, to, lineText, lineFrom) {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(lineText[start - lineFrom] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/.test(lineText[end - lineFrom - 1] ?? "")) {
    end -= 1;
  }
  return Object.freeze({ from: start, to: end });
}
function collectParagraph(lines, startIndex, extensions, allowSetext) {
  const paragraph = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || isBlankLine(line) || allowSetext && paragraph.length > 0 && /^ {0,3}(=+|-+)[ \t]*$/.test(line.text) || htmlBlockEnd(line.text, true) || parseFencedCode(lines, index) || parseBlockquote(lines, index) || parseThematicBreak(line) || parseAtxHeading(line) || parseTable(lines, index) || /^ {0,3}(?:[-+*]|1[.)])[ \t]+\S/.test(line.text) || parseExtensionBlock(line, extensions)) {
      break;
    }
    paragraph.push(line);
  }
  return paragraph;
}
function parseParagraph(source, lines, extensions) {
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) {
    return createNode({
      type: "paragraph",
      from: 0,
      to: 0,
      status: "fallback",
      contentRanges: []
    });
  }
  return createNode({
    type: "paragraph",
    from: first.from,
    to: last.to,
    status: "valid",
    contentRanges: [{ from: first.from, to: last.contentTo }],
    children: parseInlineExtensions(source, first.from, last.contentTo, extensions)
  });
}
function parseInlineExtensions(source, from, to, extensions) {
  const nodes = [];
  const text3 = source.slice(from, to);
  for (const extension of extensions) {
    if (!extension.inline) {
      continue;
    }
    const result = runMarkdownExtensionSafely(
      { extensionName: extension.id, hook: "inline" },
      () => {
        const base = compileMarkdownSyntaxPattern(extension);
        const pattern = new RegExp(base.source, `${base.flags}g`);
        return [...text3.matchAll(pattern)];
      }
    );
    if (!result.ok) {
      continue;
    }
    for (const match of result.value) {
      const matchFrom = from + (match.index ?? 0);
      const matchTo = matchFrom + match[0].length;
      if (matchTo <= matchFrom) {
        continue;
      }
      nodes.push(
        createNode({
          type: extension.nodeType,
          from: matchFrom,
          to: matchTo,
          status: "valid",
          contentRanges: [{ from: matchFrom, to: matchTo }],
          data: { extensionId: extension.id }
        })
      );
    }
  }
  return Object.freeze(nodes.sort((left, right) => left.from - right.from || left.to - right.to));
}

// packages/markdown/src/inline/parser.ts
function parseInline(source, from = 0, to = source.length) {
  if (to <= from) {
    return [];
  }
  const nodes = [];
  let pos = from;
  while (pos < to) {
    const parsed = parseHardBreak(source, pos, to) ?? parseEscape(source, pos, to) ?? parseCodeSpan(source, pos, to) ?? parseImage(source, pos, to) ?? parseLink(source, pos, to) ?? parseAutolink(source, pos, to) ?? parseStrikethrough(source, pos, to) ?? parseStrong(source, pos, to) ?? parseEmphasis(source, pos, to);
    if (parsed) {
      nodes.push(parsed.node);
      pos = parsed.next;
      continue;
    }
    const textEnd = findNextSpecial(source, pos + 1, to);
    nodes.push(createTextNode(source, pos, textEnd));
    pos = textEnd;
  }
  return Object.freeze(nodes);
}
function parseEscape(source, pos, to) {
  if (source[pos] !== "\\" || pos + 1 >= to) {
    return void 0;
  }
  return {
    node: createNode({
      type: "escape",
      from: pos,
      to: pos + 2,
      status: "valid",
      markerRanges: [{ from: pos, to: pos + 1 }],
      contentRanges: [{ from: pos + 1, to: pos + 2 }],
      data: { value: source.slice(pos + 1, pos + 2) }
    }),
    next: pos + 2
  };
}
function parseHardBreak(source, pos, to) {
  const html = source[pos] === "<" ? /^<br[ \t]*\/?>/i.exec(source.slice(pos, to))?.[0] : void 0;
  if (html)
    return {
      node: createNode({
        type: "hardBreak",
        from: pos,
        to: pos + html.length,
        status: "valid",
        markerRanges: [{ from: pos, to: pos + html.length }],
        data: { kind: "html" }
      }),
      next: pos + html.length
    };
  if (pos + 2 < to && source[pos] === " " && source[pos + 1] === " " && source[pos + 2] === "\n") {
    return {
      node: createNode({
        type: "hardBreak",
        from: pos,
        to: pos + 3,
        status: "valid",
        markerRanges: [{ from: pos, to: pos + 2 }],
        data: { kind: "spaces" }
      }),
      next: pos + 3
    };
  }
  if (pos + 1 < to && source[pos] === "\\" && source[pos + 1] === "\n") {
    return {
      node: createNode({
        type: "hardBreak",
        from: pos,
        to: pos + 2,
        status: "valid",
        markerRanges: [{ from: pos, to: pos + 1 }],
        data: { kind: "backslash" }
      }),
      next: pos + 2
    };
  }
  return void 0;
}
function parseCodeSpan(source, pos, to) {
  if (source[pos] !== "`") {
    return void 0;
  }
  const markerTo = consumeRun(source, pos, to, "`");
  const markerLength = markerTo - pos;
  const closing = findClosingRun(source, markerTo, to, "`", markerLength);
  if (closing === -1) {
    return {
      node: createNode({
        type: "inlineCode",
        from: pos,
        to,
        status: "incomplete",
        markerRanges: [{ from: pos, to: markerTo }],
        contentRanges: [{ from: markerTo, to }]
      }),
      next: to
    };
  }
  return {
    node: createNode({
      type: "inlineCode",
      from: pos,
      to: closing + markerLength,
      status: "valid",
      markerRanges: [
        { from: pos, to: markerTo },
        { from: closing, to: closing + markerLength }
      ],
      contentRanges: [{ from: markerTo, to: closing }],
      data: { value: source.slice(markerTo, closing) }
    }),
    next: closing + markerLength
  };
}
function parseImage(source, pos, to) {
  if (source.slice(pos, pos + 2) !== "![") {
    return void 0;
  }
  return parseLinkLike(source, pos, to, true);
}
function parseLink(source, pos, to) {
  if (source[pos] !== "[") {
    return void 0;
  }
  return parseLinkLike(source, pos, to, false);
}
function parseLinkLike(source, pos, to, image2) {
  const labelOpen = image2 ? pos + 1 : pos;
  const labelStart = labelOpen + 1;
  let labelClose = -1;
  for (let index = labelStart; index < to; index++) {
    if (source[index] === "\\") index++;
    else if (source[index] === "]") {
      labelClose = index;
      break;
    }
  }
  const initialMarkerRanges = image2 ? [
    { from: pos, to: pos + 1 },
    { from: labelOpen, to: labelOpen + 1 }
  ] : [{ from: labelOpen, to: labelOpen + 1 }];
  if (labelClose === -1 || labelClose >= to) {
    return {
      node: createNode({
        type: image2 ? "image" : "link",
        from: pos,
        to,
        status: "incomplete",
        markerRanges: initialMarkerRanges,
        contentRanges: [{ from: labelStart, to }]
      }),
      next: to
    };
  }
  const destinationOpen = labelClose + 1;
  if (source[destinationOpen] !== "(" || destinationOpen >= to) {
    return void 0;
  }
  const destinationStart = destinationOpen + 1;
  const destinationClose = source.indexOf(")", destinationStart);
  const markerRanges = [
    ...initialMarkerRanges,
    { from: labelClose, to: labelClose + 1 },
    { from: destinationOpen, to: destinationOpen + 1 }
  ];
  if (destinationClose === -1 || destinationClose >= to) {
    return {
      node: createNode({
        type: image2 ? "image" : "link",
        from: pos,
        to,
        status: "incomplete",
        markerRanges,
        contentRanges: [
          { from: labelStart, to: labelClose },
          { from: destinationStart, to }
        ],
        children: image2 ? [] : parseInline(source, labelStart, labelClose)
      }),
      next: to
    };
  }
  return {
    node: createNode({
      type: image2 ? "image" : "link",
      from: pos,
      to: destinationClose + 1,
      status: "valid",
      markerRanges: [...markerRanges, { from: destinationClose, to: destinationClose + 1 }],
      contentRanges: [
        { from: labelStart, to: labelClose },
        { from: destinationStart, to: destinationClose }
      ],
      children: image2 ? [] : parseInline(source, labelStart, labelClose),
      data: {
        label: source.slice(labelStart, labelClose),
        destination: source.slice(destinationStart, destinationClose)
      }
    }),
    next: destinationClose + 1
  };
}
function parseAutolink(source, pos, to) {
  if (source[pos] !== "<") {
    return void 0;
  }
  const close = source.indexOf(">", pos + 1);
  if (close === -1 || close >= to) {
    return void 0;
  }
  const value = source.slice(pos + 1, close);
  const kind = classifyAutolink(value);
  if (!kind) {
    return void 0;
  }
  return {
    node: createNode({
      type: "autolink",
      from: pos,
      to: close + 1,
      status: "valid",
      markerRanges: [
        { from: pos, to: pos + 1 },
        { from: close, to: close + 1 }
      ],
      contentRanges: [{ from: pos + 1, to: close }],
      data: { kind, value }
    }),
    next: close + 1
  };
}
function classifyAutolink(value) {
  if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/.test(value)) {
    return "url";
  }
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) {
    return "email";
  }
  return void 0;
}
function parseStrikethrough(source, pos, to) {
  if (source.slice(pos, pos + 2) !== "~~" || source[pos - 1] === "~" || source[pos + 2] === "~" || pos + 2 >= to || /\s/u.test(source[pos + 2]))
    return void 0;
  let closing = -1;
  for (let index = pos + 2; index < to; ) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "`") {
      const end = consumeRun(source, index, to, "`");
      const codeEnd = findClosingRun(source, end, to, "`", end - index);
      if (codeEnd < 0) break;
      index = codeEnd + end - index;
      continue;
    }
    if (source[index] === "~") {
      const end = consumeRun(source, index, to, "~");
      if (end - index === 2 && !/\s/u.test(source[index - 1])) {
        closing = index;
        break;
      }
      index = end;
      continue;
    }
    index++;
  }
  const contentTo = closing < 0 ? to : closing;
  return {
    node: createNode({
      type: "strikethrough",
      from: pos,
      to: closing < 0 ? to : closing + 2,
      status: closing < 0 ? "incomplete" : "valid",
      markerRanges: closing < 0 ? [{ from: pos, to: pos + 2 }] : [
        { from: pos, to: pos + 2 },
        { from: closing, to: closing + 2 }
      ],
      contentRanges: [{ from: pos + 2, to: contentTo }],
      ...closing >= 0 ? { children: parseInline(source, pos + 2, closing) } : {}
    }),
    next: closing < 0 ? to : closing + 2
  };
}
function parseStrong(source, pos, to) {
  if (pos + 2 > to || source.slice(pos, pos + 2) !== "**") {
    return void 0;
  }
  const closing = findEmphasisClosing(source, pos + 2, to, 2);
  if (closing === -1 || closing >= to) {
    return {
      node: createNode({
        type: "strong",
        from: pos,
        to,
        status: "incomplete",
        markerRanges: [{ from: pos, to: pos + 2 }],
        contentRanges: [{ from: pos + 2, to }]
      }),
      next: to
    };
  }
  return {
    node: createNode({
      type: "strong",
      from: pos,
      to: closing + 2,
      status: "valid",
      markerRanges: [
        { from: pos, to: pos + 2 },
        { from: closing, to: closing + 2 }
      ],
      contentRanges: [{ from: pos + 2, to: closing }],
      children: parseInline(source, pos + 2, closing)
    }),
    next: closing + 2
  };
}
function parseEmphasis(source, pos, to) {
  if (source[pos] !== "*" || pos + 1 < to && source[pos + 1] === "*") {
    return void 0;
  }
  const closing = findEmphasisClosing(source, pos + 1, to, 1);
  if (closing === -1 || closing >= to) {
    return {
      node: createNode({
        type: "emphasis",
        from: pos,
        to,
        status: "incomplete",
        markerRanges: [{ from: pos, to: pos + 1 }],
        contentRanges: [{ from: pos + 1, to }]
      }),
      next: to
    };
  }
  return {
    node: createNode({
      type: "emphasis",
      from: pos,
      to: closing + 1,
      status: "valid",
      markerRanges: [
        { from: pos, to: pos + 1 },
        { from: closing, to: closing + 1 }
      ],
      contentRanges: [{ from: pos + 1, to: closing }],
      children: parseInline(source, pos + 1, closing)
    }),
    next: closing + 1
  };
}
function findEmphasisClosing(source, from, to, markerLength) {
  let nestedEmphasis = false;
  for (let pos = from; pos < to; ) {
    if (source[pos] === "\\") {
      pos += 2;
      continue;
    }
    if (source[pos] === "`") {
      const markerTo = consumeRun(source, pos, to, "`");
      const closing = findClosingRun(source, markerTo, to, "`", markerTo - pos);
      if (closing === -1) {
        for (let candidate = markerTo; candidate + markerLength <= to; candidate += 1) {
          if (source[candidate] === "*" && (markerLength === 1 || source[candidate + 1] === "*")) {
            return candidate;
          }
        }
        return -1;
      }
      pos = closing + (markerTo - pos);
      continue;
    }
    if (source[pos] !== "*") {
      pos += 1;
      continue;
    }
    if (markerLength === 1) return pos;
    if (pos + 1 < to && source[pos + 1] === "*") {
      const closesNested = nestedEmphasis && pos + 2 < to && source[pos + 2] === "*";
      return pos + (closesNested ? 1 : 0);
    }
    nestedEmphasis = !nestedEmphasis;
    pos += 1;
  }
  return -1;
}
function createTextNode(source, from, to) {
  return createNode({
    type: "text",
    from,
    to,
    status: "valid",
    contentRanges: [{ from, to }],
    data: { value: source.slice(from, to) }
  });
}
function findNextSpecial(source, from, to) {
  for (let pos = from; pos < to; pos += 1) {
    const char = source[pos];
    if (char === "\\" || char === "`" || char === "*" || char === "~" && source[pos + 1] === "~" || char === "[" || char === "!" || char === "<" || char === " " && source[pos + 1] === " " && source[pos + 2] === "\n") {
      return pos;
    }
  }
  return to;
}
function consumeRun(source, from, to, char) {
  let pos = from;
  while (pos < to && source[pos] === char) {
    pos += 1;
  }
  return pos;
}
function findClosingRun(source, from, to, char, length2) {
  for (let pos = from; pos < to; pos += 1) {
    if (source[pos] !== char) {
      continue;
    }
    const end = consumeRun(source, pos, to, char);
    if (end - pos === length2) {
      return pos;
    }
    pos = end - 1;
  }
  return -1;
}

// packages/markdown/src/extensions/window-context.ts
var MAX_WINDOW = 65536;
var MAX_LINES = 256;
function nextState(state) {
  return { ...state, ...state.fence ? { fence: { ...state.fence } } : {} };
}
function htmlOpening(text3) {
  const special = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(text3);
  if (special) return `</${special[1].toLowerCase()}>`;
  if (/^ {0,3}<!--/.test(text3)) return "-->";
  if (/^ {0,3}<\?/.test(text3)) return "?>";
  if (/^ {0,3}<!\[CDATA\[/.test(text3)) return "]]>";
  if (/^ {0,3}<![A-Z]/.test(text3)) return ">";
  if (/^ {0,3}<\/?[A-Za-z][\w-]*(?:[\t >\/]|$)/.test(text3)) return "blank";
  return void 0;
}
function classify(line, state) {
  const text3 = line.text;
  if (state.uncertain) return { kind: "unknown" };
  if (state.fence) {
    const f = state.fence;
    const close = /^ {0,3}(`+|~+)[\t ]*$/.exec(text3);
    if (close && close[1][0] === f.marker && close[1].length >= f.length) {
      delete state.fence;
      return { kind: "fence", closed: true, info: f.info };
    }
    return { kind: "fence", info: f.info };
  }
  if (state.html) {
    if (state.html === "blank" && !text3.trim()) {
      delete state.html;
      return { kind: "text" };
    }
    const end = state.html;
    if (end !== "blank" && text3.toLowerCase().includes(end.toLowerCase())) delete state.html;
    return { kind: "code" };
  }
  if (/^ {0,3}(?:>|[-+*][\t ]|\d+[.)][\t ])/.test(text3) && /(?:`{3,}|~{3,}|<\/?[A-Za-z!])/.test(text3)) {
    state.uncertain = true;
    return { kind: "unknown" };
  }
  const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text3);
  if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
    state.fence = {
      marker: opening[1][0],
      length: opening[1].length,
      info: opening[2].trim().slice(0, 256)
    };
    delete state.inlineTicks;
    return { kind: "fence", opened: true, info: state.fence.info };
  }
  const html = htmlOpening(text3);
  if (html) {
    if (html === "blank" || !text3.toLowerCase().includes(html.toLowerCase())) state.html = html;
    return { kind: "code" };
  }
  if (/^(?: {4}|\t)/.test(text3)) return { kind: "code" };
  return { kind: "text" };
}
function inlineProtected(text3, from, state) {
  const ranges = [];
  let start = state.inlineTicks ? 0 : -1;
  for (let i = 0; i < text3.length; ) {
    if (text3[i] === "\\" && !state.inlineTicks) {
      i += 2;
      continue;
    }
    if (text3[i] !== "`") {
      i++;
      continue;
    }
    let end = i + 1;
    while (text3[end] === "`") end++;
    const length2 = end - i;
    if (state.inlineTicks === length2) {
      ranges.push({ from: from + start, to: from + end });
      delete state.inlineTicks;
      start = -1;
    } else if (!state.inlineTicks) {
      state.inlineTicks = length2;
      start = i;
    }
    i = end;
  }
  if (state.inlineTicks) ranges.push({ from: from + Math.max(0, start), to: from + text3.length });
  const visit = (node3) => {
    if (node3.type === "inlineCode") ranges.push({ from: from + node3.from, to: from + node3.to });
    if (node3.type === "link" || node3.type === "image") {
      const target = node3.contentRanges?.[1];
      if (target) ranges.push({ from: from + target.from, to: from + target.to });
    }
    for (const child of node3.children ?? []) visit(child);
  };
  for (const node3 of parseInline(text3)) visit(node3);
  if (/<\/?[A-Za-z!][^>]*>/.test(text3)) ranges.push({ from, to: from + text3.length });
  return ranges;
}
function linesOf(window) {
  let from = window.from;
  return window.source.split("\n").map((raw, index) => {
    const text3 = raw.replace(/\r$/, "");
    const line = { number: window.fromLine + index, from, to: from + text3.length, text: text3 };
    from += raw.length + 1;
    return line;
  }).slice(0, window.toLine - window.fromLine + 1);
}
function fallback(window, progress = {}) {
  return {
    pending: false,
    scannedThroughLine: 0,
    scannedChars: 0,
    reason: "unknown",
    ...progress,
    contextKnown: false,
    protectedRanges: [{ from: window.from, to: window.to }],
    blocks: [
      { kind: "unknown", from: window.from, to: window.to, complete: false, contentRanges: [] }
    ]
  };
}
function analyze(window, initial) {
  const state = nextState(initial), blocks = [], protectedRanges = [];
  const lines = linesOf(window);
  let fence = state.fence ? {
    from: window.from,
    contentFrom: window.from,
    info: state.fence.info,
    completeStart: false
  } : void 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], after = lines[i + 1]?.from ?? window.to;
    const kind = classify(line, state);
    if (kind.kind === "fence") {
      if (kind.opened)
        fence = { from: line.from, contentFrom: after, info: kind.info ?? "", completeStart: true };
      if (kind.closed && fence) {
        blocks.push({
          kind: "fence",
          from: fence.from,
          to: line.to,
          complete: fence.completeStart,
          info: fence.info,
          contentRanges: [{ from: Math.min(fence.contentFrom, line.from), to: line.from }]
        });
        protectedRanges.push({ from: fence.from, to: line.to });
        fence = void 0;
      }
      continue;
    }
    blocks.push({
      kind: kind.kind,
      from: line.from,
      to: line.to,
      complete: kind.kind !== "unknown",
      contentRanges: kind.kind === "text" ? [{ from: line.from, to: line.to }] : []
    });
    if (kind.kind !== "text") protectedRanges.push({ from: line.from, to: line.to });
    else protectedRanges.push(...inlineProtected(line.text, line.from, state));
  }
  if (fence) {
    blocks.push({
      kind: "fence",
      from: fence.from,
      to: window.to,
      complete: false,
      info: fence.info,
      contentRanges: [{ from: Math.min(fence.contentFrom, window.to), to: window.to }]
    });
    protectedRanges.push({ from: fence.from, to: window.to });
  }
  blocks.sort((a, b) => a.from - b.from);
  protectedRanges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged = [];
  for (const r of protectedRanges) {
    if (r.to <= r.from) continue;
    const last = merged.at(-1);
    if (last && r.from <= last.to)
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, r.to) };
    else merged.push(r);
  }
  return {
    result: {
      pending: false,
      scannedThroughLine: window.toLine,
      scannedChars: 0,
      ...state.uncertain ? { reason: "unknown" } : {},
      contextKnown: !state.uncertain,
      blocks,
      protectedRanges: merged
    },
    state
  };
}
function createMarkdownWindowContextReader(options) {
  let cachedSource, cachedVersion = -1;
  const checkpoints = /* @__PURE__ */ new Map();
  const clear = () => {
    cachedSource = void 0;
    cachedVersion = -1;
    checkpoints.clear();
  };
  return {
    clear,
    async read(window, operation = {}) {
      const source = options.source(), version = source?.version;
      const guard = () => {
        operation.signal?.throwIfAborted();
        if (!source || options.source() !== source || source.version !== version || source.documentId !== window.documentId || version !== window.version)
          throw new Error("stale Markdown context");
      };
      guard();
      if (window.source.length !== window.to - window.from || window.source.length > MAX_WINDOW || window.toLine - window.fromLine + 1 > MAX_LINES || window.fromLine < 1 || window.toLine < window.fromLine)
        return fallback(window, { reason: "oversized" });
      if (cachedSource !== source || cachedVersion !== version) {
        clear();
        cachedSource = source;
        cachedVersion = version;
        checkpoints.set(1, {});
      }
      let line = 1, state = {};
      for (const [candidate, value] of checkpoints)
        if (candidate <= window.fromLine && candidate >= line) {
          line = candidate;
          state = nextState(value);
        }
      const boundedBudget = (remaining, maximum) => {
        if (!Number.isSafeInteger(maximum) || maximum < 0 || remaining !== void 0 && (!Number.isSafeInteger(remaining) || remaining < 0))
          throw new RangeError("Invalid Markdown context budget");
        return Math.min(remaining ?? maximum, maximum);
      };
      const initialChars = boundedBudget(operation.maxScanChars, options.maxScanChars ?? 1048576);
      let chars = initialChars, remainingLines = boundedBudget(operation.maxScanLines, options.maxScanLines ?? 8192);
      while (line < window.fromLine) {
        guard();
        if (chars <= 0 || remainingLines <= 0)
          return fallback(window, {
            pending: true,
            scannedThroughLine: line - 1,
            scannedChars: initialChars - chars,
            reason: "budget"
          });
        let end = Math.min(window.fromLine - 1, line + Math.min(128, remainingLines) - 1);
        let page;
        for (; ; ) {
          try {
            page = await source.readLineWindow(line, end, Math.min(MAX_WINDOW, chars));
            break;
          } catch (error) {
            guard();
            if (!(error instanceof RangeError)) return fallback(window);
            if (end === line)
              return fallback(window, {
                pending: chars < MAX_WINDOW,
                scannedThroughLine: line - 1,
                scannedChars: initialChars - chars,
                reason: chars < MAX_WINDOW ? "budget" : "oversized"
              });
            end = line + Math.floor((end - line) / 2);
          }
        }
        guard();
        if (page.text.length > chars || page.lines.length !== end - line + 1)
          return fallback(window);
        chars -= page.text.length;
        remainingLines -= page.lines.length;
        for (const row of page.lines) {
          const kind = classify(row, state);
          if (kind.kind === "text") inlineProtected(row.text, row.from, state);
        }
        line = end + 1;
        checkpoints.set(line, nextState(state));
        await new Promise((resolve) => setTimeout(resolve, 0));
        guard();
        if (checkpoints.size > 256) {
          const first = [...checkpoints.keys()].find((key) => key !== 1);
          if (first !== void 0) checkpoints.delete(first);
        }
      }
      guard();
      return { ...analyze(window, state).result, scannedChars: initialChars - chars };
    }
  };
}

// apps/desktop/src/document-presentation-service.ts
function createDesktopDocumentPresentationService(options) {
  let revision = 0;
  const context = createMarkdownWindowContextReader({ source: () => options.current()?.source });
  const provide = async (window, operation) => {
    const initial = options.current();
    const deadline = operation.deadline ?? performance.now() + 1e4;
    const capturedTheme = options.theme();
    const generation = revision;
    const capturedSource = initial?.source;
    const capturedVersion = capturedSource?.version;
    const capturedDocumentId = capturedSource?.documentId;
    const assertCurrent = () => {
      const current = options.current();
      if (operation.signal.aborted) throw new DocumentPresentationError("aborted");
      if (!initial || generation !== revision || capturedTheme !== options.theme() || !current || initial.identity !== current.identity || window.sourceIdentity !== current.identity || current.source !== capturedSource || current.source.documentId !== capturedDocumentId || current.source.version !== capturedVersion || window.documentVersion !== void 0 && window.documentVersion !== capturedVersion)
        throw new DocumentPresentationError("revoked");
    };
    assertCurrent();
    const input = { ...window, documentId: capturedDocumentId, version: capturedVersion };
    let trusted = await context.read(input, {
      ...operation,
      maxScanChars: 8 * 1024 * 1024,
      maxScanLines: 2e5
    });
    assertCurrent();
    let scanned = trusted.scannedChars;
    for (let batch = 1; trusted.pending && batch < 128 && scanned < 8 * 1024 * 1024 && trusted.scannedThroughLine < 2e5; batch++) {
      const previousLine = trusted.scannedThroughLine;
      trusted = await context.read(input, {
        ...operation,
        maxScanChars: 8 * 1024 * 1024 - scanned,
        maxScanLines: 2e5 - trusted.scannedThroughLine
      });
      scanned += trusted.scannedChars;
      assertCurrent();
      if (trusted.pending && trusted.scannedThroughLine === previousLine && trusted.scannedChars === 0)
        break;
    }
    const request = copyDocumentPresentationRequest({
      documentId: capturedDocumentId,
      version: capturedVersion,
      source: window.source,
      from: window.from,
      to: window.to,
      fromLine: window.fromLine,
      toLine: window.toLine,
      completeStart: window.completeStart,
      completeEnd: window.completeEnd,
      contextKnown: trusted.contextKnown,
      protectedRanges: trusted.protectedRanges,
      blocks: trusted.blocks,
      selection: window.selection,
      theme: capturedTheme,
      target: options.target ?? "screen",
      width: Math.min(8192, Math.max(1, window.width))
    });
    const declarations = options.renderers().map((renderer) => ({ ...renderer }));
    if (!trusted.contextKnown)
      return { request, result: { fragments: [], complete: false }, declarations };
    const renderOne = async (declaration, input2) => {
      assertCurrent();
      const assertRendererActive = () => {
        if (!options.renderers().some(
          (active) => active.pluginId === declaration.pluginId && active.id === declaration.id
        ))
          throw new DocumentPresentationError("revoked");
      };
      assertRendererActive();
      const value = await options.render(declaration.pluginId, declaration.id, input2, {
        ...operation,
        deadline
      });
      assertCurrent();
      assertRendererActive();
      return copyDocumentPresentationResult(value, input2, declaration);
    };
    const whole = declarations.filter((d) => d.contexts.includes("text"));
    const outcomes = await Promise.allSettled(whole.map((d) => renderOne(d, request)));
    assertCurrent();
    let complete = true;
    const wholeCandidates = [];
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        complete = false;
        continue;
      }
      complete &&= outcome.value.complete;
      wholeCandidates.push(...outcome.value.fragments);
    }
    const overlaps = (a, b) => a.from < b.to && a.to > b.from;
    const conflictFree = (candidates) => candidates.filter((candidate, index) => {
      const conflict = candidates.some(
        (other, otherIndex) => index !== otherIndex && overlaps(candidate, other)
      );
      if (conflict) complete = false;
      return !conflict;
    });
    const fenceUnits = [];
    for (const block of request.blocks) {
      if (block.kind !== "fence" || !block.complete) continue;
      const language = (block.info ?? "").trim().split(/\s+/u)[0] ?? "";
      const providers = declarations.filter(
        (d) => !d.contexts.includes("text") && d.contexts.includes("fence") && d.fenceLanguages?.includes(language)
      );
      if (providers.length)
        fenceUnits.push({
          from: block.from,
          to: block.to,
          block,
          providers,
          // Do not discard competing mixed-provider output before this entire
          // fence's providers have been checked for conflicts.
          candidates: wholeCandidates.filter((candidate) => overlaps(candidate, block))
        });
    }
    const textCandidates = wholeCandidates.filter(
      (candidate) => !fenceUnits.some((unit) => overlaps(candidate, unit))
    );
    const units2 = [
      ...fenceUnits,
      ...conflictFree(textCandidates).map((candidate) => ({
        from: candidate.from,
        to: candidate.to,
        providers: [],
        candidates: [candidate]
      }))
    ];
    const visibleFrom = Number.isSafeInteger(window.visibleFrom) ? Math.max(request.from, Math.min(request.to, window.visibleFrom)) : request.from;
    const visibleTo = Number.isSafeInteger(window.visibleTo) ? Math.max(visibleFrom, Math.min(request.to, window.visibleTo)) : request.to;
    const distance = (unit) => unit.to <= visibleFrom ? visibleFrom - unit.to : unit.from >= visibleTo ? unit.from - visibleTo : 0;
    units2.sort(
      (a, b) => distance(a) - distance(b) || Math.abs(a.from - visibleFrom) - Math.abs(b.from - visibleFrom) || a.from - b.from
    );
    const fragments = [];
    for (const unit of units2) {
      assertCurrent();
      let candidates = [...unit.candidates];
      if (unit.block) {
        if (deadline - performance.now() < DOCUMENT_PRESENTATION_LIMITS.timeoutMs + 100) {
          complete = false;
          break;
        }
        const block = unit.block;
        const source = request.source.slice(block.from - request.from, block.to - request.from);
        const fromLine = request.fromLine + request.source.slice(0, block.from - request.from).split("\n").length - 1;
        const input2 = copyDocumentPresentationRequest({
          ...request,
          source,
          from: block.from,
          to: block.to,
          fromLine,
          toLine: fromLine + source.split("\n").length - 1,
          completeStart: request.completeStart && block.from === request.from,
          completeEnd: request.completeEnd && block.to === request.to,
          blocks: [block],
          protectedRanges: request.protectedRanges.filter((range2) => overlaps(range2, block)).map((range2) => ({
            from: Math.max(range2.from, block.from),
            to: Math.min(range2.to, block.to)
          }))
        });
        const results = await Promise.allSettled(unit.providers.map((d) => renderOne(d, input2)));
        assertCurrent();
        for (const outcome of results) {
          if (outcome.status === "rejected") {
            complete = false;
            continue;
          }
          complete &&= outcome.value.complete;
          candidates.push(...outcome.value.fragments);
        }
        candidates = conflictFree(candidates);
      }
      if (!candidates.length) continue;
      const next = [...fragments, ...candidates].sort((a, b) => a.from - b.from || a.to - b.to);
      try {
        copyDocumentPresentationAggregate({ fragments: next, complete }, request, declarations);
      } catch {
        complete = false;
        break;
      }
      fragments.splice(0, fragments.length, ...next);
    }
    assertCurrent();
    return {
      request,
      result: copyDocumentPresentationAggregate({ fragments, complete }, request, declarations),
      declarations
    };
  };
  return Object.freeze({
    provide,
    invalidate: () => {
      revision++;
    },
    clear: () => {
      revision++;
      context.clear();
    }
  });
}

// apps/desktop/src/output-presentations.ts
async function collectOutputPresentations(options) {
  const presentations = [];
  const warnings = [];
  const warn = (code, message) => {
    if (!warnings.some((warning) => warning.code === code && warning.message === message))
      warnings.push({ code, message });
  };
  const guard = () => {
    if (options.signal.aborted) throw new DocumentPresentationError("aborted");
    options.assertCurrent();
  };
  guard();
  if (options.source.length > 2 * 1024 * 1024) {
    warn(
      "presentation-oversized",
      "Rich export exceeds the source limit; original Markdown is retained."
    );
    return { presentations, warnings };
  }
  if (!(options.completeStart ?? options.sourceOffset === 0) || options.completeEnd === false) {
    warn(
      "presentation-selection-context",
      "The selection has incomplete document context; original Markdown is retained for rich content."
    );
    return { presentations, warnings };
  }
  if (!options.source || !options.renderers().length) return { presentations, warnings };
  const document = new MemoryTextDocument(options.source);
  const memory = new MemoryDocumentSource({
    documentId: options.documentId,
    version: options.version,
    document
  });
  const source = {
    documentId: options.documentId,
    version: options.version,
    lineCount: memory.lineCount,
    async readLineWindow(from, to, max) {
      guard();
      const window = await memory.readLineWindow(from, to, max);
      guard();
      return {
        ...window,
        from: window.from + options.sourceOffset,
        to: window.to + options.sourceOffset,
        lines: window.lines.map((line) => ({
          ...line,
          from: line.from + options.sourceOffset,
          to: line.to + options.sourceOffset
        }))
      };
    }
  };
  const absoluteLines = (request) => copyDocumentPresentationRequest({
    ...request,
    fromLine: request.fromLine + options.fromLine - 1,
    toLine: request.toLine + options.fromLine - 1
  });
  const service = createDesktopDocumentPresentationService({
    current: () => {
      guard();
      return { source, identity: document };
    },
    theme: () => "light",
    target: "export",
    renderers: options.renderers,
    async render(pluginId, rendererId, request, preparation) {
      guard();
      const controller = new AbortController();
      let timer;
      let abort;
      try {
        const remaining = preparation.deadline - performance.now();
        if (remaining <= 0) throw new DocumentPresentationError("timeout");
        const cancellation = new Promise((_resolve, reject) => {
          abort = () => {
            controller.abort();
            reject(new DocumentPresentationError("aborted"));
          };
          options.signal.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => {
            reject(new DocumentPresentationError("timeout"));
            controller.abort();
          }, remaining);
        });
        const result = await Promise.race([
          options.render(pluginId, rendererId, absoluteLines(request), {
            signal: controller.signal
          }),
          cancellation
        ]);
        guard();
        if (performance.now() >= preparation.deadline) {
          controller.abort();
          throw new DocumentPresentationError("timeout");
        }
        if (!result.complete || result.fragments.some((fragment) => fragment.status === "error"))
          warn(
            "presentation-incomplete",
            "Some rich content could not be rendered completely; original Markdown is retained where needed."
          );
        return result;
      } catch (error) {
        guard();
        const timeout = error instanceof DocumentPresentationError && error.code === "timeout";
        warn(
          timeout ? "presentation-timeout" : "presentation-unavailable",
          timeout ? "A rich renderer timed out; original Markdown is retained." : "A rich renderer was unavailable or rejected its input; original Markdown is retained."
        );
        throw error;
      } finally {
        clearTimeout(timer);
        if (abort) options.signal.removeEventListener("abort", abort);
      }
    }
  });
  const lineStarts = [0];
  for (let index = 0; index < options.source.length; index++)
    if (options.source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  const lineAt = (offset) => {
    let low = 0, high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return low + 1;
  };
  const fits = (from, to) => to - from <= DOCUMENT_PRESENTATION_LIMITS.inputUtf16 && lineAt(to) - lineAt(from) + 1 <= DOCUMENT_PRESENTATION_LIMITS.inputLines;
  const chunks = [];
  let pending;
  const flush = () => {
    if (pending) chunks.push(pending);
    pending = void 0;
  };
  const blocks = parseMarkdown(options.source).root.children ?? [];
  for (const [index, block] of blocks.entries()) {
    const from = block.from, to = blocks[index + 1]?.from ?? options.source.length;
    if (!fits(from, to)) {
      flush();
      warn(
        "presentation-oversized",
        "A Markdown block exceeds the rich renderer input limit; its original source is retained."
      );
      continue;
    }
    if (pending && !fits(pending.from, to)) flush();
    pending = { from: pending?.from ?? from, to };
  }
  flush();
  if (chunks.length > 1)
    warn(
      "presentation-windowed",
      "Rich content is rendered in bounded Markdown windows; extensions spanning windows retain their original source."
    );
  for (const chunk of chunks) {
    guard();
    const text3 = options.source.slice(chunk.from, chunk.to);
    const response = await service.provide(
      {
        sourceIdentity: document,
        documentVersion: options.version,
        sourceVersion: options.version,
        source: text3,
        from: chunk.from + options.sourceOffset,
        to: chunk.to + options.sourceOffset,
        fromLine: lineAt(chunk.from),
        toLine: lineAt(chunk.to),
        completeStart: true,
        completeEnd: true,
        selection: options.selection,
        width: 760
      },
      { signal: options.signal }
    );
    guard();
    if (!response.result.complete)
      warn(
        "presentation-incomplete",
        "Some rich content could not be rendered completely; original Markdown is retained where needed."
      );
    for (const block of response.request.blocks) {
      if (block.kind !== "fence") continue;
      const language = (block.info ?? "").trim().split(/\s+/u)[0] ?? "";
      const supported = response.declarations.some(
        (renderer) => renderer.contexts.includes("fence") && renderer.fenceLanguages?.includes(language)
      );
      if (supported && !response.result.fragments.some(
        (fragment) => fragment.from <= block.from && fragment.to >= block.to
      ))
        warn(
          "presentation-unsupported",
          "A rich fenced block was unsupported or incomplete; its original Markdown is retained."
        );
    }
    presentations.push({ ...response, request: absoluteLines(response.request) });
  }
  guard();
  return { presentations, warnings };
}

// ../milkup-plugin-lifecycle-evidence/milestone01/reproduce-readiness.ts
import { writeFileSync } from "node:fs";
var records = [];
for (const source of ["A[^x]\n[^x]: body", "Plain document without footnotes"]) {
  let invalidate;
  const ready = new Promise((r) => invalidate = r);
  let offset = 0, reads = 0, invalidations = 0;
  const lines = source.split("\n").map((text3, i) => {
    const line = { number: i + 1, from: offset, to: offset + text3.length, text: text3 };
    offset += text3.length + 1;
    return line;
  });
  const controller = createFootnoteController({ readWindow: async () => {
    reads++;
    return { documentId: "doc", version: 7, fromLine: 1, toLine: lines.length, from: 0, to: source.length, text: source, totalLines: lines.length, completeStart: true, completeEnd: true, lines };
  }, invalidatePresentation: async () => {
    invalidations++;
    invalidate();
  } });
  const options = { source, sourceOffset: 0, documentId: "doc", version: 7, fromLine: 1, selection: { anchor: 0, head: 0 }, signal: new AbortController().signal, assertCurrent: () => {
  }, renderers: () => [{ pluginId: "any-enabled-plugin", id: "arbitrary-text-renderer", contexts: ["text"] }], render: async (_p, _r, request, operation) => controller.render(request, operation) };
  const first = await collectOutputPresentations(options);
  const readsAtFirstReturn = reads;
  await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(Error("scan did not finish")), 1e3))]);
  const repeat = await collectOutputPresentations(options);
  records.push({ source, readsAtFirstReturn, reads, invalidations, first, repeat });
  controller.dispose();
}
writeFileSync("/workspace/milkup-plugin-lifecycle-evidence/milestone01/reproduce-readiness.json", JSON.stringify({ baseline: "1388f646", scope: "Local controlled production-controller/collector reproduction, not nativeUI. No product files modified.", records }, null, 2) + "\n");
var reproduces = records.every((r) => r.readsAtFirstReturn === 0 && r.first.warnings.some((w) => w.code === "presentation-incomplete") && r.first.presentations.every((b) => b.result.fragments.length === 0 && !b.result.complete) && r.repeat.warnings.length === 0 && r.repeat.presentations.every((b) => b.result.complete));
console.log(JSON.stringify({ reproduces, firstComplete: records.map((r) => r.first.presentations.every((b) => b.result.complete)), repeatComplete: records.map((r) => r.repeat.presentations.every((b) => b.result.complete)) }));
process.exit(process.argv.includes("--expect-ready-first") ? records.every((r) => r.first.presentations.every((b) => b.result.complete)) ? 0 : 1 : reproduces ? 0 : 2);
