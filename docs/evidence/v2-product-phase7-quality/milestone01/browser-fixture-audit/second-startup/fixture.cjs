var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tests/helpers/formatting-plugin.ts
var formatting_plugin_exports = {};
__export(formatting_plugin_exports, {
  formattingFixture: () => formattingFixture
});
module.exports = __toCommonJS(formatting_plugin_exports);
var import_test = require("@playwright/test");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_esbuild = require("esbuild");
async function formattingFixture(page) {
  const manifest = JSON.parse(await (0, import_promises.readFile)("plugins/formatting/plugin.json", "utf8"));
  const bundle = await (0, import_esbuild.build)({
    entryPoints: ["plugins/formatting/src/plugin.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    alias: { "@milkup/plugin-sdk": (0, import_node_path.resolve)("packages/plugin-sdk/src/index.js") }
  });
  manifest.main = "data:text/javascript," + encodeURIComponent(bundle.outputFiles[0].text);
  await page.addInitScript((manifest2) => {
    localStorage.setItem(
      "milkup.desktop.plugins.registry.v1",
      JSON.stringify({
        version: 1,
        records: [
          {
            manifest: manifest2,
            manifestPath: "/plugins/formatting/plugin.json",
            rootPath: "/plugins/formatting",
            sourcePath: "/plugins/formatting/plugin.json",
            dataRoot: `milkup://plugin-data/${manifest2.id}`,
            storageRoot: `milkup://plugin-storage/${manifest2.id}`,
            state: "installed",
            enabled: false,
            installedAt: 1,
            updatedAt: 1,
            trust: "development",
            approvals: { permissions: [], hosts: ["worker"] },
            errors: []
          }
        ],
        auditRecords: []
      })
    );
  }, manifest);
  await page.goto("/");
  await page.getByRole("button", { name: "\u83DC\u5355", exact: true }).click();
  await page.getByRole("button", { name: "\u63D2\u4EF6", exact: true }).click();
  await page.getByRole("button", { name: "Milkup Formatting", exact: true }).click();
  const approve = page.getByRole("button", { name: "\u6279\u51C6\u80FD\u529B", exact: true });
  if (await approve.isVisible()) await approve.click();
  else await (0, import_test.expect)(page.getByRole("button", { name: "\u64A4\u9500\u5BA1\u6279", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "\u542F\u7528", exact: true }).click();
  await page.locator("[data-menu-close]").click();
  await (0, import_test.expect)(
    page.locator('[data-plugin-slot="document-toolbar"]').getByRole("button", { name: "\u683C\u5F0F", exact: true })
  ).toBeVisible();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formattingFixture
});
