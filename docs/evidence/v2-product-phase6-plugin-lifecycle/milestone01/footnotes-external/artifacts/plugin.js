// node_modules/.pnpm/@milkup+plugin-sdk@file+..+..+workspace+milkup-plugin-lifecycle-evidence+milestone01+sd_3f4117e08c6f745f6f5dee1c5c053f87/node_modules/@milkup/plugin-sdk/src/index.js
function definePlugin(plugin) {
  return plugin;
}

// src/indexer.ts
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
  body(text2) {
    const active = this.active;
    if (!active) return;
    const value = active.body + (this.blank ? "\n\n" : "\n") + text2;
    this.blank = false;
    const body = value.slice(0, this.maxBody);
    const truncated = active.truncated || value.length > this.maxBody;
    if (body !== active.body || truncated !== active.truncated) this.outputRevision++;
    active.body = body;
    active.truncated = truncated;
  }
  consume(line) {
    if (this.partialReason) return;
    const text2 = line.text;
    if (this.fence) {
      const close = /^ {0,3}(`+|~+)[\t ]*$/.exec(text2);
      if (close && close[1][0] === this.fence.marker && close[1].length >= this.fence.length)
        this.fence = void 0;
      return;
    }
    if (this.html) {
      if (this.html === "blank" && !text2.trim()) this.html = void 0;
      else if (this.html !== "blank" && text2.toLowerCase().includes(this.html))
        this.html = void 0;
      return;
    }
    if (this.active) {
      if (!text2.trim()) {
        this.blank = true;
        return;
      }
      const continuation = /^(?: {4}|\t)(.*)$/.exec(text2);
      if (continuation) {
        this.body(continuation[1]);
        return;
      }
      this.active = void 0;
      this.blank = false;
    }
    if (/^ {0,3}(?:>|[-+*][\t ]|\d+[.)][\t ])/.test(text2)) {
      if (/`{3,}|~{3,}|<\/?[A-Za-z!]/.test(text2)) this.limit("nested-context");
      return;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text2);
    if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      this.fence = { marker: fence[1][0], length: fence[1].length };
      this.ticks = 0;
      return;
    }
    if (/^(?: {4}|\t)/.test(text2)) return;
    const html = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(text2);
    const end = html ? `</${html[1].toLowerCase()}>` : /^ {0,3}<!--/.test(text2) ? "-->" : /^ {0,3}<\?/.test(text2) ? "?>" : /^ {0,3}<!\[CDATA\[/.test(text2) ? "]]>" : /^ {0,3}<![A-Z]/.test(text2) ? ">" : /^ {0,3}<\/?[A-Za-z][\w-]*(?:[\t >\/]|$)/.test(text2) ? "blank" : void 0;
    if (end) {
      if (end === "blank" || !text2.toLowerCase().includes(end)) this.html = end;
      return;
    }
    if (/<\/?[A-Za-z!][^>]*>/.test(text2)) return;
    if (!this.ticks) {
      const definition = /^ {0,3}\[\^([^\]\r\n]{1,128})\]:[\t ]?(.*)$/.exec(text2);
      const key = definition && normalizeLabel(definition[1]);
      if (definition && key) {
        if (!this.reserve()) return;
        const body = definition[2];
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
    for (let i = 0; i < text2.length; ) {
      if (text2[i] === "\\" && !this.ticks) {
        i += 2;
        continue;
      }
      if (text2[i] === "`") {
        let end2 = i + 1;
        while (text2[end2] === "`") end2++;
        const count = end2 - i;
        if (this.ticks === count) this.ticks = 0;
        else if (!this.ticks) this.ticks = count;
        i = end2;
        continue;
      }
      if (this.ticks) {
        i++;
        continue;
      }
      if (text2[i] === "[" || text2[i] === "!" && text2[i + 1] === "[") {
        const open = text2[i] === "!" ? i + 1 : i;
        let close = open + 1;
        for (; close < text2.length; close++) {
          if (text2[close] === "\\") close++;
          else if (text2[close] === "]") break;
        }
        if (close >= text2.length) return;
        if (text2[close + 1] === "(") {
          let end2 = close + 2;
          for (; end2 < text2.length; end2++) {
            if (text2[end2] === "\\") end2++;
            else if (text2[end2] === ")") break;
          }
          i = Math.min(text2.length, end2 + 1);
          continue;
        }
        if (text2[i] === "!" || text2[open + 1] !== "^") {
          i = close + 1;
          continue;
        }
      }
      if (text2[i] === "[" && text2[i + 1] === "^") {
        const close = text2.indexOf("]", i + 2);
        if (close > i && close - i <= 131) {
          const key = normalizeLabel(text2.slice(i + 2, close));
          if (key) {
            if (!this.reserve()) return;
            let number = this.numbers.get(key);
            if (number === void 0) {
              number = this.numbers.size + 1;
              this.numbers.set(key, number);
            }
            this.outputRevision++;
            this.references.push({
              key,
              number,
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

// src/presentation.ts
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
    const definition = index.definitions.get(ref.key);
    if (definition) {
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
                from: definition.from,
                to: definition.to
              }
            }
          ]
        },
        accessibleText: `\u811A\u6CE8 ${ref.number}\uFF0C${ref.key}\uFF1A${definition.body.slice(0, 256)}${definition.truncated || definition.body.length > 256 ? "\uFF08\u6458\u8981\u5DF2\u622A\u65AD\uFF09" : ""}`
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
    const references = index.references.filter((r) => r.key === def.key), number = references[0]?.number, duplicate = index.definitions.get(def.key) !== def;
    const children = [text(number === void 0 ? `\u811A\u6CE8 ${def.key}\uFF1A` : `[${number}] `)];
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
      accessibleText: `${number === void 0 ? "\u672A\u5F15\u7528\u7684\u811A\u6CE8" : `\u811A\u6CE8 ${number}`} ${def.key}\u3002${message ?? ""}`,
      ...message ? { status: duplicate ? "error" : "ready", message } : {}
    });
  }
  fragments.sort((a, b) => a.from - b.from || a.to - b.to);
  return { fragments, complete: index.complete && fragments.length < 128 };
}

// src/controller.ts
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
      const result = present(request, current.index);
      return request.contextKnown && !current.abort.signal.aborted && !current.index.complete && !current.index.partialReason ? { ...result, pending: true } : result;
    },
    dispose() {
      if (!active) return;
      active = false;
      stop();
      current = void 0;
    }
  };
}

// src/plugin.ts
var plugin_default = definePlugin({
  activate(context) {
    const document = context.host.document;
    if (!document?.readWindow || !document.invalidatePresentation)
      throw new Error("Footnotes requires the SDK 0.3.3 document window host");
    const controller = createFootnoteController(document);
    return {
      documentRenderers: { footnotes: (request, options) => controller.render(request, options) },
      dispose: () => controller.dispose()
    };
  }
});
export {
  plugin_default as default
};
