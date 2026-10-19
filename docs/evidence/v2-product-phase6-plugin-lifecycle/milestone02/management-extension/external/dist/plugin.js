// node_modules/.pnpm/@milkup+plugin-sdk@file+vendor+plugin-sdk.tgz/node_modules/@milkup/plugin-sdk/src/index.js
function definePlugin(plugin) {
  return plugin;
}

// src/controller.ts
var message = (error) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unavailable";
  return {
    stale: "\u63D2\u4EF6\u76EE\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u67E5\u770B\u3002",
    revoked: "\u7BA1\u7406\u6743\u9650\u5DF2\u64A4\u9500\uFF0C\u8BF7\u4F7F\u7528\u83DC\u5355\u4E2D\u7684\u5BBF\u4E3B\u63D2\u4EF6\u7BA1\u7406\u5165\u53E3\u3002",
    "gesture-required": "\u8BF7\u76F4\u63A5\u70B9\u51FB\u6309\u94AE\u6253\u5F00\u5BBF\u4E3B\u8BE6\u60C5\u3002",
    "not-found": "\u63D2\u4EF6\u5DF2\u4E0D\u5728\u76EE\u5F55\u4E2D\uFF0C\u8BF7\u5237\u65B0\u3002",
    aborted: "\u64CD\u4F5C\u5DF2\u53D6\u6D88\u3002",
    busy: "\u63D2\u4EF6\u7BA1\u7406\u6B63\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"
  }[code] ?? "\u65E0\u6CD5\u8BFB\u53D6\u63D2\u4EF6\u4FE1\u606F\uFF0C\u8BF7\u5728\u5BBF\u4E3B\u63D2\u4EF6\u7BA1\u7406\u4E2D\u68C0\u67E5\u6216\u91CD\u8BD5\u3002";
};
function createController(host, changed = () => {
}) {
  let active = true, epoch = 0, request;
  let state = {
    phase: "loading",
    snapshot: void 0,
    details: void 0,
    busy: false,
    message: ""
  };
  const update = (patch) => {
    state = { ...state, ...patch };
    changed();
  };
  const stop = () => {
    epoch++;
    request?.abort();
    request = void 0;
  };
  const start = () => {
    stop();
    request = new AbortController();
    return { current: epoch, signal: request.signal };
  };
  const current = (value) => active && epoch === value;
  return {
    get state() {
      return state;
    },
    async refresh() {
      if (!active) return;
      const job = start();
      update({ phase: "loading", details: void 0, busy: true, message: "" });
      if (!host) {
        update({
          phase: "error",
          busy: false,
          message: "\u63D2\u4EF6\u7BA1\u7406\u80FD\u529B\u4E0D\u53EF\u7528\u6216\u5C1A\u672A\u6279\u51C6\u6743\u9650\uFF1B\u8BF7\u6253\u5F00\u5BBF\u4E3B\u63D2\u4EF6\u7BA1\u7406\u3002"
        });
        return;
      }
      try {
        const snapshot = await host.snapshot({ signal: job.signal });
        if (current(job.current)) update({ snapshot, phase: "ready", busy: false });
      } catch (error) {
        if (current(job.current)) update({ phase: "error", busy: false, message: message(error) });
      }
    },
    async select(id) {
      if (!active || !host || !state.snapshot?.items.some((item) => item.id === id)) return;
      const revision = state.snapshot.revision, job = start();
      update({ busy: true, message: "" });
      try {
        const details = await host.describe({ pluginId: id, revision }, { signal: job.signal });
        if (details.pluginId !== id || details.revision !== revision) throw { code: "stale" };
        if (current(job.current)) update({ details, busy: false, phase: "ready" });
      } catch (error) {
        if (current(job.current)) update({ busy: false, message: message(error) });
      }
    },
    async openTrusted(commandHost, view) {
      if (!active || !state.details || state.busy) return;
      const details = state.details, job = start();
      update({ busy: true, message: "" });
      try {
        if (!commandHost) throw { code: "unavailable" };
        const opening = commandHost.requestHostView(
          { pluginId: details.pluginId, revision: details.revision, view },
          { signal: job.signal }
        );
        const result = await opening;
        if (current(job.current))
          update({
            busy: false,
            message: result.status === "opened" ? "\u5DF2\u6253\u5F00\u5BBF\u4E3B\u9875\u9762\uFF1B\u6279\u51C6\u4E0E\u53D8\u66F4\u4ECD\u9700\u5728\u5BBF\u4E3B\u4E2D\u786E\u8BA4\u3002" : "\u5DF2\u53D6\u6D88\u6253\u5F00\u5BBF\u4E3B\u9875\u9762\u3002"
          });
      } catch (error) {
        if (current(job.current)) update({ busy: false, message: message(error) });
      }
    },
    back() {
      if (!active) return;
      stop();
      update({ details: void 0, busy: false, message: "" });
    },
    close() {
      stop();
      update({ details: void 0, busy: false, message: "" });
    },
    dispose() {
      if (!active) return;
      active = false;
      stop();
    }
  };
}

// src/view.ts
var text = (value) => ({ type: "element", tag: "span", text: value });
var group = (children, className) => ({
  type: "element",
  tag: "span",
  children,
  ...className ? { attributes: { class: className } } : {}
});
var button = (command, label, disabled = false, input) => ({
  type: "element",
  tag: "button",
  text: label,
  disabled,
  action: { command, ...input === void 0 ? {} : { input } }
});
var field = (label, value) => group([text(`${label}\uFF1A`), text(value)], "plugin-list-item");
var stateLabels = {
  enabled: "\u5DF2\u542F\u7528",
  disabled: "\u5DF2\u505C\u7528",
  failed: "\u8FD0\u884C\u5931\u8D25",
  pending: "\u7B49\u5F85\u5BA1\u9605",
  removed: "\u5DF2\u5378\u8F7D"
};
function render(state) {
  const nodes = [];
  if (state.details) {
    const d = state.details, c = d.compatibility;
    nodes.push(
      button("management.back", "\u8FD4\u56DE\u63D2\u4EF6\u5217\u8868", state.busy),
      { type: "element", tag: "strong", text: d.title },
      text(d.description)
    );
    nodes.push(
      field("\u7248\u672C", d.version),
      field("\u72B6\u6001", stateLabels[d.state]),
      field("\u6267\u884C\u73AF\u5883", d.host),
      field("\u76EE\u5F55\u4EE3\u6B21", String(d.entryRevision))
    );
    if (d.candidate)
      nodes.push(field("\u5F85\u5BA1\u5019\u9009", d.candidate.version), field("\u5019\u9009\u6307\u7EB9", d.candidate.fingerprint));
    nodes.push(
      field(
        "\u517C\u5BB9\u6027",
        c.compatible ? "\u6EE1\u8DB3\u5F53\u524D\u5BBF\u4E3B\u8981\u6C42" : "\u4E0D\u517C\u5BB9\uFF1B\u8BF7\u9009\u62E9\u9002\u7528\u4E8E\u5F53\u524D\u5BBF\u4E3B\u7684\u63D2\u4EF6\u7248\u672C\uFF0C\u6216\u5728\u5BBF\u4E3B\u66F4\u65B0\u540E\u91CD\u65B0\u68C0\u67E5\u3002"
      ),
      field("\u5BBF\u4E3B\u7248\u672C", c.hostVersion),
      field("SDK \u7248\u672C", c.sdkVersion)
    );
    if (c.requiredHost) nodes.push(field("\u8981\u6C42\u5BBF\u4E3B", c.requiredHost));
    if (c.requiredSdk) nodes.push(field("\u8981\u6C42 SDK", c.requiredSdk));
    for (const [label, diff] of [
      ["\u6743\u9650", d.permissions],
      ["\u7F51\u7EDC\u8303\u56F4", d.networkOrigins]
    ]) {
      nodes.push(
        field(`${label}\u58F0\u660E`, diff.declared.join("\u3001") || "\u65E0"),
        field(`${label}\u5DF2\u6279\u51C6`, diff.approved.join("\u3001") || "\u65E0")
      );
      if (diff.added.length) nodes.push(field(`${label}\u65B0\u589E\uFF08\u9700\u5BBF\u4E3B\u5BA1\u9605\uFF09`, diff.added.join("\u3001")));
      if (diff.removed.length) nodes.push(field(`${label}\u79FB\u9664`, diff.removed.join("\u3001")));
    }
    if (d.approvedHost && d.approvedHost !== d.host)
      nodes.push(text(`\u6267\u884C\u73AF\u5883\u4ECE ${d.approvedHost} \u53D8\u4E3A ${d.host}\uFF0C\u8BF7\u5728\u5BBF\u4E3B\u8BE6\u60C5\u4E2D\u91CD\u65B0\u5BA1\u9605\u3002`));
    for (const diagnostic of d.diagnostics) nodes.push(field(diagnostic.code, diagnostic.message));
    if (d.state === "failed")
      nodes.push(text("\u5148\u5728\u5BBF\u4E3B\u8BE6\u60C5\u4E2D\u67E5\u770B\u6545\u969C\u3001\u505C\u7528\u6216\u6062\u590D\u9009\u9879\uFF1B\u672C\u6269\u5C55\u4E0D\u4F1A\u81EA\u52A8\u91CD\u65B0\u542F\u7528\u63D2\u4EF6\u3002"));
    if (d.settings) {
      nodes.push(text("\u8BBE\u7F6E\u8BF4\u660E\uFF08\u9ED8\u8BA4\u503C\uFF0C\u4E0D\u542B\u5DF2\u4FDD\u5B58\u7684\u7528\u6237\u503C\uFF09"));
      for (const [key, schema] of Object.entries(d.settings.schema)) {
        const bounds = schema.type === "enum" ? `\u53EF\u9009\uFF1A${schema.options.join("\u3001")}` : schema.type === "number" ? `\u8303\u56F4\uFF1A${schema.minimum}\u2013${schema.maximum}${schema.allowZero ? "\uFF1B\u4E5F\u53EF\u4E3A 0" : ""}` : "\u5E03\u5C14\u503C";
        nodes.push(field(key, `${bounds}\uFF1B\u9ED8\u8BA4\uFF1A${String(d.settings.defaults[key])}`));
      }
    }
    nodes.push(text("\u5B89\u88C5\u3001\u5347\u7EA7\u3001\u56DE\u9000\u3001\u6743\u9650\u786E\u8BA4\u4E0E\u6570\u636E\u4FDD\u7559\u7531\u53EF\u4FE1\u5BBF\u4E3B\u5904\u7406\u3002\u6B64\u9875\u9762\u53EA\u63D0\u4F9B\u89E3\u91CA\u548C\u5BFC\u822A\u3002"));
    nodes.push(
      button("management.hostDetails", "\u6253\u5F00\u5BBF\u4E3B\u8BE6\u60C5", state.busy),
      button("management.hostSettings", "\u6253\u5F00\u5BBF\u4E3B\u8BBE\u7F6E", state.busy || !d.settings)
    );
  } else {
    nodes.push(button("management.refresh", "\u5237\u65B0\u63D2\u4EF6\u5217\u8868", state.busy));
    if (state.phase === "loading") nodes.push(text("\u6B63\u5728\u8BFB\u53D6\u63D2\u4EF6\u76EE\u5F55\u2026"));
    else if (state.phase === "ready" && !state.snapshot?.items.length)
      nodes.push(text("\u6682\u65E0\u5DF2\u5B89\u88C5\u63D2\u4EF6\u3002"));
    for (const item of state.snapshot?.items ?? [])
      nodes.push({
        type: "element",
        tag: "button",
        disabled: state.busy,
        action: { command: "management.details", input: { id: item.id } },
        attributes: { class: "plugin-list-item", "aria-label": item.title },
        children: [
          group([text(Array.from(item.title)[0] ?? "\u25C7")], "plugin-ui-state-icon"),
          { type: "element", tag: "strong", text: item.title },
          text(item.description || "\u6682\u65E0\u63CF\u8FF0")
        ]
      });
  }
  if (state.message)
    nodes.push({
      type: "element",
      tag: "span",
      text: state.message,
      attributes: { role: "status" }
    });
  return group(nodes, "plugin-list-panel");
}

// src/plugin.ts
var controller;
var visible = false;
var plugin_default = definePlugin({
  activate(context) {
    controller?.dispose();
    visible = false;
    const current = createController(context.host.management, () => {
      if (visible && controller === current)
        void context.host.ui?.requestUpdate("management-panel").catch(() => {
        });
    });
    controller = current;
    return {
      dispose() {
        current.dispose();
        if (controller === current) {
          controller = void 0;
          visible = false;
        }
      }
    };
  },
  deactivate() {
    controller?.dispose();
    controller = void 0;
    visible = false;
  },
  commands: {
    "management.refresh": () => controller?.refresh(),
    "management.details": (_context, input) => {
      if (input && typeof input === "object" && "id" in input && typeof input.id === "string")
        return controller?.select(input.id);
    },
    "management.back": () => controller?.back(),
    "management.hostDetails": (context) => controller?.openTrusted(context.host?.management, "details"),
    "management.hostSettings": (context) => controller?.openTrusted(context.host?.management, "settings")
  },
  renderers: {
    "management-panel": (context) => {
      if (context.node?.phase === "dispose" || context.node?.visible === false) {
        visible = false;
        controller?.close();
        return "";
      }
      if (!visible) {
        visible = true;
        void controller?.refresh();
      }
      return controller ? render(controller.state) : "\u63D2\u4EF6\u7BA1\u7406\u80FD\u529B\u5C1A\u672A\u5C31\u7EEA\u3002";
    }
  }
});
export {
  plugin_default as default
};
