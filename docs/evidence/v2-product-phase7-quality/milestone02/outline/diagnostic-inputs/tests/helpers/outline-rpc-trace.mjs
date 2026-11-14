// Diagnostic only. Host-realm monotonic times; no source/title/key/value contents retained.
export async function installOutlineRpcTrace(app, panel) {
  await app.execute(
    installInPage.toString() + ";return installInPage(arguments[0])",
    panel,
  );
}

function installInPage(panel) {
  const originalWorker = window.Worker;
  const trace = {
    phase: "install",
    events: [],
    dropped: 0,
    workerCount: 0,
    pendingDropped: 0,
    observerMs: 0,
    completed: {},
    frameGaps: {},
  };
  const limit = 16384;
  const safe = (v) =>
    typeof v === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(v) ? v : undefined;
  const add = (event) => {
    if (trace.events.length < limit)
      trace.events.push({
        at: performance.now(),
        phase: trace.phase,
        ...event,
      });
    else trace.dropped++;
  };
  const numericState = (state) => {
    const result = {};
    for (const key of [
      "documentVersion",
      "selectionRevision",
      "from",
      "to",
      "start",
      "end",
      "fromIndex",
      "toIndex",
      "count",
      "itemHeight",
    ])
      if (Number.isFinite(state?.[key])) result[key] = state[key];
    return result;
  };
  const outputMetadata = (value) => {
    const pending = [value];
    let visited = 0;
    while (pending.length && visited++ < 6000) {
      const node = pending.pop();
      if (!node || typeof node !== "object") continue;
      const attributes = node.attributes ?? node.attrs;
      if (attributes?.["data-virtual-list"]) {
        const result = {};
        for (const key of ["start", "end", "total", "revision", "active"]) {
          const n = Number(attributes["data-virtual-" + key]);
          if (Number.isFinite(n)) result[key] = n;
        }
        return result;
      }
      if (Array.isArray(node)) pending.push(...node);
      else {
        if (Array.isArray(node.children)) pending.push(...node.children);
        if (node.output) pending.push(node.output);
      }
    }
    return undefined;
  };
  window.Worker = new Proxy(originalWorker, {
    construct(target, args, newTarget) {
      const worker = Reflect.construct(target, args, newTarget);
      const workerId = ++trace.workerCount;
      const pending = new Map();
      const record = (direction, message) => {
        const started = performance.now();
        try {
          if (!message || typeof message !== "object") return;
          const protocol = safe(message.protocol),
            id = safe(String(message.id));
          if (!protocol?.startsWith("milkup.") || !id) return;
          if (message.type === "request") {
            const method = safe(message.method);
            if (!method) return;
            const key = direction + ":" + protocol + ":" + id;
            const payload = message.payload;
            const row = {
              kind: "rpc-request",
              workerId,
              direction,
              protocol,
              id,
              method,
              renderPhase: safe(payload?.context?.node?.phase),
              command: safe(payload?.command?.id),
              state: numericState(payload?.context?.node),
              viewport: numericState(payload?.context?.node?.virtualViewport),
              keys: Array.isArray(payload?.keys)
                ? payload.keys.length
                : undefined,
              entries: Array.isArray(payload?.entries)
                ? payload.entries.length
                : undefined,
              valueCodeUnits: Array.isArray(payload?.entries)
                ? payload.entries.reduce(
                    (n, e) =>
                      n + (typeof e.value === "string" ? e.value.length : 0),
                    0,
                  )
                : undefined,
            };
            if (pending.size < 2048)
              pending.set(key, {
                at: performance.now(),
                phase: trace.phase,
                method,
              });
            else trace.pendingDropped++;
            add(row);
          } else if (message.type === "response") {
            const key =
              (direction === "host-to-worker"
                ? "worker-to-host"
                : "host-to-worker") +
              ":" +
              protocol +
              ":" +
              id;
            const request = pending.get(key);
            if (!request) return;
            pending.delete(key);
            const durationMs = performance.now() - request.at;
            const group = request.phase + "|" + protocol + "|" + request.method;
            const stats = (trace.completed[group] ??= {
              count: 0,
              totalMs: 0,
              maxMs: 0,
              failed: 0,
            });
            stats.count++;
            stats.totalMs += durationMs;
            stats.maxMs = Math.max(stats.maxMs, durationMs);
            if (!message.ok) stats.failed++;
            add({
              kind: "rpc-response",
              workerId,
              direction,
              protocol,
              id,
              method: request.method,
              requestPhase: request.phase,
              durationMs,
              ok: message.ok,
              output:
                request.method === "render"
                  ? outputMetadata(message.value)
                  : undefined,
              returnedValues: Array.isArray(message.value)
                ? message.value.length
                : undefined,
              returnedCodeUnits: Array.isArray(message.value)
                ? message.value.reduce(
                    (n, v) => n + (typeof v === "string" ? v.length : 0),
                    0,
                  )
                : undefined,
            });
          }
        } finally {
          trace.observerMs += performance.now() - started;
        }
      };
      worker.addEventListener("message", (event) =>
        record("worker-to-host", event.data),
      );
      const send = worker.postMessage;
      worker.postMessage = function (...args) {
        record("host-to-worker", args[0]);
        return Reflect.apply(send, this, args);
      };
      return worker;
    },
  });
  let frame = null,
    previous = "",
    heartbeat,
    previousHeartbeat,
    targetSeen = new Set();
  const beat = (at) => {
    if (previousHeartbeat !== undefined) {
      const gap = at - previousHeartbeat;
      const stats = (trace.frameGaps[trace.phase] ??= {
        count: 0,
        totalMs: 0,
        maxMs: 0,
        over50ms: 0,
      });
      stats.count++;
      stats.totalMs += gap;
      stats.maxMs = Math.max(stats.maxMs, gap);
      if (gap > 50) stats.over50ms++;
    }
    previousHeartbeat = at;
    heartbeat = requestAnimationFrame(beat);
  };
  heartbeat = requestAnimationFrame(beat);
  const sample = () => {
    frame = null;
    const started = performance.now();
    const element = document.querySelector(panel);
    const list = element?.querySelector("[data-virtual-list]");
    const items = [...(element?.querySelectorAll(".plugin-list-item") ?? [])];
    const row = {
      kind: "dom",
      rows: items.length,
      start: Number(list?.dataset.virtualStart),
      end: Number(list?.dataset.virtualEnd),
      total: Number(list?.dataset.virtualTotal),
      revision: Number(list?.dataset.virtualRevision),
      activeRank: items.findIndex(
        (e) => e.getAttribute("aria-current") === "location",
      ),
      cursor: Number(
        document.querySelector(".milkup-cursor")?.dataset.position,
      ),
      documentVersion: Number(
        document.querySelector('[data-stat="version"]')?.textContent,
      ),
      scrollTop: list?.scrollTop,
    };
    const signature = JSON.stringify(row);
    if (signature !== previous) {
      previous = signature;
      add(row);
    }
    const measurement = window.__p7Measure,
      goal = measurement?.goal;
    if (goal && measurement.start !== null && !targetSeen.has(trace.phase)) {
      const range =
        row.start >= 0 &&
        row.end <= row.total &&
        row.end >= row.start &&
        items.length === row.end - row.start;
      const full = element
        ?.querySelector(".plugin-list-summary")
        ?.textContent?.startsWith("全文索引完成");
      const states = items.map((e) => e.closest('[role="treeitem"]'));
      const folded =
        goal.command === "outline.collapseAll"
          ? row.start === 0 &&
            row.end === goal.count &&
            states.every(
              (e) =>
                e?.getAttribute("aria-level") === "1" &&
                e.getAttribute("aria-expanded") !== "true",
            )
          : goal.command === "outline.expandAll"
            ? states.every((e) => e?.getAttribute("aria-expanded") !== "false")
            : true;
      const matches =
        goal.kind === "index" || goal.kind === "fold"
          ? full && range && folded && row.total === goal.count
          : goal.kind === "navigate"
            ? row.cursor === goal.cursor &&
              items.some(
                (e) =>
                  e.title === goal.title &&
                  e.getAttribute("aria-current") === "location",
              )
            : goal.kind === "scroll"
              ? list?.scrollTop !== goal.scrollTop &&
                Math.floor(
                  list.scrollTop / Number(list.dataset.virtualItemHeight),
                ) >= row.start &&
                Math.ceil(
                  (list.scrollTop + list.clientHeight) /
                    Number(list.dataset.virtualItemHeight),
                ) <= row.end
              : false;
      if (matches) {
        targetSeen.add(trace.phase);
        add({
          kind: "target-first-observed",
          driverAckAlready: Boolean(measurement.triggerFinished),
          start: measurement.start,
        });
      }
    }
    trace.observerMs += performance.now() - started;
  };
  const observer = new MutationObserver(() => {
    if (frame === null) frame = requestAnimationFrame(sample);
  });
  observer.observe(document.querySelector("#app"), {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const input = (event) => {
    if (!event.isTrusted) return;
    add({
      kind: "input",
      type: event.type,
      code: safe(event.code),
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      command: safe(
        event.target.closest?.("[data-plugin-command]")?.dataset.pluginCommand,
      ),
      deltaY: Number.isFinite(event.deltaY) ? event.deltaY : undefined,
    });
  };
  for (const type of ["click", "keydown", "wheel"])
    document.addEventListener(type, input, true);
  window.__p7RpcTrace = {
    setPhase(name) {
      trace.phase = name;
      previousHeartbeat = undefined;
      add({ kind: "phase" });
    },
    snapshot() {
      return trace;
    },
    dispose() {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      cancelAnimationFrame(heartbeat);
      for (const type of ["click", "keydown", "wheel"])
        document.removeEventListener(type, input, true);
      window.Worker = originalWorker;
    },
  };
  add({ kind: "installed", eventLimit: limit });
}
