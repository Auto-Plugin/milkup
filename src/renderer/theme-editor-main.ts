import "../../lang/index.js";

import { createApp } from "vue";

import ThemeEditor from "./components/settings/ThemeEditor.vue";

import "./style.less";
import "@/themes/theme-main.less";

try {
  const app = createApp(ThemeEditor);
  app.config.errorHandler = (err) => {
    console.error("[ThemeEditor] Vue error:", err);
    const el = document.getElementById("theme-editor-app");
    if (el) el.textContent = String(err);
  };
  app.mount("#theme-editor-app");
} catch (err) {
  console.error("[ThemeEditor] Mount failed:", err);
  const el = document.getElementById("theme-editor-app");
  if (el) {
    el.style.color = "red";
    el.style.padding = "20px";
    el.textContent = String(err);
  }
}
