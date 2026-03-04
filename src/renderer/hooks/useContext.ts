import emitter from "@/renderer/events";

export function useContext() {
  // 重新加载编辑器（通知活跃的编辑器实例重建内部 ProseMirror 编辑器）
  function reloadEditor() {
    emitter.emit("editor:reload");
  }

  return {
    reloadEditor,
  };
}
