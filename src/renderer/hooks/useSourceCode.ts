import { ref } from "vue";
import emitter from "@/renderer/events";

const isShowSource = ref(false);

// 监听源码模式状态变化（全局监听，只注册一次）
let isListenerRegistered = false;
if (!isListenerRegistered) {
  emitter.on("sourceView:changed", (enabled: boolean) => {
    isShowSource.value = enabled;
  });
  isListenerRegistered = true;
}

export default function useSourceCode() {
  const toggleSourceCode = () => {
    // 通过事件通知编辑器切换源码模式
    emitter.emit("sourceView:toggle");
  };

  return {
    isShowSource,
    toggleSourceCode,
  };
}
