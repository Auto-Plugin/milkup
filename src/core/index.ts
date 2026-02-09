/**
 * Milkup - Markdown 编辑器内核
 *
 * 基于 ProseMirror 的即时渲染 Markdown 编辑器
 * 实现类似 Typora 的编辑体验
 */

// 编辑器主类
export { MilkupEditor, createMilkupEditor } from "./editor";

// Schema
export { milkupSchema, type MilkupSchema } from "./schema";

// 解析器
export { MarkdownParser, parseMarkdown, defaultParser, type ParseResult } from "./parser";

// 序列化器
export {
  MarkdownSerializer,
  serializeMarkdown,
  defaultSerializer,
  type SerializeOptions,
} from "./serializer";

// 插件
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
} from "./plugins/instant-render";

export { createInputRulesPlugin } from "./plugins/input-rules";

export { createSyntaxFixerPlugin, syntaxFixerPluginKey } from "./plugins/syntax-fixer";

export { createHeadingSyncPlugin, headingSyncPluginKey } from "./plugins/heading-sync";

export { createSyntaxDetectorPlugin, syntaxDetectorPluginKey } from "./plugins/syntax-detector";

export {
  createPastePlugin,
  pastePluginKey,
  type ImagePasteMethod,
  type ImageUploader,
  type LocalImageSaver,
  type PastePluginConfig,
} from "./plugins/paste";

export {
  createAICompletionPlugin,
  aiCompletionPluginKey,
  type AICompletionConfig,
  type AICompletionContext,
  type AICompletionState,
} from "./plugins/ai-completion";

export { createPlaceholderPlugin, placeholderPluginKey } from "./plugins/placeholder";

export { createLineNumbersPlugin, lineNumbersPluginKey } from "./plugins/line-numbers";

// 快捷键
export {
  createKeymapPlugin,
  createBasicKeymap,
  createMarkdownKeymap,
  createListKeymap,
  type KeymapConfig,
} from "./keymap";

// 装饰系统
export {
  createDecorationPlugin,
  decorationPluginKey,
  toggleSourceView,
  setSourceView,
  sourceViewManager,
  findSyntaxMarkerRegions,
  findMathInlineRegions,
  findSyntaxRegions,
  findMarkRegions,
  getActiveRegions,
  computeDecorations,
  SYNTAX_CLASSES,
  type DecorationPluginState,
  type SyntaxRegion,
  type MarkRegion,
  type SyntaxMarkerRegion,
  type MathInlineRegion,
  type SourceViewListener,
} from "./decorations";

// NodeView
export {
  CodeBlockView,
  createCodeBlockNodeView,
  MathBlockView,
  createMathBlockNodeView,
  renderInlineMath,
  isKaTeXAvailable,
  preloadKaTeX,
  updateAllMathBlocks,
  ImageView,
  createImageNodeView,
  updateAllImages,
  BulletListView,
  OrderedListView,
  ListItemView,
  createBulletListNodeView,
  createOrderedListNodeView,
  createListItemNodeView,
  updateAllLists,
} from "./nodeviews";

// 命令
export {
  commands,
  toggleStrong,
  toggleEmphasis,
  toggleCodeInline,
  toggleStrikethrough,
  toggleHighlight,
  setHeading,
  setParagraph,
  setCodeBlock,
  wrapInBlockquote,
  wrapInBulletList,
  wrapInOrderedList,
  liftBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  removeLink,
  insertTable,
  insertMathBlock,
  insertContainer,
} from "./commands";

// 类型
export type {
  MilkupConfig,
  MilkupEditor as IMilkupEditor,
  MilkupPlugin,
  ImagePathProcessor,
  SyntaxType,
  SyntaxMarker,
  PositionMap,
  DecorationState,
  MilkupEventType,
  MilkupEventHandler,
  ChangeEventData,
  SelectionChangeEventData,
} from "./types";
