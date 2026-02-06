import { nextTick, ref } from "vue";

const isSpellCheckEnabled = ref(false);

function applySpellCheck(isEnabled: boolean) {
  isSpellCheckEnabled.value = isEnabled;
  nextTick(() => {
    const html = document.documentElement;
    if (isEnabled) {
      html.setAttribute("spellcheck", "true");
      localStorage.setItem("spellcheck", "true");
    } else {
      html.setAttribute("spellcheck", "false");
      localStorage.setItem("spellcheck", "false");
    }
  });
}

// 初始化拼写检查状态
function init() {
  const savedSpellCheck = localStorage.getItem("spellcheck");
  const isEnabled = savedSpellCheck === "true";
  applySpellCheck(isEnabled);
}

export default function useSpellCheck() {
  return {
    isSpellCheckEnabled,
    applySpellCheck,
    init,
  };
}
