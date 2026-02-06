/**
 * Milkup 插件导出
 */

export {
  createInstantRenderPlugin,
  instantRenderPluginKey,
  enableInstantRender,
  disableInstantRender,
  toggleInstantRender,
  getInstantRenderState,
  getActiveRegionsFromState,
  type InstantRenderState,
  type InstantRenderConfig,
} from "./instant-render";

export { createInputRulesPlugin } from "./input-rules";
